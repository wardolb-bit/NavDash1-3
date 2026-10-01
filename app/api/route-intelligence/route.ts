import { NextRequest, NextResponse } from "next/server";
import {
  geodesicDistanceNm,
  normalizeRouteWaypoints,
  pointAtRouteDistanceNm,
  routeDistanceNm,
  type RouteWaypoint,
} from "../../../lib/routeNavigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Waypoint = RouteWaypoint;
type Finding = {
  id: string;
  category: "WEATHER" | "TIDES" | "NAVIGATION";
  severity: "INFO" | "ADVISORY" | "WARNING";
  title: string;
  detail: string;
  sourceName: string;
  sourceUrl: string;
  legIndex?: number;
  waypointId?: string;
};

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "NavDash Voyage Workbench route intelligence",
};

function sampleRoute(route: Waypoint[], spacingNm = 40) {
  if (!route.length) return [] as Array<{ lat: number; lon: number; legIndex: number }>;
  const totalNm = routeDistanceNm(route);
  if (totalNm <= 0) return [{ lat: route[0].lat, lon: route[0].lon, legIndex: 0 }];
  const count = Math.max(2, Math.min(24, Math.ceil(totalNm / spacingNm) + 1));
  return Array.from({ length: count }, (_, index) => {
    const distanceNm = totalNm * index / (count - 1);
    const point = pointAtRouteDistanceNm(route, distanceNm, spacingNm);
    if (point) return { lat: point.lat, lon: point.lon, legIndex: point.legIndex };
    const fallback = route[route.length - 1];
    return { lat: fallback.lat, lon: fallback.lon, legIndex: route.length - 1 };
  });
}

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function activeWeatherAlerts(samples: ReturnType<typeof sampleRoute>): Promise<Finding[]> {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  await Promise.all(samples.map(async (point) => {
    try {
      const url = `https://api.weather.gov/alerts/active?point=${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
      const data = await jsonFetch(url, { headers: NWS_HEADERS });
      for (const feature of Array.isArray(data?.features) ? data.features : []) {
        const p = feature?.properties || {};
        const id = String(feature?.id || p?.id || `${p?.event}-${p?.headline}`);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const severityText = String(p?.severity || "").toLowerCase();
        const severity: Finding["severity"] = severityText === "extreme" || severityText === "severe" ? "WARNING" : "ADVISORY";
        findings.push({
          id: `nws-${id}`,
          category: "WEATHER",
          severity,
          title: String(p?.event || "NWS Weather Alert"),
          detail: String(p?.headline || p?.description || "Active NWS alert intersects a sampled point on the route.").replace(/\s+/g, " ").trim(),
          sourceName: "NOAA / National Weather Service",
          sourceUrl: String(p?.web || p?.uri || url),
          legIndex: point.legIndex,
        });
      }
    } catch {}
  }));
  return findings.slice(0, 20);
}

function forecastPeriodsForTime(periods: any[], when: Date) {
  const target = when.getTime();
  const containingIndex = periods.findIndex((p: any) => {
    const start = Date.parse(String(p?.startTime || ""));
    const end = Date.parse(String(p?.endTime || ""));
    return Number.isFinite(start) && Number.isFinite(end) && target >= start && target < end;
  });

  if (containingIndex >= 0) return periods.slice(containingIndex, containingIndex + 2);

  const firstFutureIndex = periods.findIndex((p: any) => {
    const start = Date.parse(String(p?.startTime || ""));
    return Number.isFinite(start) && start >= target;
  });
  if (firstFutureIndex >= 0) return periods.slice(firstFutureIndex, firstFutureIndex + 2);

  return [];
}

async function pointForecast(point: Waypoint, label: string, when: Date): Promise<Finding | null> {
  try {
    const pointUrl = `https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
    const meta = await jsonFetch(pointUrl, { headers: NWS_HEADERS });
    const forecastUrl = meta?.properties?.forecast;
    if (!forecastUrl) return null;
    const forecast = await jsonFetch(forecastUrl, { headers: NWS_HEADERS });
    const allPeriods = Array.isArray(forecast?.properties?.periods) ? forecast.properties.periods : [];
    const periods = forecastPeriodsForTime(allPeriods, when);
    if (!periods.length) return null;

    const text = periods
      .map((p: any) => `${p.name}: ${p.detailedForecast}`)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const validLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(when);

    return {
      id: `forecast-${label.toLowerCase()}`,
      category: "WEATHER",
      severity: "INFO",
      title: `${label} forecast for ${validLabel}`,
      detail: text,
      sourceName: "NOAA / National Weather Service",
      sourceUrl: forecastUrl,
      waypointId: point.id,
    };
  } catch {
    return null;
  }
}

async function tideStations() {
  const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english";
  const data = await jsonFetch(url);
  return (Array.isArray(data?.stations) ? data.stations : [])
    .map((s: any) => ({ id: String(s.id || ""), name: String(s.name || s.id || "NOAA station"), lat: Number(s.lat), lon: Number(s.lng ?? s.lon), sourceUrl: String(s.self || "") }))
    .filter((s: any) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

function nearestStation(stations: any[], point: Waypoint) {
  let best: any = null;
  let bestNm = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    const d = geodesicDistanceNm(point, station);
    if (d < bestNm) { bestNm = d; best = station; }
  }
  return best ? { ...best, distanceNm: bestNm } : null;
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function tideFinding(station: any, label: string, when: Date): Promise<Finding | null> {
  if (!station || station.distanceNm > 60) return null;
  try {
    const start = new Date(when.getTime() - 6 * 3600000);
    const end = new Date(when.getTime() + 12 * 3600000);
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=NavDash&begin_date=${ymd(start)}&end_date=${ymd(end)}&datum=MLLW&station=${encodeURIComponent(station.id)}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
    const data = await jsonFetch(url);
    const predictions = Array.isArray(data?.predictions) ? data.predictions.slice(0, 8) : [];
    if (!predictions.length) return null;
    const text = predictions.map((p: any) => `${p.t} ${p.type || ""} ${p.v} ft`).join(" · ");
    return {
      id: `tides-${label.toLowerCase()}`,
      category: "TIDES",
      severity: "INFO",
      title: `${label} tide predictions: ${station.name}`,
      detail: `${station.distanceNm.toFixed(1)} NM from route endpoint. ${text}`,
      sourceName: "NOAA CO-OPS",
      sourceUrl: url,
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const route: Waypoint[] = normalizeRouteWaypoints(body?.waypoints);
    if (route.length < 2) return NextResponse.json({ ok: false, error: "At least two route waypoints are required." }, { status: 400 });

    const departure = body?.departureTime ? new Date(body.departureTime) : new Date();
    const plannedSpeed = Math.max(0.1, Number(body?.plannedSpeed) || 10);
    const totalNm = routeDistanceNm(route);
    const arrival = new Date(departure.getTime() + (totalNm / plannedSpeed) * 3600000);
    const samples = sampleRoute(route, 40);

    const [alerts, depForecast, arrForecast, stations] = await Promise.all([
      activeWeatherAlerts(samples),
      pointForecast(route[0], "Departure", departure),
      pointForecast(route[route.length - 1], "Arrival", arrival),
      tideStations().catch(() => []),
    ]);

    const depStation = nearestStation(stations, route[0]);
    const arrStation = nearestStation(stations, route[route.length - 1]);
    const [depTide, arrTide] = await Promise.all([
      tideFinding(depStation, "Departure", departure),
      tideFinding(arrStation, "Arrival", arrival),
    ]);

    const findings: Finding[] = [depForecast, arrForecast, depTide, arrTide, ...alerts].filter(Boolean) as Finding[];

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      route: { totalNm, sampleCount: samples.length, departureTime: departure.toISOString(), estimatedArrival: arrival.toISOString() },
      vessel: { loaFt: 265, beamFt: 60, draftFt: Number(body?.draftFt) || null, airDraftFt: Number(body?.airDraftFt) || null },
      findings,
      sources: ["NOAA / National Weather Service", "NOAA CO-OPS"],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Route intelligence failed." }, { status: 502 });
  }
}