import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceNm?: number;
  type?: string;
  referenceId?: string;
  timezoneCorr?: number | null;
};

const FALLBACK_TIDE_STATIONS: TideStation[] = [
  { id: "1630000", name: "Apra Harbor, Guam", lat: 13.4434, lon: 144.6564, type: "R", timezoneCorr: 10 },
  { id: "1612366", name: "Pearl Harbor Entrance, Bishop Point", lat: 21.33, lon: -157.967, type: "R", timezoneCorr: -10 },
  { id: "1612340", name: "Honolulu, HI", lat: 21.3033, lon: -157.8645, type: "R", timezoneCorr: -10 },
  { id: "9414290", name: "San Francisco, CA", lat: 37.8063, lon: -122.4659, type: "R", timezoneCorr: -8 },
  { id: "9410170", name: "San Diego, CA", lat: 32.7142, lon: -117.1736, type: "R", timezoneCorr: -8 },
  { id: "9447130", name: "Seattle, WA", lat: 47.6026, lon: -122.3393, type: "R", timezoneCorr: -8 },
  { id: "8518750", name: "The Battery, NY", lat: 40.7006, lon: -74.0142, type: "R", timezoneCorr: -5 },
  { id: "8724580", name: "Key West, FL", lat: 24.5557, lon: -81.8079, type: "R", timezoneCorr: -5 },
  { id: "8761724", name: "Grand Isle, LA", lat: 29.2633, lon: -89.9567, type: "R", timezoneCorr: -6 },
  { id: "9755371", name: "San Juan, PR", lat: 18.4589, lon: -66.1164, type: "R", timezoneCorr: -4 },
  { id: "1770000", name: "Pago Pago, American Samoa", lat: -14.2767, lon: -170.689, type: "R", timezoneCorr: -11 },
];

const TIDE_FETCH_TIMEOUT_MS = 8000;

function toNumber(value: string | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rNm = 3440.065;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * rNm * Math.asin(Math.sqrt(h));
}

function yyyymmdd(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIDE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NavDash Tide Tool", Accept: "application/json" },
      next: { revalidate: 60 * 60 * 6 },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("NOAA tide service did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeStation(raw: any): TideStation | null {
  const id = String(raw?.id ?? raw?.stationId ?? raw?.station_id ?? "").trim();
  const name = String(raw?.name ?? raw?.stationName ?? raw?.station_name ?? id).trim();
  const lat = Number(raw?.lat ?? raw?.latitude);
  const lon = Number(raw?.lng ?? raw?.lon ?? raw?.longitude);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const timezoneCorr = Number(raw?.timezonecorr);
  return {
    id,
    name: name || id,
    lat,
    lon,
    type: typeof raw?.type === "string" ? raw.type : undefined,
    referenceId: typeof raw?.reference_id === "string" ? raw.reference_id : undefined,
    timezoneCorr: Number.isFinite(timezoneCorr) ? timezoneCorr : null,
  };
}

async function tidePredictionStations() {
  const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
  try {
    const json = await fetchJson(url);
    const stations = (Array.isArray(json?.stations) ? json.stations : []).map(normalizeStation).filter(Boolean) as TideStation[];
    if (stations.length) return stations;
  } catch {
    // Use known major NOAA prediction stations if metadata is temporarily unavailable.
  }
  return FALLBACK_TIDE_STATIONS;
}

function withDistances(stations: TideStation[], lat: number, lon: number) {
  const byId = new Map<string, TideStation>();
  for (const station of [...stations, ...FALLBACK_TIDE_STATIONS]) byId.set(station.id, station);
  return Array.from(byId.values()).map((station) => ({
    ...station,
    distanceNm: Math.round(distanceNm(lat, lon, station.lat, station.lon) * 10) / 10,
  }));
}

async function fetchPredictions(station: string, interval: "h" | "hilo", rangeHours: number) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + Math.max(1, Math.ceil(rangeHours / 24) + 1));
  const params = new URLSearchParams({
    product: "predictions",
    application: "NavDash",
    begin_date: yyyymmdd(start),
    end_date: yyyymmdd(end),
    datum: "MLLW",
    station,
    time_zone: "lst_ldt",
    units: "english",
    interval,
    format: "json",
  });
  const json = await fetchJson(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
  if (json?.error?.message) throw new Error(String(json.error.message));
  const rows = Array.isArray(json?.predictions) ? json.predictions : [];
  return rows.map((row: any) => ({
    time: String(row.t ?? ""),
    valueFt: Number(row.v),
    type: row.type ? String(row.type) : undefined,
  })).filter((row: any) => row.time && Number.isFinite(row.valueFt));
}

async function predictionBundle(station: string, rangeHours: number) {
  const [hourly, highLow] = await Promise.all([
    fetchPredictions(station, "h", rangeHours),
    fetchPredictions(station, "hilo", rangeHours),
  ]);
  if (!hourly.length) throw new Error("NOAA returned no tide predictions for this station.");
  return { hourly, highLow };
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const lat = toNumber(search.get("lat"));
  const lon = toNumber(search.get("lon"));
  const requestedStation = search.get("station")?.trim();
  const query = search.get("q")?.trim().toLowerCase();
  const requestedHours = Number(search.get("hours") || 24);
  const rangeHours = Number.isFinite(requestedHours) ? Math.min(168, Math.max(12, Math.round(requestedHours))) : 24;

  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: "A valid latitude and longitude are required for tide lookup." }, { status: 400 });
  }

  try {
    const allStations = await tidePredictionStations();
    const allWithDistance = withDistances(allStations, lat, lon);
    const nearest = allWithDistance.slice().sort((a, b) => (a.distanceNm ?? 999999) - (b.distanceNm ?? 999999));

    if (query) {
      const stations = allWithDistance
        .filter((station) => station.id.toLowerCase().includes(query) || station.name.toLowerCase().includes(query))
        .sort((a, b) => (a.distanceNm ?? 999999) - (b.distanceNm ?? 999999))
        .slice(0, 20);
      return NextResponse.json({ ok: true, position: { lat, lon }, stations, source: "NOAA CO-OPS Tide Prediction Stations" });
    }

    const candidates = requestedStation
      ? [allWithDistance.find((item) => item.id === requestedStation) || { id: requestedStation, name: requestedStation, lat, lon, distanceNm: 0 }]
      : nearest.slice(0, 6);

    let selectedStation: TideStation | null = null;
    let bundle: { hourly: any[]; highLow: any[] } | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        bundle = await predictionBundle(candidate.id, rangeHours);
        selectedStation = candidate;
        break;
      } catch (error) {
        lastError = error;
        if (requestedStation) break;
      }
    }

    if (!selectedStation || !bundle) {
      throw lastError instanceof Error ? lastError : new Error("No usable NOAA tide prediction station was found for this position.");
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      position: { lat, lon },
      station: selectedStation,
      stations: nearest.slice(0, 8),
      datum: "MLLW",
      units: "feet",
      timeZone: "LST/LDT",
      rangeHours,
      source: "NOAA CO-OPS Tide Predictions",
      hourly: bundle.hourly,
      highLow: bundle.highLow,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
