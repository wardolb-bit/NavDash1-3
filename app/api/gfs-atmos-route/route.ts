import { NextResponse } from "next/server";
import {
  decodeFieldValues,
  nearestGridpoint,
  parseFields,
  parseGrid,
  parseProduct,
  splitMessages,
} from "@azohra/meteo.grib";

export const runtime = "nodejs";
export const maxDuration = 60;

type Point = { lat: number; lon: number; distanceNm: number };
type ModelRun = { date: string; cycle: string; cycleTime: Date };
type Bounds = { left: number; right: number; top: number; bottom: number };
type DecodedField = { grid: ReturnType<typeof parseGrid>; values: Float64Array | number[] };
type AtmosFields = {
  u10: DecodedField | null;
  v10: DecodedField | null;
  gust: DecodedField | null;
  temp2m: DecodedField | null;
  rh2m: DecodedField | null;
  pressure: DecodedField | null;
  precip: DecodedField | null;
  cloud: DecodedField | null;
};
type AtmosPoint = Point & {
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
type AtmosFrame = { validAt: string; points: AtmosPoint[] };

const NOMADS = "https://nomads.ncep.noaa.gov";
const USER_AGENT = "NavDash GFS atmospheric GRIB route sampler (wardmaritimegroup.com)";
const MS_TO_KT = 1.943844492;

function ymd(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function rounded(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function candidateRuns(now = new Date()) {
  const anchor = new Date(now);
  anchor.setUTCMinutes(0, 0, 0);
  anchor.setUTCHours(Math.floor(anchor.getUTCHours() / 6) * 6);
  const runs: ModelRun[] = [];
  for (let i = 0; i < 8; i += 1) {
    const cycleTime = new Date(anchor.getTime() - i * 6 * 3600000);
    runs.push({ date: ymd(cycleTime), cycle: String(cycleTime.getUTCHours()).padStart(2, "0"), cycleTime });
  }
  return runs;
}

function fileName(run: ModelRun, forecastHour: number) {
  return `gfs.t${run.cycle}z.pgrb2.0p25.f${String(forecastHour).padStart(3, "0")}`;
}

function directory(run: ModelRun) {
  return `/gfs.${run.date}/${run.cycle}/atmos`;
}

function directUrl(run: ModelRun, forecastHour: number) {
  return `${NOMADS}/pub/data/nccf/com/gfs/prod${directory(run)}/${fileName(run, forecastHour)}`;
}

async function latestRun() {
  for (const run of candidateRuns()) {
    try {
      const response = await fetch(`${directUrl(run, 0)}.idx`, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.includes(":UGRD:10 m above ground:") && text.includes(":TMP:2 m above ground:")) return run;
    } catch {
      // Try the previous cycle.
    }
  }
  throw new Error("No current NOAA GFS atmospheric model cycle is available from NOMADS.");
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
  params.set("file", fileName(run, forecastHour));
  for (const variable of ["UGRD", "VGRD", "GUST", "TMP", "RH", "PRMSL", "APCP", "TCDC"]) {
    params.set(`var_${variable}`, "on");
  }
  for (const level of ["10_m_above_ground", "2_m_above_ground", "surface", "mean_sea_level", "entire_atmosphere"]) {
    params.set(`lev_${level}`, "on");
  }
  params.set("subregion", "");
  params.set("leftlon", String(bounds.left));
  params.set("rightlon", String(bounds.right));
  params.set("toplat", String(bounds.top));
  params.set("bottomlat", String(bounds.bottom));
  params.set("dir", directory(run));
  return `${NOMADS}/cgi-bin/filter_gfs_0p25.pl?${params.toString()}`;
}

function scaledSurface(product: ReturnType<typeof parseProduct>) {
  if (product.scaledValueOfFirstFixedSurface === undefined) return null;
  const scale = product.scaleFactorOfFirstFixedSurface ?? 0;
  return product.scaledValueOfFirstFixedSurface * Math.pow(10, -scale);
}

function classifyField(field: ReturnType<typeof parseFields>[number]): keyof AtmosFields | null {
  if (field.discipline !== 0) return null;
  const product = parseProduct(field.section4);
  const cat = product.parameterCategory;
  const num = product.parameterNumber;
  const surface = product.typeOfFirstFixedSurface;
  const surfaceValue = scaledSurface(product);

  if (cat === 2 && num === 2 && surface === 103 && surfaceValue === 10) return "u10";
  if (cat === 2 && num === 3 && surface === 103 && surfaceValue === 10) return "v10";
  if (cat === 2 && num === 22) return "gust";
  if (cat === 0 && num === 0 && surface === 103 && surfaceValue === 2) return "temp2m";
  if (cat === 1 && num === 1 && surface === 103 && surfaceValue === 2) return "rh2m";
  if (cat === 3 && num === 1) return "pressure";
  if (cat === 1 && num === 8) return "precip";
  if (cat === 6 && num === 1) return "cloud";
  return null;
}

async function fetchFields(run: ModelRun, forecastHour: number, bounds: Bounds): Promise<AtmosFields> {
  const response = await fetch(filterUrl(run, forecastHour, bounds), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NOMADS atmospheric GRIB download failed (${response.status}) for f${String(forecastHour).padStart(3, "0")}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") throw new Error("NOMADS returned a non-GRIB atmospheric response.");

  const result: AtmosFields = { u10: null, v10: null, gust: null, temp2m: null, rh2m: null, pressure: null, precip: null, cloud: null };
  for (const message of splitMessages(bytes)) {
    for (const field of parseFields(message)) {
      const key = classifyField(field);
      if (!key || result[key]) continue;
      try {
        const grid = parseGrid(field.section3);
        const { values } = decodeFieldValues(field);
        result[key] = { grid, values };
      } catch {
        // One unsupported field must not discard the rest of the subset.
      }
    }
  }
  if (!result.u10 || !result.v10) throw new Error("GFS atmospheric GRIB did not contain decodable 10 m wind fields.");
  return result;
}

function sample(field: DecodedField | null, point: Point, valid: (value: number) => boolean) {
  if (!field) return null;
  const nearest = nearestGridpoint(field.grid, point.lat, point.lon);
  const value = Number(field.values[nearest.index]);
  return Number.isFinite(value) && valid(value) ? value : null;
}

function windDirectionFromUv(u: number, v: number) {
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}

function kelvinToF(k: number) {
  return (k - 273.15) * 9 / 5 + 32;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const points: Point[] = (Array.isArray(body?.points) ? body.points : [])
      .map((p: any) => ({ lat: Number(p?.lat), lon: Number(p?.lon), distanceNm: Number(p?.distanceNm) }))
      .filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.distanceNm) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    const validTimes = (Array.isArray(body?.validTimes) ? body.validTimes : [])
      .map((value: unknown) => new Date(String(value)))
      .filter((date: Date) => Number.isFinite(date.getTime()));

    if (points.length < 2 || !validTimes.length) {
      return NextResponse.json({ error: "Atmospheric GRIB request requires route points and forecast valid times." }, { status: 400 });
    }

    const run = await latestRun();
    const bounds = routeBounds(points);
    const frames: AtmosFrame[] = [];
    let gribFailures = 0;

    for (const validAt of validTimes) {
      const rawHour = Math.round((validAt.getTime() - run.cycleTime.getTime()) / 3600000);
      const forecastHour = Math.max(0, Math.min(120, rawHour));
      let fields: AtmosFields | null = null;
      try {
        fields = await fetchFields(run, forecastHour, bounds);
      } catch {
        gribFailures += 1;
      }

      const framePoints = points.map((point): AtmosPoint => {
        const u = sample(fields?.u10 ?? null, point, (value) => Math.abs(value) <= 200);
        const v = sample(fields?.v10 ?? null, point, (value) => Math.abs(value) <= 200);
        const gust = sample(fields?.gust ?? null, point, (value) => value >= 0 && value <= 200);
        const tempK = sample(fields?.temp2m ?? null, point, (value) => value >= 150 && value <= 350);
        const rh = sample(fields?.rh2m ?? null, point, (value) => value >= 0 && value <= 100);
        const pressure = sample(fields?.pressure ?? null, point, (value) => value >= 70000 && value <= 120000);
        const precip = sample(fields?.precip ?? null, point, (value) => value >= 0 && value <= 5000);
        const cloud = sample(fields?.cloud ?? null, point, (value) => value >= 0 && value <= 100);
        const windKt = u !== null && v !== null ? Math.hypot(u, v) * MS_TO_KT : null;
        const windDirectionDeg = u !== null && v !== null ? windDirectionFromUv(u, v) : null;

        return {
          ...point,
          windKt: rounded(windKt, 0),
          windDirectionDeg: rounded(windDirectionDeg, 0),
          gustKt: rounded(gust === null ? null : gust * MS_TO_KT, 0),
          airTempF: rounded(tempK === null ? null : kelvinToF(tempK), 1),
          relativeHumidityPct: rounded(rh, 0),
          pressureHpa: rounded(pressure === null ? null : pressure / 100, 1),
          precipMm: rounded(precip, 1),
          cloudCoverPct: rounded(cloud, 0),
          source: `NOAA GFS 0.25° atmospheric GRIB2 f${String(forecastHour).padStart(3, "0")}`,
        };
      });
      frames.push({ validAt: validAt.toISOString(), points: framePoints });
    }

    const total = frames.reduce((count, frame) => count + frame.points.length, 0);
    const windCovered = frames.reduce((count, frame) => count + frame.points.filter((point) => point.windKt !== null).length, 0);

    return NextResponse.json({
      provider: "NOAA / NCEP GFS GRIB2",
      product: "GFS 0.25° atmosphere: 10 m wind/gust, 2 m temp/RH, MSLP, precip, cloud",
      generatedAt: new Date().toISOString(),
      modelRun: run.cycleTime.toISOString(),
      modelCycle: `${run.date} ${run.cycle}Z`,
      gribFailures,
      totalPointCount: total,
      coveredPointCount: windCovered,
      coveragePercent: total ? Math.round((windCovered / total) * 100) : 0,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA GFS atmospheric GRIB route sampling failed." }, { status: 500 });
  }
}
