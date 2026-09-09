import { NextResponse } from "next/server";

type Waypoint = { lat: number; lon: number; name?: string };
type SamplePoint = { lat: number; lon: number; distanceNm: number };
type GridValue = { validTime?: string; value?: number | null };

type MarkerFrame = {
  validAt: string;
  points: Array<{
    lat: number;
    lon: number;
    distanceNm: number;
    windKt: number | null;
    windDirectionDeg: number | null;
    gustKt: number | null;
    waveHeightFt: number | null;
    wavePeriodSec: number | null;
    source: string;
  }>;
};

const UA = "NavDash preview NOAA route weather (wardmaritimegroup.com)";
const TARGET_HOURS = [0, 3, 6, 9, 12, 18, 24];
const SAMPLE_SPACING_NM = 35;
const MAX_SAMPLES = 9;

function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeSamples(route: Waypoint[]): SamplePoint[] {
  if (route.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) cumulative.push(cumulative[i - 1] + nmBetween(route[i - 1], route[i]));
  const total = cumulative[cumulative.length - 1];
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / SAMPLE_SPACING_NM) + 1));
  const samples: SamplePoint[] = [];
  for (let s = 0; s < count; s += 1) {
    const target = count === 1 ? 0 : total * (s / (count - 1));
    let leg = 0;
    while (leg < cumulative.length - 2 && cumulative[leg + 1] < target) leg += 1;
    const a = route[leg];
    const b = route[leg + 1];
    const legNm = Math.max(0.0001, cumulative[leg + 1] - cumulative[leg]);
    const f = Math.max(0, Math.min(1, (target - cumulative[leg]) / legNm));
    let lonB = b.lon;
    while (lonB - a.lon > 180) lonB -= 360;
    while (lonB - a.lon < -180) lonB += 360;
    let lon = a.lon + (lonB - a.lon) * f;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    samples.push({ lat: a.lat + (b.lat - a.lat) * f, lon, distanceNm: target });
  }
  return samples;
}

function parseDurationMs(duration: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration || "");
  if (!match) return 3600000;
  return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60000;
}

function valueAt(values: GridValue[] | undefined, time: Date) {
  if (!Array.isArray(values)) return null;
  const t = time.getTime();
  for (const item of values) {
    if (!item?.validTime) continue;
    const [startRaw, durationRaw = "PT1H"] = item.validTime.split("/");
    const start = new Date(startRaw).getTime();
    if (!Number.isFinite(start)) continue;
    const end = start + parseDurationMs(durationRaw);
    if (t >= start && t < end) return typeof item.value === "number" && Number.isFinite(item.value) ? item.value : null;
  }
  return null;
}

function kmhToKt(v: number | null) { return v === null ? null : v * 0.5399568; }
function mToFt(v: number | null) { return v === null ? null : v * 3.28084; }
function rounded(v: number | null, digits = 0) { return v === null ? null : Number(v.toFixed(digits)); }

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function sampleForecast(point: SamplePoint, validTimes: Date[]) {
  try {
    const meta = await fetchJson(`https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
    const gridUrl = meta?.properties?.forecastGridData;
    if (!gridUrl) return null;
    const grid = await fetchJson(gridUrl);
    const props = grid?.properties || {};
    const source = `${props.gridId || meta?.properties?.gridId || "NWS"} ${props.gridX ?? meta?.properties?.gridX ?? ""},${props.gridY ?? meta?.properties?.gridY ?? ""}`.trim();
    return validTimes.map((validAt) => ({
      lat: point.lat,
      lon: point.lon,
      distanceNm: point.distanceNm,
      windKt: rounded(kmhToKt(valueAt(props.windSpeed?.values, validAt))),
      windDirectionDeg: rounded(valueAt(props.windDirection?.values, validAt)),
      gustKt: rounded(kmhToKt(valueAt(props.windGust?.values, validAt))),
      waveHeightFt: rounded(mToFt(valueAt(props.waveHeight?.values, validAt)), 1),
      wavePeriodSec: rounded(valueAt(props.wavePeriod?.values, validAt)),
      source,
    }));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const route: Waypoint[] = (Array.isArray(body?.waypoints) ? body.waypoints : [])
      .map((wp: any) => ({ lat: Number(wp?.lat), lon: Number(wp?.lon), name: typeof wp?.name === "string" ? wp.name : undefined }))
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
    if (route.length < 2) return NextResponse.json({ error: "Route requires at least two valid waypoints." }, { status: 400 });

    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const validTimes = TARGET_HOURS.map((hours) => new Date(now.getTime() + hours * 3600000));
    const samples = routeSamples(route);
    const results = await Promise.all(samples.map((point) => sampleForecast(point, validTimes)));
    const usable = results.filter((result): result is NonNullable<typeof result> => Array.isArray(result));

    const frames: MarkerFrame[] = validTimes.map((validAt, frameIndex) => ({
      validAt: validAt.toISOString(),
      points: usable.map((rows) => rows[frameIndex]).filter(Boolean),
    }));

    return NextResponse.json({
      version: 1,
      provider: "NOAA / National Weather Service",
      product: "NWS Digital Forecast Database route sampling",
      generatedAt: new Date().toISOString(),
      sampleCount: samples.length,
      coveredSampleCount: usable.length,
      frames,
      note: usable.length < samples.length ? "Some route points were outside NWS gridded point coverage and were omitted." : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA route weather failed." }, { status: 500 });
  }
}
