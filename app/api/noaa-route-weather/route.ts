import { NextResponse } from "next/server";
import {
  normalizeRouteWaypoints,
  pointAtRouteDistanceNm,
  routeDistanceNm,
  type RouteWaypoint,
} from "../../../lib/routeNavigation";

type Waypoint = RouteWaypoint;
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
// Keep the route request compact enough for Vercel/NOMADS, but cover the full
// 120-hour horizon currently supported by the GRIB route samplers. The old
// 24-hour list made any voyage departure more than a day away appear to have
// zero weather coverage even though GFS data was available.
const TARGET_HOURS = [0, 6, 12, 24, 48, 72, 96, 120];
const SAMPLE_SPACING_NM = 35;
const MAX_SAMPLES = 9;

function routeSamples(route: Waypoint[]): SamplePoint[] {
  if (route.length < 2) return [];
  const total = routeDistanceNm(route);
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / SAMPLE_SPACING_NM) + 1));
  const samples: SamplePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const distanceNm = total * (index / (count - 1));
    const point = pointAtRouteDistanceNm(route, distanceNm, SAMPLE_SPACING_NM);
    if (point) samples.push({ lat: point.lat, lon: point.lon, distanceNm });
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
    const route: Waypoint[] = normalizeRouteWaypoints(body?.waypoints);
    if (route.length < 2) return NextResponse.json({ error: "Route requires at least two valid waypoints." }, { status: 400 });

    const url = new URL(request.url);
    const waveFallbackRequest = route.length > 0 && route.every((wp) => (wp.name || "").startsWith("Route sample "));
    const nwsOnly = url.searchParams.get("nwsOnly") === "1" || waveFallbackRequest;
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const validTimes = TARGET_HOURS.map((hours) => new Date(now.getTime() + hours * 3600000));
    const samples = routeSamples(route);
    const origin = url.origin;

    const [nwsResults, atmosResult] = await Promise.all([
      Promise.all(samples.map((point) => sampleNwsPoint(point, validTimes))),
      nwsOnly
        ? Promise.resolve({ ok: false, json: null })
        : fetch(`${origin}/api/gfs-atmos-route`, {
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
        : nwsOnly
          ? "NWS point grids requested for marine-wave fallback."
          : "GFS atmospheric GRIB2 was unavailable; using available NWS point-grid data.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA route weather failed." }, { status: 500 });
  }
}