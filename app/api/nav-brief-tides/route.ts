import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  agency?: string;
  type?: string;
  distanceNm?: number;
};

type TideEvent = {
  time: string;
  valueFt: number;
  type: "H" | "L" | string;
};

type TideProviderResult = {
  station: TideStation;
  events: TideEvent[];
  datum: string;
  units: "feet";
  timeZone: string;
  source: string;
};

const FETCH_TIMEOUT_MS = 8000;
const CM_PER_FOOT = 30.48;
const JMA_MAX_STATION_DISTANCE_NM = 75;

const JMA_STATIONS: TideStation[] = [
  {
    id: "Q9",
    name: "Kure",
    lat: 34 + 14 / 60,
    lon: 132 + 33 / 60,
    agency: "JMA",
  },
];

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

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NavDash Nav Brief", Accept: "text/html,application/xhtml+xml" },
      next: { revalidate: 60 * 60 * 6 },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
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
  return {
    id,
    name: name || id,
    lat,
    lon,
    agency: "NOAA CO-OPS",
    type: typeof raw?.type === "string" ? raw.type : undefined,
  };
}

function isJapan(lat: number, lon: number) {
  return lat >= 24 && lat <= 46.5 && lon >= 122 && lon <= 146.5;
}

function isNoaaRegion(lat: number, lon: number) {
  const conus = lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
  const alaskaWest = lat >= 51 && lat <= 72 && lon >= -180 && lon <= -129;
  const alaskaAleutians = lat >= 51 && lat <= 56 && lon >= 170 && lon <= 180;
  const hawaii = lat >= 18 && lat <= 23.5 && lon >= -161.5 && lon <= -154;
  const puertoRicoUsvi = lat >= 17 && lat <= 20 && lon >= -68 && lon <= -64;
  const guamCnmi = lat >= 12 && lat <= 22 && lon >= 143 && lon <= 146.5;
  const americanSamoa = lat >= -15 && lat <= -11 && lon >= -172 && lon <= -168;
  return conus || alaskaWest || alaskaAleutians || hawaii || puertoRicoUsvi || guamCnmi || americanSamoa;
}

async function noaaTideStations() {
  const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
  const json = await fetchJson(url);
  return (Array.isArray(json?.stations) ? json.stations : []).map(normalizeStation).filter(Boolean) as TideStation[];
}

async function noaaHighLowPredictions(stationId: string, target: Date) {
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

async function fetchNoaaProvider(lat: number, lon: number, target: Date): Promise<TideProviderResult> {
  const stations = (await noaaTideStations())
    .map(station => ({ ...station, distanceNm: distanceNm(lat, lon, station.lat, station.lon) }))
    .sort((a, b) => (a.distanceNm ?? 999999) - (b.distanceNm ?? 999999));

  let station: TideStation | null = null;
  let events: TideEvent[] = [];
  let lastError: unknown = null;

  for (const candidate of stations.slice(0, 8)) {
    try {
      const predictions = await noaaHighLowPredictions(candidate.id, target);
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

  return {
    station,
    events,
    datum: "MLLW",
    units: "feet",
    timeZone: "GMT",
    source: "NOAA CO-OPS Tide Predictions",
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#039;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function jstCalendarDate(target: Date) {
  const shifted = new Date(target.getTime() + 9 * 3600000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function addCalendarDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}

function jmaQueryDateParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function jmaEventIso(year: number, month: number, day: number, hhmm: string) {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute)).toISOString();
}

function parseJmaPairs(cells: string[], type: "H" | "L", year: number, month: number, day: number) {
  const events: TideEvent[] = [];
  for (let index = 0; index + 1 < cells.length; index += 2) {
    const time = decodeHtml(cells[index]);
    const valueCm = Number(decodeHtml(cells[index + 1]));
    const iso = jmaEventIso(year, month, day, time);
    if (!iso || !Number.isFinite(valueCm)) continue;
    events.push({ time: iso, valueFt: valueCm / CM_PER_FOOT, type });
  }
  return events;
}

function parseJmaHighLowHtml(html: string) {
  const events: TideEvent[] = [];
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const rawCells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), match => match[1]);
    if (rawCells.length < 9) continue;
    const dateText = decodeHtml(rawCells[0]);
    const dateMatch = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) continue;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const tideCells = rawCells.slice(1);
    const highCells = tideCells.slice(0, 8);
    const lowCells = tideCells.slice(8, 16);
    events.push(...parseJmaPairs(highCells, "H", year, month, day));
    events.push(...parseJmaPairs(lowCells, "L", year, month, day));
  }

  return events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

async function fetchJmaProvider(lat: number, lon: number, target: Date): Promise<TideProviderResult> {
  const station = JMA_STATIONS
    .map(candidate => ({ ...candidate, distanceNm: distanceNm(lat, lon, candidate.lat, candidate.lon) }))
    .sort((a, b) => (a.distanceNm ?? 999999) - (b.distanceNm ?? 999999))[0];

  if (!station || (station.distanceNm ?? 999999) > JMA_MAX_STATION_DISTANCE_NM) {
    throw new Error("Japan is supported through JMA, but no configured JMA tide-table station is close enough to this route endpoint yet.");
  }

  const localDate = jstCalendarDate(target);
  const start = jmaQueryDateParts(addCalendarDays(localDate, -1));
  const end = jmaQueryDateParts(addCalendarDays(localDate, 1));
  const params = new URLSearchParams({
    stn: station.id,
    ys: String(start.year),
    ms: String(start.month),
    ds: String(start.day),
    ye: String(end.year),
    me: String(end.month),
    de: String(end.day),
    LV: "DL",
    S_HILO: "on",
  });
  const html = await fetchText(`https://www.data.jma.go.jp/kaiyou/db/tide/suisan/suisan.php?${params}`);
  const events = parseJmaHighLowHtml(html);
  if (events.length < 2) throw new Error("JMA returned no usable high/low tide predictions for this period.");

  return {
    station,
    events,
    datum: "JMA Tide Table Datum",
    units: "feet",
    timeZone: "Asia/Tokyo",
    source: "Japan Meteorological Agency Tide Tables",
  };
}

function nearbyEvents(events: TideEvent[], target: Date) {
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

  return { previous, next, nearby, trend };
}

async function providerForPosition(lat: number, lon: number, target: Date) {
  if (isJapan(lat, lon)) return fetchJmaProvider(lat, lon, target);
  if (isNoaaRegion(lat, lon)) return fetchNoaaProvider(lat, lon, target);
  throw new Error("No official tide provider is configured for this destination yet.");
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
    const provider = await providerForPosition(lat, lon, target);
    const { previous, next, nearby, trend } = nearbyEvents(provider.events, target);
    const stationDistance = provider.station.distanceNm ?? 0;

    return NextResponse.json({
      ok: true,
      targetTime: target.toISOString(),
      position: { lat, lon },
      station: provider.station,
      datum: provider.datum,
      units: provider.units,
      timeZone: provider.timeZone,
      trend,
      previous,
      next,
      events: nearby,
      representativeWarning: stationDistance > 25
        ? `Nearest configured ${provider.station.agency || "official"} prediction station is ${stationDistance.toFixed(1)} NM from the route endpoint.`
        : null,
      source: provider.source,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not configured|no configured JMA/i.test(message) ? 404 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
