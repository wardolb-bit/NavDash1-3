import { NextResponse } from "next/server";
import {
  decodeFieldValues,
  nearestGridpoint,
  parseFields,
  parseGrid,
  splitMessages,
} from "@azohra/meteo.grib";

export const runtime = "nodejs";
export const maxDuration = 60;

type Point = { lat: number; lon: number; distanceNm: number };
type WavePoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg: number | null;
  source: string;
};
type WaveFrame = { validAt: string; points: WavePoint[] };

type NoaaPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
};
type NoaaFrame = { validAt: string; points: NoaaPoint[] };

type ModelRun = { date: string; cycle: string; cycleTime: Date };
type Bounds = { left: number; right: number; top: number; bottom: number };

const NOMADS = "https://nomads.ncep.noaa.gov";
const USER_AGENT = "NavDash GFS Wave GRIB route sampler (wardmaritimegroup.com)";
const M_TO_FT = 3.28084;
const MAX_VALID_SIGNIFICANT_WAVE_HEIGHT_M = 40;

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 3440.065;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function rounded(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function candidateRuns(now = new Date()) {
  const anchor = new Date(now);
  anchor.setUTCMinutes(0, 0, 0);
  const hour = anchor.getUTCHours();
  anchor.setUTCHours(Math.floor(hour / 6) * 6);
  const runs: ModelRun[] = [];
  for (let i = 0; i < 8; i += 1) {
    const cycleTime = new Date(anchor.getTime() - i * 6 * 3600000);
    runs.push({
      date: ymd(cycleTime),
      cycle: String(cycleTime.getUTCHours()).padStart(2, "0"),
      cycleTime,
    });
  }
  return runs;
}

function gribFileName(run: ModelRun, forecastHour: number) {
  return `gfswave.t${run.cycle}z.global.0p25.f${String(forecastHour).padStart(3, "0")}.grib2`;
}

function gribDirectory(run: ModelRun) {
  return `/gfs.${run.date}/${run.cycle}/wave/gridded`;
}

function directGribUrl(run: ModelRun, forecastHour: number) {
  return `${NOMADS}/pub/data/nccf/com/gfs/prod${gribDirectory(run)}/${gribFileName(run, forecastHour)}`;
}

async function latestModelRun() {
  for (const run of candidateRuns()) {
    try {
      const response = await fetch(`${directGribUrl(run, 0)}.idx`, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.includes(":HTSGW:")) return run;
    } catch {
      // Try the previous cycle.
    }
  }
  throw new Error("No current NOAA GFS Wave model cycle is available from NOMADS.");
}

function routeBounds(points: Point[]): Bounds {
  const margin = 1.5;
  const lats = points.map((point) => point.lat);
  const signedLons = points.map((point) => point.lon);
  const lon360 = signedLons.map((lon) => ((lon % 360) + 360) % 360);
  const signedSpan = Math.max(...signedLons) - Math.min(...signedLons);
  const span360 = Math.max(...lon360) - Math.min(...lon360);
  const use360 = span360 < signedSpan;
  const chosen = use360 ? lon360 : signedLons;

  let left = Math.min(...chosen) - margin;
  let right = Math.max(...chosen) + margin;
  if (use360) {
    left = Math.max(0, left);
    right = Math.min(360, right);
  } else {
    left = Math.max(-180, left);
    right = Math.min(180, right);
  }

  return {
    left,
    right,
    top: Math.min(90, Math.max(...lats) + margin),
    bottom: Math.max(-90, Math.min(...lats) - margin),
  };
}

function filterUrl(run: ModelRun, forecastHour: number, bounds: Bounds) {
  const params = new URLSearchParams();
  params.set("file", gribFileName(run, forecastHour));
  params.set("var_HTSGW", "on");
  params.set("lev_surface", "on");
  params.set("subregion", "");
  params.set("leftlon", String(bounds.left));
  params.set("rightlon", String(bounds.right));
  params.set("toplat", String(bounds.top));
  params.set("bottomlat", String(bounds.bottom));
  params.set("dir", gribDirectory(run));
  return `${NOMADS}/cgi-bin/filter_gfswave.pl?${params.toString()}`;
}

async function fetchHeightField(run: ModelRun, forecastHour: number, bounds: Bounds) {
  const url = filterUrl(run, forecastHour, bounds);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NOMADS GRIB download failed (${response.status}) for f${String(forecastHour).padStart(3, "0")}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") {
    throw new Error(`NOMADS returned a non-GRIB response for f${String(forecastHour).padStart(3, "0")}.`);
  }
  const messages = splitMessages(bytes);
  if (!messages.length) throw new Error("Downloaded GRIB2 contained no messages.");
  const fields = parseFields(messages[0]);
  if (!fields.length) throw new Error("Downloaded GRIB2 contained no decodable fields.");
  const field = fields[0];
  const grid = parseGrid(field.section3);
  const { values } = decodeFieldValues(field);
  return { grid, values };
}

