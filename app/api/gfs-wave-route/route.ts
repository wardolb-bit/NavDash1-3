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
type WavePoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg: number | null;
  swellHeightFt: number | null;
  swellPeriodSec: number | null;
  swellDirectionDeg: number | null;
  windWaveHeightFt: number | null;
  windWavePeriodSec: number | null;
  windWaveDirectionDeg: number | null;
  source: string;
};
type WaveFrame = { validAt: string; points: WavePoint[] };
type ModelRun = { date: string; cycle: string; cycleTime: Date };
type Bounds = { left: number; right: number; top: number; bottom: number };
type DecodedField = {
  grid: ReturnType<typeof parseGrid>;
  values: Float64Array | number[];
};
type WaveFields = {
  height: DecodedField | null;
  period: DecodedField | null;
  direction: DecodedField | null;
  swellHeight: DecodedField | null;
  swellPeriod: DecodedField | null;
  swellDirection: DecodedField | null;
  windWaveHeight: DecodedField | null;
  windWavePeriod: DecodedField | null;
  windWaveDirection: DecodedField | null;
};

type GridSample = {
  latitude: number;
  longitude: number;
  distanceNm: number;
  index: number;
};

const NOMADS = "https://nomads.ncep.noaa.gov";
const USER_AGENT = "NavDash GFS Wave GRIB route sampler (wardlab.dev)";
const M_TO_FT = 3.28084;
const MAX_VALID_SIGNIFICANT_WAVE_HEIGHT_M = 40;
const MAX_VALID_WAVE_PERIOD_SEC = 60;
const MAX_WATER_SEARCH_NM = 60;

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

function validHeight(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_VALID_SIGNIFICANT_WAVE_HEIGHT_M;
}

function validPeriod(value: number) {
  return Number.isFinite(value) && value > 0 && value <= MAX_VALID_WAVE_PERIOD_SEC;
}

function validDirection(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 360;
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function candidateRuns(now = new Date()) {
  const anchor = new Date(now);
  anchor.setUTCMinutes(0, 0, 0);
  anchor.setUTCHours(Math.floor(anchor.getUTCHours() / 6) * 6);
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
      if (text.includes(":HTSGW:") && text.includes(":PERPW:") && text.includes(":DIRPW:")) return run;
    } catch {}
  }
  throw new Error("No current NOAA GFS Wave model cycle is available from NOMADS.");
}

function routeBounds(points: Point[]): Bounds {
  const margin = 1.5;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  return {
    left: Math.max(-180, Math.min(...lons) - margin),
    right: Math.min(180, Math.max(...lons) + margin),
    top: Math.min(90, Math.max(...lats) + margin),
    bottom: Math.max(-90, Math.min(...lats) - margin),
  };
}

function filterUrl(run: ModelRun, forecastHour: number, bounds: Bounds) {
  const params = new URLSearchParams();
  params.set("file", gribFileName(run, forecastHour));
  for (const variable of ["HTSGW", "PERPW", "DIRPW", "SWELL", "SWPER", "SWDIR", "WVHGT", "WVPER", "WVDIR"]) {
    params.set(`var_${variable}`, "on");
  }
  params.set("lev_surface", "on");
  params.set("subregion", "");
  params.set("leftlon", String(bounds.left));
  params.set("rightlon", String(bounds.right));
  params.set("toplat", String(bounds.top));
  params.set("bottomlat", String(bounds.bottom));
  params.set("dir", gribDirectory(run));
  return `${NOMADS}/cgi-bin/filter_gfswave.pl?${params.toString()}`;
}

