import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type?: string;
  distanceNm?: number;
};

type TideEvent = {
  time: string;
  valueFt: number;
  type: "H" | "L" | string;
};

const FETCH_TIMEOUT_MS = 8000;

function toRad(value: number) {
  return value * Math.PI / 180;
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 3440.065;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function yyyymmdd(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseNoaaTime(value: string) {
  return new Date(`${value.replace(" ", "T")}:00Z`);
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NavDash Nav Brief", Accept: "application/json" },
      next: { revalidate: 60 * 60 * 6 },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStation(raw: any): TideStation | null {
  const id = String(raw?.id ?? "").trim();
  const name = String(raw?.name ?? id).trim();
  const lat = Number(raw?.lat ?? raw?.latitude);
  const lon = Number(raw?.lng ?? raw?.lon ?? raw?.longitude);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { id, name: name || id, lat, lon, type: typeof raw?.type === "string" ? raw.type : undefined };
}

async function tideStations() {
  const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
  const json = await fetchJson(url);
  return (Array.isArray(json?.stations) ? json.stations : []).map(normalizeStation).filter(Boolean) as TideStation[];
}

async function highLowPredictions(stationId: string, target: Date) {
  const start = new Date(target.getTime() - 36 * 3600000);
  const end = new Date(target.getTime() + 36 * 3600000);
  const params = new URLSearchParams({
    product: "predictions",
    application: "NavDash",
    begin_date: yyyymmdd(start),
    end_date: yyyymmdd(end),
    datum: "MLLW",
    station: stationId,
    time_zone: "gmt",
    units: "english",
    interval: "hilo",
    format: "json",
  });
  const json = await fetchJson(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
  if (json?.error?.message) throw new Error(String(json.error.message));
  const rows = Array.isArray(json?.predictions) ? json.predictions : [];
  return rows.map((row: any): TideEvent | null => {
    const time = String(row?.t ?? "");
    const valueFt = Number(row?.v);
    const type = String(row?.type ?? "");
    if (!time || !Number.isFinite(valueFt)) return null;
    return { time: parseNoaaTime(time).toISOString(), valueFt, type };
  }).filter(Boolean) as TideEvent[];
}

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const atRaw = req.nextUrl.searchParams.get("at") || "";
  const target = new Date(atRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: "Valid latitude and longitude are required." }, { status: 400 });
  }
  if (!Number.isFinite(target.getTime())) {
    return NextResponse.json({ ok: false, error: "A valid target time is required." }, { status: 400 });
  }

  try {
    const stations = (await tideStations())
      .map(station => ({ ...station, distanceNm: distanceNm(lat, lon, station.lat, station.lon) }))
      .sort((a, b) => (a.distanceNm ?? 999999) - (b.distanceNm ?? 999999));

    let station: TideStation | null = null;
    let events: TideEvent[] = [];
    let lastError: unknown = null;

    for (const candidate of stations.slice(0, 8)) {
      try {
        const predictions = await highLowPredictions(candidate.id, target);
        if (predictions.length < 2) throw new Error("No usable high/low predictions returned.");
        station = candidate;
        events = predictions;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!station || events.length < 2) {
      throw lastError instanceof Error ? lastError : new Error("No usable NOAA tide prediction station was found near this endpoint.");
    }

    const targetMs = target.getTime();
    const sorted = events.slice().sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const previous = sorted.filter(event => new Date(event.time).getTime() <= targetMs).at(-1) || null;
    const next = sorted.find(event => new Date(event.time).getTime() > targetMs) || null;
    const nearby = sorted
      .slice()
      .sort((a, b) => Math.abs(new Date(a.time).getTime() - targetMs) - Math.abs(new Date(b.time).getTime() - targetMs))
      .slice(0, 4)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    let trend = "UNKNOWN";
    if (previous?.type === "L" && next?.type === "H") trend = "RISING";
    if (previous?.type === "H" && next?.type === "L") trend = "FALLING";

    return NextResponse.json({
      ok: true,
      targetTime: target.toISOString(),
      position: { lat, lon },
      station,
      datum: "MLLW",
      units: "feet",
      timeZone: "GMT",
      trend,
      previous,
      next,
      events: nearby,
      representativeWarning: (station.distanceNm ?? 0) > 25 ? `Nearest usable NOAA prediction station is ${(station.distanceNm ?? 0).toFixed(1)} NM from the route endpoint.` : null,
      source: "NOAA CO-OPS Tide Predictions",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