function sampleHeightMeters(
  grid: ReturnType<typeof parseGrid>,
  values: Float64Array | number[],
  point: Point,
) {
  const offsets = [
    [0, 0],
    [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25],
    [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [-0.25, -0.25],
    [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5],
  ];

  let best: { value: number; distanceNm: number } | null = null;
  for (const [dLat, dLon] of offsets) {
    const sample = nearestGridpoint(grid, point.lat + dLat, point.lon + dLon);
    const value = Number(values[sample.index]);
    // GRIB decoders can expose packed missing-value sentinels (commonly ~9999/10000)
    // as finite numbers. Reject anything outside a physically credible HTSGW range.
    if (!Number.isFinite(value) || value < 0 || value > MAX_VALID_SIGNIFICANT_WAVE_HEIGHT_M) continue;
    const distanceNm = nmBetween(point.lat, point.lon, sample.latitude, sample.longitude);
    if (distanceNm > 35) continue;
    if (!best || distanceNm < best.distanceNm) best = { value, distanceNm };
  }
  return best;
}

function nearestNoaaFrame(frames: NoaaFrame[], validAt: Date) {
  let best: NoaaFrame | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const delta = Math.abs(new Date(frame.validAt).getTime() - validAt.getTime());
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

function nearestNoaaPoint(frame: NoaaFrame | null, point: Point) {
  let best: { point: NoaaPoint; distanceNm: number } | null = null;
  for (const candidate of frame?.points || []) {
    if (candidate.waveHeightFt === null && candidate.wavePeriodSec === null) continue;
    const distanceNm = nmBetween(point.lat, point.lon, candidate.lat, candidate.lon);
    if (distanceNm <= 18 && (!best || distanceNm < best.distanceNm)) best = { point: candidate, distanceNm };
  }
  return best;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const points: Point[] = (Array.isArray(body?.points) ? body.points : [])
      .map((p: any) => ({
        lat: Number(p?.lat),
        lon: Number(p?.lon),
        distanceNm: Number(p?.distanceNm),
      }))
      .filter((p: Point) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.distanceNm) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180
      );

    const validTimes = (Array.isArray(body?.validTimes) ? body.validTimes : [])
      .map((value: unknown) => new Date(String(value)))
      .filter((date: Date) => Number.isFinite(date.getTime()));

    if (points.length < 2 || !validTimes.length) {
      return NextResponse.json({ error: "Wave request requires route points and forecast valid times." }, { status: 400 });
    }

    const [run, noaaResponse] = await Promise.all([
      latestModelRun(),
      fetch(`${new URL(request.url).origin}/api/noaa-route-weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: points.map((point, index) => ({ lat: point.lat, lon: point.lon, name: `Route sample ${index + 1}` })),
        }),
        cache: "no-store",
      }),
    ]);

    let noaaFrames: NoaaFrame[] = [];
    try {
      const noaaJson = await noaaResponse.json();
      if (noaaResponse.ok && Array.isArray(noaaJson?.frames)) noaaFrames = noaaJson.frames;
    } catch {
      noaaFrames = [];
    }

    const bounds = routeBounds(points);
    const frames: WaveFrame[] = [];
    let gribFailures = 0;

    for (const validAt of validTimes) {
      const rawHour = Math.round((validAt.getTime() - run.cycleTime.getTime()) / 3600000);
      const forecastHour = Math.max(0, Math.min(120, rawHour));
      let heightField: Awaited<ReturnType<typeof fetchHeightField>> | null = null;
      try {
        heightField = await fetchHeightField(run, forecastHour, bounds);
      } catch {
        gribFailures += 1;
      }

      const localFrame = nearestNoaaFrame(noaaFrames, validAt);
      const resultPoints = points.map((point): WavePoint => {
        const local = nearestNoaaPoint(localFrame, point);
        const gribSample = heightField ? sampleHeightMeters(heightField.grid, heightField.values, point) : null;

        if (gribSample) {
          return {
            lat: point.lat,
            lon: point.lon,
            distanceNm: point.distanceNm,
            waveHeightFt: rounded(gribSample.value * M_TO_FT, 1),
            wavePeriodSec: rounded(local?.point.wavePeriodSec ?? null, 0),
            waveDirectionDeg: null,
            source: gribSample.distanceNm <= 1
              ? `NOAA GFS Wave GRIB2 f${String(forecastHour).padStart(3, "0")} exact-grid sample`
              : `NOAA GFS Wave GRIB2 f${String(forecastHour).padStart(3, "0")} nearest-water sample (${gribSample.distanceNm.toFixed(1)} nm)`,
          };
        }

        if (local?.point.waveHeightFt !== null && local?.point.waveHeightFt !== undefined) {
          return {
            lat: point.lat,
            lon: point.lon,
            distanceNm: point.distanceNm,
            waveHeightFt: local.point.waveHeightFt,
            wavePeriodSec: local.point.wavePeriodSec,
            waveDirectionDeg: null,
            source: `NOAA/NWS marine grid fallback (${local.distanceNm.toFixed(1)} nm source distance)`,
          };
        }

        return {
          lat: point.lat,
          lon: point.lon,
          distanceNm: point.distanceNm,
          waveHeightFt: null,
          wavePeriodSec: local?.point.wavePeriodSec ?? null,
          waveDirectionDeg: null,
          source: "NOAA GFS Wave GRIB2 and local NWS wave guidance unavailable",
        };
      });

      frames.push({ validAt: validAt.toISOString(), points: resultPoints });
    }

    const populated = frames.reduce((count, frame) => count + frame.points.filter((point) => point.waveHeightFt !== null).length, 0);
    const total = frames.reduce((count, frame) => count + frame.points.length, 0);

    return NextResponse.json({
      provider: "NOAA / NCEP GFS Wave GRIB2",
      product: "GFS Wave 0.25° significant wave height with NWS marine-grid fallback",
      generatedAt: new Date().toISOString(),
      modelRun: run.cycleTime.toISOString(),
      modelCycle: `${run.date} ${run.cycle}Z`,
      gribFailures,
      populatedPointCount: populated,
      totalPointCount: total,
      coveragePercent: total ? Math.round((populated / total) * 100) : 0,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA GFS Wave GRIB route sampling failed." },
      { status: 500 },
    );
  }
}
