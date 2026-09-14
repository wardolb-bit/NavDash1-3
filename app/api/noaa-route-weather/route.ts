import { NextResponse } from "next/server";

type Waypoint = { lat: number; lon: number; name?: string };
type SamplePoint = { lat: number; lon: number; distanceNm: number };
type GridValue = { validTime?: string; value?: number | null };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  airTempF?: number | null;
  relativeHumidityPct?: number | null;
  pressureHpa?: number | null;
  precipMm?: number | null;
  cloudCoverPct?: number | null;
  source: string;
};
type MarkerFrame = { validAt: string; points: ForecastPoint[] };
type AtmosPoint = SamplePoint & {
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  airTempF: number | null;
  relativeHumidityPct: number | null;
  pressureHpa: number | null;
  precipMm: number | null;
  cloudCoverPct: number | null;
  source: string;
};
type AtmosResponse = {
  frames?: Array<{ validAt: string; points: AtmosPoint[] }>;
  product?: string;
  provider?: string;
  modelRun?: string;
  coveragePercent?: number;
};

const UA = "NavDash NOAA route weather (wardmaritimegroup.com)";
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

async function sampleNwsPoint(point: SamplePoint, validTimes: Date[]) {
  try {
    const meta = await fetchJson(`https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
    const gridUrl = meta?.properties?.forecastGridData;
    if (!gridUrl) return null;
    const grid = await fetchJson(gridUrl);
    const props = grid?.properties || {};
    const source = `${props.gridId || meta?.properties?.gridId || "NWS"} ${props.gridX ?? meta?.properties?.gridX ?? ""},${props.gridY ?? meta?.properties?.gridY ?? ""}`.trim();
    return validTimes.map((validAt): ForecastPoint => ({
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

function nearestAtmosFrame(frames: NonNullable<AtmosResponse["frames"]>, validAt: Date) {
  let best = frames[0];
  let bestDelta = Math.abs(new Date(best.validAt).getTime() - validAt.getTime());
  for (const candidate of frames) {
    const delta = Math.abs(new Date(candidate.validAt).getTime() - validAt.getTime());
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

function nearestAtmosPoint(points: AtmosPoint[], sample: SamplePoint) {
  return points.reduce<AtmosPoint | null>((best, candidate) => {
    if (!best) return candidate;
    return Math.abs(candidate.distanceNm - sample.distanceNm) < Math.abs(best.distanceNm - sample.distanceNm) ? candidate : best;
  }, null);
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
    const origin = new URL(request.url).origin;

    const [nwsResults, atmosResult] = await Promise.all([
      Promise.all(samples.map((point) => sampleNwsPoint(point, validTimes))),
      fetch(`${origin}/api/gfs-atmos-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ points: samples, validTimes: validTimes.map((date) => date.toISOString()) }),
      }).then(async (response) => ({ ok: response.ok, json: await response.json() })).catch(() => ({ ok: false, json: null })),
    ]);

    const atmos = atmosResult.ok ? atmosResult.json as AtmosResponse : null;
    const atmosFrames = Array.isArray(atmos?.frames) ? atmos!.frames! : [];

    const frames: MarkerFrame[] = validTimes.map((validAt, frameIndex) => {
      const atmosFrame = atmosFrames.length ? nearestAtmosFrame(atmosFrames, validAt) : null;
      const points = samples.map((sample, sampleIndex): ForecastPoint => {
        const nws = nwsResults[sampleIndex]?.[frameIndex] || null;
        const grib = atmosFrame ? nearestAtmosPoint(atmosFrame.points, sample) : null;
        return {
          lat: sample.lat,
          lon: sample.lon,
          distanceNm: sample.distanceNm,
          windKt: grib?.windKt ?? nws?.windKt ?? null,
          windDirectionDeg: grib?.windDirectionDeg ?? nws?.windDirectionDeg ?? null,
          gustKt: grib?.gustKt ?? nws?.gustKt ?? null,
          waveHeightFt: nws?.waveHeightFt ?? null,
          wavePeriodSec: nws?.wavePeriodSec ?? null,
          airTempF: grib?.airTempF ?? null,
          relativeHumidityPct: grib?.relativeHumidityPct ?? null,
          pressureHpa: grib?.pressureHpa ?? null,
          precipMm: grib?.precipMm ?? null,
          cloudCoverPct: grib?.cloudCoverPct ?? null,
          source: grib?.source || nws?.source || "Weather data unavailable",
        };
      });
      return { validAt: validAt.toISOString(), points };
    });

    const covered = frames[0]?.points.filter((point) => point.windKt !== null).length || 0;
    const usingGrib = atmosFrames.length > 0;

    return NextResponse.json({
      version: 3,
      provider: usingGrib ? "NOAA / NCEP GFS GRIB2 + NWS marine fallback" : "NOAA / National Weather Service",
      product: usingGrib ? (atmos?.product || "GFS 0.25° atmospheric GRIB2") : "NWS Digital Forecast Database route sampling",
      generatedAt: new Date().toISOString(),
      modelRun: atmos?.modelRun || null,
      sampleCount: samples.length,
      coveredSampleCount: covered,
      frames,
      note: usingGrib
        ? "GFS atmospheric GRIB2 is the primary route weather source; NWS point grids remain available for marine-wave fallback."
        : "GFS atmospheric GRIB2 was unavailable; using available NWS point-grid data.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA route weather failed." }, { status: 500 });
  }
}