async function fetchWaveFields(run: ModelRun, forecastHour: number, bounds: Bounds): Promise<WaveFields> {
  const response = await fetch(filterUrl(run, forecastHour, bounds), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NOMADS GRIB download failed (${response.status}) for f${String(forecastHour).padStart(3, "0")}.`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") {
    throw new Error(`NOMADS returned a non-GRIB response for f${String(forecastHour).padStart(3, "0")}.`);
  }

  const result: WaveFields = {
    height: null,
    period: null,
    direction: null,
    swellHeight: null,
    swellPeriod: null,
    swellDirection: null,
    windWaveHeight: null,
    windWavePeriod: null,
    windWaveDirection: null,
  };

  for (const message of splitMessages(bytes)) {
    for (const field of parseFields(message)) {
      if (field.discipline !== 10) continue;
      const product = parseProduct(field.section4);
      if (product.parameterCategory !== 0) continue;

      const parameterMap: Record<number, keyof WaveFields> = {
        3: "height",
        4: "windWaveDirection",
        5: "windWaveHeight",
        6: "windWavePeriod",
        7: "swellDirection",
        8: "swellHeight",
        9: "swellPeriod",
        10: "direction",
        11: "period",
      };
      const target = parameterMap[product.parameterNumber];
      if (!target || result[target]) continue;

      const grid = parseGrid(field.section3);
      const { values } = decodeFieldValues(field);
      result[target] = { grid, values };
    }
  }

  if (!result.height || !result.period || !result.direction) {
    throw new Error("Downloaded GFS Wave GRIB2 is missing required HTSGW/PERPW/DIRPW fields.");
  }
  return result;
}

function candidateOffsets() {
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= 4; ring += 1) {
    const d = ring * 0.25;
    for (let x = -ring; x <= ring; x += 1) {
      offsets.push([x * 0.25, -d], [x * 0.25, d]);
    }
    for (let y = -ring + 1; y <= ring - 1; y += 1) {
      offsets.push([-d, y * 0.25], [d, y * 0.25]);
    }
  }
  return offsets;
}

const SEARCH_OFFSETS = candidateOffsets();

function findWaterCell(field: DecodedField, point: Point): GridSample | null {
  const seen = new Set<number>();
  let best: GridSample | null = null;

  for (const [dLat, dLon] of SEARCH_OFFSETS) {
    const sample = nearestGridpoint(field.grid, point.lat + dLat, point.lon + dLon);
    if (seen.has(sample.index)) continue;
    seen.add(sample.index);

    const value = Number(field.values[sample.index]);
    if (!validHeight(value)) continue;

    const distanceNm = nmBetween(point.lat, point.lon, sample.latitude, sample.longitude);
    if (distanceNm > MAX_WATER_SEARCH_NM) continue;
    if (!best || distanceNm < best.distanceNm) {
      best = {
        latitude: sample.latitude,
        longitude: sample.longitude,
        distanceNm,
        index: sample.index,
      };
    }
  }

  return best;
}

function valueAtCell(field: DecodedField | null, cell: GridSample, valid: (value: number) => boolean) {
  if (!field) return null;
  const sample = nearestGridpoint(field.grid, cell.latitude, cell.longitude);
  const value = Number(field.values[sample.index]);
  return valid(value) ? value : null;
}

function nearestValidValue(
  field: DecodedField | null,
  cell: GridSample,
  valid: (value: number) => boolean,
  maxDistanceNm = 20,
) {
  if (!field) return null;
  const direct = valueAtCell(field, cell, valid);
  if (direct !== null) return direct;

  let best: { value: number; distanceNm: number } | null = null;
  for (const [dLat, dLon] of SEARCH_OFFSETS) {
    const sample = nearestGridpoint(field.grid, cell.latitude + dLat, cell.longitude + dLon);
    const value = Number(field.values[sample.index]);
    if (!valid(value)) continue;
    const distanceNm = nmBetween(cell.latitude, cell.longitude, sample.latitude, sample.longitude);
    if (distanceNm > maxDistanceNm) continue;
    if (!best || distanceNm < best.distanceNm) best = { value, distanceNm };
  }
  return best?.value ?? null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const points: Point[] = (Array.isArray(body?.points) ? body.points : [])
      .map((p: any) => ({ lat: Number(p?.lat), lon: Number(p?.lon), distanceNm: Number(p?.distanceNm) }))
      .filter((p: Point) =>
        Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.distanceNm) &&
        Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
      );

    const validTimes = (Array.isArray(body?.validTimes) ? body.validTimes : [])
      .map((value: unknown) => new Date(String(value)))
      .filter((date: Date) => Number.isFinite(date.getTime()));

    if (points.length < 2 || !validTimes.length) {
      return NextResponse.json({ error: "Wave request requires route points and forecast valid times." }, { status: 400 });
    }

    const run = await latestModelRun();
    const bounds = routeBounds(points);
    const frames: WaveFrame[] = [];
    let gribFailures = 0;

    for (const validAt of validTimes) {
      const rawHour = Math.round((validAt.getTime() - run.cycleTime.getTime()) / 3600000);
      const forecastHour = Math.max(0, Math.min(120, rawHour));

      let fields: WaveFields | null = null;
      try {
        fields = await fetchWaveFields(run, forecastHour, bounds);
      } catch {
        gribFailures += 1;
      }

      const resultPoints = points.map((point): WavePoint => {
        if (!fields?.height) {
          return {
            ...point,
            waveHeightFt: null,
            wavePeriodSec: null,
            waveDirectionDeg: null,
            swellHeightFt: null,
            swellPeriodSec: null,
            swellDirectionDeg: null,
            windWaveHeightFt: null,
            windWavePeriodSec: null,
            windWaveDirectionDeg: null,
            source: "NOAA GFS Wave GRIB2 unavailable for this forecast hour",
          };
        }

        const cell = findWaterCell(fields.height, point);
        if (!cell) {
          return {
            ...point,
            waveHeightFt: null,
            wavePeriodSec: null,
            waveDirectionDeg: null,
            swellHeightFt: null,
            swellPeriodSec: null,
            swellDirectionDeg: null,
            windWaveHeightFt: null,
            windWavePeriodSec: null,
            windWaveDirectionDeg: null,
            source: "NOAA GFS Wave GRIB2 has no valid ocean cell within 60 NM",
          };
        }

        const heightM = Number(fields.height.values[cell.index]);
        const periodSec = nearestValidValue(fields.period, cell, validPeriod);
        const directionDeg = nearestValidValue(fields.direction, cell, validDirection);
        const swellHeightM = nearestValidValue(fields.swellHeight, cell, validHeight);
        const swellPeriodSec = nearestValidValue(fields.swellPeriod, cell, validPeriod);
        const swellDirectionDeg = nearestValidValue(fields.swellDirection, cell, validDirection);
        const windWaveHeightM = nearestValidValue(fields.windWaveHeight, cell, validHeight);
        const windWavePeriodSec = nearestValidValue(fields.windWavePeriod, cell, validPeriod);
        const windWaveDirectionDeg = nearestValidValue(fields.windWaveDirection, cell, validDirection);

        return {
          ...point,
          waveHeightFt: rounded(heightM * M_TO_FT, 1),
          wavePeriodSec: rounded(periodSec, 0),
          waveDirectionDeg: rounded(directionDeg, 0),
          swellHeightFt: rounded(swellHeightM === null ? null : swellHeightM * M_TO_FT, 1),
          swellPeriodSec: rounded(swellPeriodSec, 0),
          swellDirectionDeg: rounded(swellDirectionDeg, 0),
          windWaveHeightFt: rounded(windWaveHeightM === null ? null : windWaveHeightM * M_TO_FT, 1),
          windWavePeriodSec: rounded(windWavePeriodSec, 0),
          windWaveDirectionDeg: rounded(windWaveDirectionDeg, 0),
          source: `NOAA GFS Wave GRIB2 f${String(forecastHour).padStart(3, "0")} ocean cell ${cell.distanceNm.toFixed(1)} NM from route sample`,
        };
      });

      frames.push({ validAt: validAt.toISOString(), points: resultPoints });
    }

    const allPoints = frames.flatMap((frame) => frame.points);
    const total = allPoints.length;
    const populated = allPoints.filter((point) => point.waveHeightFt !== null).length;
    const periodPopulated = allPoints.filter((point) => point.wavePeriodSec !== null).length;
    const directionPopulated = allPoints.filter((point) => point.waveDirectionDeg !== null).length;

    return NextResponse.json({
      provider: "NOAA / NCEP GFS Wave GRIB2",
      product: "GFS Wave 0.25° complete sea state: HTSGW/PERPW/DIRPW + swell + wind waves",
      generatedAt: new Date().toISOString(),
      modelRun: run.cycleTime.toISOString(),
      modelCycle: `${run.date} ${run.cycle}Z`,
      gribFailures,
      populatedPointCount: populated,
      wavePeriodPointCount: periodPopulated,
      waveDirectionPointCount: directionPopulated,
      totalPointCount: total,
      coveragePercent: total ? Math.round((populated / total) * 100) : 0,
      periodCoveragePercent: total ? Math.round((periodPopulated / total) * 100) : 0,
      directionCoveragePercent: total ? Math.round((directionPopulated / total) * 100) : 0,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA GFS Wave GRIB route sampling failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
