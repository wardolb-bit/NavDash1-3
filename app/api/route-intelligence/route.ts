import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };
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

function toRad(v: number) { return v * Math.PI / 180; }
function nmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 3440.065;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sampleRoute(route: Waypoint[], spacingNm = 40) {
  const points: Array<{ lat: number; lon: number; legIndex: number }> = [];
  if (!route.length) return points;
  points.push({ lat: route[0].lat, lon: route[0].lon, legIndex: 0 });
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1], b = route[i];
    const d = nmBetween(a, b);
    const segments = Math.max(1, Math.ceil(d / spacingNm));
    for (let s = 1; s <= segments; s += 1) {
      const f = s / segments;
      points.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        legIndex: i,
      });
    }
  }
  const seen = new Set<string>();
  return points.filter((p) => {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
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

async function pointForecast(point: Waypoint, label: string): Promise<Finding | null> {
  try {
    const pointUrl = `https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
    const meta = await jsonFetch(pointUrl, { headers: NWS_HEADERS });
    const forecastUrl = meta?.properties?.forecast;
    if (!forecastUrl) return null;
    const forecast = await jsonFetch(forecastUrl, { headers: NWS_HEADERS });
    const periods = Array.isArray(forecast?.properties?.periods) ? forecast.properties.periods.slice(0, 2) : [];
    if (!periods.length) return null;
    const text = periods.map((p: any) => `${p.name}: ${p.detailedForecast}`).join(" ").replace(/\s+/g, " ").trim();
    return {
      id: `forecast-${label.toLowerCase()}`,
      category: "WEATHER",
      severity: "INFO",
      title: `${label} forecast`,
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
    const d = nmBetween(point, station);
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
    const route: Waypoint[] = (Array.isArray(body?.waypoints) ? body.waypoints : [])
      .map((wp: any) => ({ id: String(wp?.id || ""), name: String(wp?.name || ""), lat: Number(wp?.lat), lon: Number(wp?.lon) }))
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
    if (route.length < 2) return NextResponse.json({ ok: false, error: "At least two route waypoints are required." }, { status: 400 });

    const departure = body?.departureTime ? new Date(body.departureTime) : new Date();
    const plannedSpeed = Math.max(0.1, Number(body?.plannedSpeed) || 10);
    const totalNm = route.slice(1).reduce((sum, wp, i) => sum + nmBetween(route[i], wp), 0);
    const arrival = new Date(departure.getTime() + (totalNm / plannedSpeed) * 3600000);
    const samples = sampleRoute(route, 40);

    const [alerts, depForecast, arrForecast, stations] = await Promise.all([
      activeWeatherAlerts(samples),
      pointForecast(route[0], "Departure"),
      pointForecast(route[route.length - 1], "Arrival"),
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
