import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type SampleRecord = {
  valid: string;
  element: string;
  level: string;
  forecast: string;
  value: number;
  sampleLat: number | null;
  sampleLon: number | null;
};

type ForecastTimelineRow = {
  label: string;
  valid: string;
  forecast: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  pressureHpa: number | null;
  tempC: number | null;
};

type RouteWaypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type RouteForecastPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  worstWindKt: number | null;
  worstGustKt: number | null;
  worstSeasFt: number | null;
  worstSwellFt: number | null;
  worstSwellPeriod: number | null;
  worstValid: string;
  timeline: ForecastTimelineRow[];
};

type RouteForecast = {
  routeName: string;
  sampledPoints: number;
  routePoints: RouteForecastPoint[];
  worstWindPoint: RouteForecastPoint | null;
  worstSeasPoint: RouteForecastPoint | null;
};

type GribOverlayPoint = {
  lat: number;
  lon: number;
  label: string;
  valid: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  routePoint?: string;
  timeline?: ForecastTimelineRow[];
};

type IsobarGridPoint = {
  lat: number;
  lon: number;
  timeline: ForecastTimelineRow[];
};

type PersistedGribSummary = {
  hasGrib: true;
  fileName: string;
  fileSize: number;
  loadedAt: string;
  status: string;
  summary: string;
  sourceNotes: string;
  inventoryPreview: string;
  timeline: ForecastTimelineRow[];
  overlayPoints: GribOverlayPoint[];
  routeForecast: RouteForecast | null;
  isobarGrid: IsobarGridPoint[];
  savedFileName: string;
};

function gribDataDir() {
  return path.join(process.env.NAVDASH_DATA_DIR || path.join(process.cwd(), "data"), "grib");
}

function gribSummaryPath() {
  return path.join(gribDataDir(), "current-grib-summary.json");
}

function routeStatePath() {
  return process.env.NAV_ROUTE_STATE_PATH || path.join(process.env.NAVDASH_DATA_DIR || path.join(process.cwd(), "data"), "loaded-route.json");
}

async function savePersistedGrib(buffer: Buffer, safeName: string, summary: PersistedGribSummary) {
  const dir = gribDataDir();
  await fs.mkdir(dir, { recursive: true });

  const savedFileName = `current-grib${path.extname(safeName) || ".grb2"}`;
  const savedFilePath = path.join(dir, savedFileName);
  const nextSummary = { ...summary, savedFileName };

  await fs.writeFile(savedFilePath, buffer);
  await fs.writeFile(gribSummaryPath(), JSON.stringify(nextSummary, null, 2), "utf8");

  return nextSummary;
}

async function clearPersistedGrib() {
  const dir = gribDataDir();

  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name === "current-grib-summary.json" || name.startsWith("current-grib."))
        .map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)),
    );
  } catch {
    // Nothing saved yet.
  }
}

async function loadRouteState(): Promise<{ routeName: string; waypoints: RouteWaypoint[]; activeWaypointIndex: number } | null> {
  try {
    const raw = await fs.readFile(routeStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    const waypoints = Array.isArray(parsed?.waypoints)
      ? parsed.waypoints
          .map((point: any, index: number) => ({
            id: String(point?.id || index + 1),
            name: String(point?.name || point?.id || `WPT ${index + 1}`),
            lat: Number(point?.lat),
            lon: Number(point?.lon),
          }))
          .filter((point: RouteWaypoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      : [];

    if (waypoints.length < 2) return null;

    const activeWaypointIndex = Number.isFinite(Number(parsed?.activeWaypointIndex))
      ? Math.max(1, Math.min(Math.round(Number(parsed.activeWaypointIndex)), waypoints.length - 1))
      : 1;

    return {
      routeName: typeof parsed?.routeName === "string" && parsed.routeName.trim()
        ? parsed.routeName.trim()
        : "Loaded Route",
      waypoints,
      activeWaypointIndex,
    };
  } catch {
    return null;
  }
}

function selectRouteSamplePoints(route: { waypoints: RouteWaypoint[]; activeWaypointIndex: number }) {
  const startIndex = Math.max(0, route.activeWaypointIndex - 1);
  const remaining = route.waypoints.slice(startIndex);
  if (remaining.length <= 10) return remaining;

  const selected = new Map<number, RouteWaypoint>();
  selected.set(0, remaining[0]);
  selected.set(remaining.length - 1, remaining[remaining.length - 1]);

  const step = (remaining.length - 1) / 8;
  for (let i = 1; i <= 8; i += 1) {
    const index = Math.round(i * step);
    selected.set(index, remaining[index]);
  }

  return Array.from(selected.entries())
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point);
}

function findWgrib2Path() {
  const candidates = [
    process.env.WGRIB2_PATH,
    path.join(process.cwd(), "tools", "wgrib2", "wgrib2.exe"),
    path.join(process.cwd(), "tools", "wgrib2.exe"),
    path.join(process.cwd(), "wgrib2.exe"),
    "wgrib2",
  ].filter(Boolean) as string[];

  return candidates;
}

async function runFirstAvailableWgrib2(args: string[]) {
  const candidates = findWgrib2Path();
  let lastError = "";

  for (const exe of candidates) {
    try {
      const result = await execFileAsync(exe, args, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 20,
        windowsHide: true,
      });

      return {
        exe,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    `wgrib2 was not found or could not read this file. Put wgrib2.exe at tools/wgrib2/wgrib2.exe or set WGRIB2_PATH. Last error: ${lastError}`
  );
}

function parseValidTime(raw: string) {
  const match = raw.match(/d=(\d{10})/);
  if (!match) return "";

  const text = match[1];
  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  const hour = text.slice(8, 10);

  return `${year}-${month}-${day} ${hour}:00 UTC`;
}

function parseForecastLabel(parts: string[]) {
  const forecast = parts[5] || "";
  if (!forecast || forecast === "anl") return "analysis";
  return forecast;
}

function parseSampleOutput(text: string): SampleRecord[] {
  const records: SampleRecord[] = [];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(":");
    if (parts.length < 5) continue;

    const valueMatch = line.match(/\bval=([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
    if (!valueMatch) continue;

    const value = Number(valueMatch[1]);
    if (!Number.isFinite(value)) continue;

    const lonMatch = line.match(/\blon=([-+]?\d+(?:\.\d+)?)/);
    const latMatch = line.match(/\blat=([-+]?\d+(?:\.\d+)?)/);
    const sampleLon = lonMatch ? Number(lonMatch[1]) : null;
    const sampleLat = latMatch ? Number(latMatch[1]) : null;

    records.push({
      valid: parseValidTime(line),
      element: parts[3] || "",
      level: parts[4] || "",
      forecast: parseForecastLabel(parts),
      value,
      sampleLat: Number.isFinite(sampleLat) && sampleLat !== 999 ? sampleLat : null,
      sampleLon: Number.isFinite(sampleLon) && sampleLon !== 999 ? sampleLon : null,
    });
  }

  return records;
}

async function buildOverlayPoints(tmpFile: string, lat: number, lon: number): Promise<GribOverlayPoint[]> {
  const offsets = [-0.5, -0.25, 0, 0.25, 0.5];
  const points = offsets.flatMap(latOffset =>
    offsets.map(lonOffset => ({
      lat: Number((lat + latOffset).toFixed(4)),
      lon: Number((lon + lonOffset).toFixed(4)),
    }))
  );
  const byGridPoint = new Map<string, GribOverlayPoint>();

  for (const point of points) {
    try {
      const sampled = await runFirstAvailableWgrib2([
        tmpFile,
        "-s",
        "-lon",
        String(point.lon),
        String(point.lat),
      ]);
      const records = parseSampleOutput(sampled.stdout);
      const result = summarizeSamples(records, point.lat, point.lon);
      const row = result.timeline[0];
      const gridRecord = records.find(record => record.sampleLat !== null && record.sampleLon !== null);

      if (!row || !gridRecord?.sampleLat || !gridRecord.sampleLon) continue;
      if (row.windKt === null && row.gustKt === null && row.seasFt === null) continue;

      const key = `${gridRecord.sampleLat.toFixed(3)},${gridRecord.sampleLon.toFixed(3)}`;
      byGridPoint.set(key, {
        lat: gridRecord.sampleLat,
        lon: gridRecord.sampleLon,
        label: row.label,
        valid: row.valid,
        windKt: row.windKt,
        windDir: row.windDir,
        gustKt: row.gustKt,
        seasFt: row.seasFt,
        swellFt: row.swellFt,
        swellPeriod: row.swellPeriod,
        timeline: result.timeline,
      });
    } catch {
      // Some nearby requested points may sit outside the GRIB domain.
    }
  }

  return Array.from(byGridPoint.values()).slice(0, 25);
}

function normalizeLon(lon: number) {
  let next = lon;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function unwrapLonNear(lon: number, referenceLon: number) {
  let next = lon;
  while (next - referenceLon > 180) next -= 360;
  while (next - referenceLon < -180) next += 360;
  return next;
}

function localPressureGridBounds(lat: number, lon: number, marginDeg: number) {
  return {
    minLat: Math.max(-85, lat - marginDeg),
    maxLat: Math.min(85, lat + marginDeg),
    minLon: lon - marginDeg,
    maxLon: lon + marginDeg,
  };
}

function pressureGridBounds(route: { waypoints: RouteWaypoint[]; activeWaypointIndex: number } | null, lat: number, lon: number) {
  if (!route?.waypoints?.length) return localPressureGridBounds(lat, lon, 0.75);

  const points = route?.waypoints?.length
    ? route.waypoints.slice(Math.max(0, route.activeWaypointIndex - 1))
    : [{ lat, lon }];
  const lats = points.map((point) => point.lat).filter(Number.isFinite);
  const lons: number[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.lon)) continue;
    const referenceLon = lons.length ? lons[lons.length - 1] : point.lon;
    lons.push(unwrapLonNear(point.lon, referenceLon));
  }

  if (!lats.length || !lons.length) return null;

  const minLat = Math.max(-85, Math.min(...lats) - 2);
  const maxLat = Math.min(85, Math.max(...lats) + 2);
  const minLon = Math.min(...lons) - 2;
  const maxLon = Math.max(...lons) + 2;

  return { minLat, maxLat, minLon, maxLon };
}

async function buildIsobarGrid(
  tmpFile: string,
  lat: number,
  lon: number,
  route: { waypoints: RouteWaypoint[]; activeWaypointIndex: number } | null,
): Promise<IsobarGridPoint[]> {
  const bounds = pressureGridBounds(route, lat, lon);
  if (!bounds) return [];
  const grid = await sampleIsobarBounds(tmpFile, bounds);
  if (grid.length >= 9 || !route) return grid;

  const widerLocalGrid = await sampleIsobarBounds(tmpFile, localPressureGridBounds(lat, lon, 2));
  if (widerLocalGrid.length >= 9) return widerLocalGrid;

  const tighterLocalGrid = await sampleIsobarBounds(tmpFile, localPressureGridBounds(lat, lon, 0.75));
  return tighterLocalGrid.length > widerLocalGrid.length ? tighterLocalGrid : widerLocalGrid;
}

async function sampleIsobarBounds(
  tmpFile: string,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
): Promise<IsobarGridPoint[]> {
  const gridSize = 9;
  const latSpan = Math.max(1, bounds.maxLat - bounds.minLat);
  const lonSpan = Math.max(1, bounds.maxLon - bounds.minLon);
  const points: Array<{ lat: number; lon: number }> = [];

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const pointLon = bounds.minLon + (lonSpan * x) / (gridSize - 1);
      points.push({
        lat: Number((bounds.minLat + (latSpan * y) / (gridSize - 1)).toFixed(4)),
        lon: Number(pointLon.toFixed(4)),
      });
    }
  }

  const grid: IsobarGridPoint[] = [];
  for (const point of points) {
    try {
      const result = await sampleGribPoint(tmpFile, point.lat, normalizeLon(point.lon));
      if (result.timeline.some((row) => row.pressureHpa !== null)) {
        grid.push({
          lat: point.lat,
          lon: point.lon,
          timeline: result.timeline,
        });
      }
    } catch {
      // Individual pressure samples may fall outside a GRIB domain.
    }
  }

  return grid;
}

function worstByWind(rows: ForecastTimelineRow[]) {
  return rows.reduce<ForecastTimelineRow | null>((best, row) => {
    const rowValue = row.gustKt ?? row.windKt ?? -1;
    const bestValue = best ? best.gustKt ?? best.windKt ?? -1 : -1;
    return rowValue > bestValue ? row : best;
  }, null);
}

function worstBySeas(rows: ForecastTimelineRow[]) {
  return rows.reduce<ForecastTimelineRow | null>((best, row) => {
    const rowValue = row.seasFt ?? -1;
    const bestValue = best ? best.seasFt ?? -1 : -1;
    return rowValue > bestValue ? row : best;
  }, null);
}

function routePointRisk(point: RouteForecastPoint) {
  const gust = point.worstGustKt ?? point.worstWindKt ?? 0;
  const seas = point.worstSeasFt ?? 0;
  if (gust >= 35 || seas >= 12) return "RED";
  if (gust >= 25 || seas >= 8) return "AMBER";
  return "NORMAL";
}

async function sampleGribPoint(tmpFile: string, lat: number, lon: number) {
  const sampled = await runFirstAvailableWgrib2([
    tmpFile,
    "-s",
    "-lon",
    String(lon),
    String(lat),
  ]);

  const records = parseSampleOutput(sampled.stdout);
  return summarizeSamples(records, lat, lon);
}

async function buildRouteForecast(tmpFile: string): Promise<RouteForecast | null> {
  const route = await loadRouteState();
  if (!route) return null;

  const routePoints: RouteForecastPoint[] = [];
  const points = selectRouteSamplePoints(route);

  for (const point of points) {
    try {
      const result = await sampleGribPoint(tmpFile, point.lat, point.lon);
      const windRow = worstByWind(result.timeline);
      const seasRow = worstBySeas(result.timeline);
      const valid = seasRow?.valid || windRow?.valid || result.timeline[0]?.valid || "";

      routePoints.push({
        id: point.id,
        name: point.name,
        lat: point.lat,
        lon: point.lon,
        worstWindKt: windRow?.windKt ?? null,
        worstGustKt: windRow?.gustKt ?? null,
        worstSeasFt: seasRow?.seasFt ?? null,
        worstSwellFt: seasRow?.swellFt ?? null,
        worstSwellPeriod: seasRow?.swellPeriod ?? null,
        worstValid: valid,
        timeline: result.timeline,
      });
    } catch {
      routePoints.push({
        id: point.id,
        name: point.name,
        lat: point.lat,
        lon: point.lon,
        worstWindKt: null,
        worstGustKt: null,
        worstSeasFt: null,
        worstSwellFt: null,
        worstSwellPeriod: null,
        worstValid: "",
        timeline: [],
      });
    }
  }

  const usable = routePoints.filter((point) => point.timeline.length);
  const worstWindPoint = usable.reduce<RouteForecastPoint | null>((best, point) => {
    const pointValue = point.worstGustKt ?? point.worstWindKt ?? -1;
    const bestValue = best ? best.worstGustKt ?? best.worstWindKt ?? -1 : -1;
    return pointValue > bestValue ? point : best;
  }, null);
  const worstSeasPoint = usable.reduce<RouteForecastPoint | null>((best, point) => {
    const pointValue = point.worstSeasFt ?? -1;
    const bestValue = best ? best.worstSeasFt ?? -1 : -1;
    return pointValue > bestValue ? point : best;
  }, null);

  return {
    routeName: route.routeName,
    sampledPoints: routePoints.length,
    routePoints,
    worstWindPoint,
    worstSeasPoint,
  };
}

function routeForecastOverlayPoints(routeForecast: RouteForecast | null): GribOverlayPoint[] {
  if (!routeForecast) return [];

  return routeForecast.routePoints
    .filter((point) => point.timeline.length)
    .map((point) => ({
      lat: point.lat,
      lon: point.lon,
      label: [
        `${point.id} ${point.name}`.trim(),
        `G ${point.worstGustKt?.toFixed(0) ?? "--"} kt`,
        `S ${point.worstSeasFt?.toFixed(1) ?? "--"} ft`,
      ].join("\n"),
      valid: point.worstValid,
      windKt: point.worstWindKt,
      windDir: null,
      gustKt: point.worstGustKt,
      seasFt: point.worstSeasFt,
      swellFt: point.worstSwellFt,
      swellPeriod: point.worstSwellPeriod,
      routePoint: `${point.id} ${point.name}`.trim(),
      timeline: point.timeline,
    }));
}

function degFromUV(u: number, v: number) {
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}

function kt(ms: number) {
  return ms * 1.94384;
}

function ft(m: number) {
  return m * 3.28084;
}

function validModelValue(value: number) {
  return Number.isFinite(value) && Math.abs(value) < 1e10;
}

function validWindMs(value: number) {
  return validModelValue(value) && Math.abs(value) < 125;
}

function validWaveM(value: number) {
  return validModelValue(value) && value >= 0 && value < 50;
}

function validPeriodSec(value: number) {
  return validModelValue(value) && value >= 0 && value < 40;
}

function validPressurePa(value: number) {
  return validModelValue(value) && value > 80000 && value < 110000;
}

function validTemperature(value: number) {
  return validModelValue(value) && value > 150 && value < 350;
}

function celsius(value: number) {
  if (value > 150) return value - 273.15;
  return value;
}

function formatTime(value: string) {
  return value || "unknown time";
}

function formatForecastStep(forecast: string) {
  if (!forecast || forecast === "analysis") return "Analysis";
  const match = forecast.match(/^(\d+)\s+hour/i);
  if (match) return `+${match[1]} hr`;
  return forecast;
}

function forecastHours(forecast: string) {
  const match = forecast.match(/^(\d+)\s+hour/i);
  return match ? Number(match[1]) : 0;
}

function addForecastHours(valid: string, forecast: string) {
  const match = valid.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00 UTC$/);
  if (!match) return valid;

  const [, year, month, day, hour] = match;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) + forecastHours(forecast),
  ));

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:00 UTC`;
}

function cleanNumber(value: number) {
  return Number.isFinite(value) ? value : null;
}

function summarizeSamples(records: SampleRecord[], lat?: number, lon?: number) {
  const byTime = new Map<string, { valid: string; forecast: string; values: Record<string, number> }>();

  for (const record of records) {
    const key = `${record.valid || "unknown"} ${record.forecast || ""}`.trim();
    const bucket = byTime.get(key) || {
      valid: record.valid || "unknown",
      forecast: record.forecast || "analysis",
      values: {},
    };
    bucket.values[record.element] = record.value;
    byTime.set(key, bucket);
  }

  const timeRows = Array.from(byTime.values())
    .map(({ valid, forecast, values }) => {
      const validTime = addForecastHours(valid, forecast);
      const u = values.UGRD;
      const v = values.VGRD;
      const windKt = validWindMs(u) && validWindMs(v)
        ? kt(Math.sqrt(u * u + v * v))
        : NaN;
      const windDir = validWindMs(u) && validWindMs(v) ? degFromUV(u, v) : NaN;

      return {
        label: formatForecastStep(forecast),
        valid: validTime,
        forecast,
        windKt,
        windDir,
        gustKt: validWindMs(values.GUST) ? kt(values.GUST) : NaN,
        seasFt: validWaveM(values.HTSGW) ? ft(values.HTSGW) : NaN,
        swellFt: validWaveM(values.SWELL) ? ft(values.SWELL) : NaN,
        swellPeriod: validPeriodSec(values.SWPER) ? values.SWPER : NaN,
        pressureHpa: validPressurePa(values.PRMSL) ? values.PRMSL / 100 : NaN,
        tempC: validTemperature(values.TMP) ? celsius(values.TMP) : NaN,
      };
    })
    .filter(row =>
      Number.isFinite(row.windKt) ||
      Number.isFinite(row.gustKt) ||
      Number.isFinite(row.seasFt)
    );

  if (!timeRows.length) {
    return {
      summary:
        "GRIB loaded and inventoried, but no point-sample wind/sea values could be extracted from the available fields.",
      sourceNotes: "GRIB parser: wgrib2 inventory loaded; point values unavailable.",
      timeline: [] as ForecastTimelineRow[],
    };
  }

  const worstWind = timeRows.reduce((best, row) =>
    (row.gustKt || row.windKt || 0) > (best.gustKt || best.windKt || 0) ? row : best
  , timeRows[0]);

  const worstSeas = timeRows.reduce((best, row) =>
    (row.seasFt || 0) > (best.seasFt || 0) ? row : best
  , timeRows[0]);

  const windValues = timeRows.map(row => row.windKt).filter(Number.isFinite);
  const gustValues = timeRows.map(row => row.gustKt).filter(Number.isFinite);
  const seaValues = timeRows.map(row => row.seasFt).filter(Number.isFinite);
  const pressureValues = timeRows.map(row => row.pressureHpa).filter(Number.isFinite);
  const timeline: ForecastTimelineRow[] = timeRows.map(row => ({
    label: row.label,
    valid: row.valid,
    forecast: row.forecast,
    windKt: cleanNumber(row.windKt),
    windDir: cleanNumber(row.windDir),
    gustKt: cleanNumber(row.gustKt),
    seasFt: cleanNumber(row.seasFt),
    swellFt: cleanNumber(row.swellFt),
    swellPeriod: cleanNumber(row.swellPeriod),
    pressureHpa: cleanNumber(row.pressureHpa),
    tempC: cleanNumber(row.tempC),
  }));

  const minMax = (values: number[]) => {
    if (!values.length) return "--";
    return `${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)}`;
  };

  const sampledAt = Number.isFinite(lat) && Number.isFinite(lon)
    ? `Sample point: ${lat!.toFixed(4)} deg, ${lon!.toFixed(4)} deg.`
    : "Sample point: GRIB/default point extraction.";

  const seasLines = seaValues.length
    ? [
        "Worst seas period:",
        `- ${formatTime(worstSeas.valid)}`,
        Number.isFinite(worstSeas.seasFt) ? `- Combined seas ${worstSeas.seasFt.toFixed(1)} ft` : "",
        Number.isFinite(worstSeas.swellFt) ? `- Swell ${worstSeas.swellFt.toFixed(1)} ft` : "",
        Number.isFinite(worstSeas.swellPeriod) ? `- Swell period ${worstSeas.swellPeriod.toFixed(1)} sec` : "",
      ]
    : ["Seas:", "- No valid wave/seas values found at this sample point in this GRIB."];

  const lines = [
    "GRIB weather summary",
    sampledAt,
    "",
    `Forecast times sampled: ${timeRows.length}`,
    `Wind range: ${minMax(windValues)} kt`,
    `Gust range: ${minMax(gustValues)} kt`,
    `Combined seas range: ${minMax(seaValues)} ft`,
    pressureValues.length ? `Pressure range: ${minMax(pressureValues)} hPa` : "",
    "",
    "Worst wind/gust period:",
    `- ${formatTime(worstWind.valid)}`,
    Number.isFinite(worstWind.windKt)
      ? `- Wind ${worstWind.windKt.toFixed(1)} kt from ${String(Math.round(worstWind.windDir)).padStart(3, "0")} deg true`
      : "",
    Number.isFinite(worstWind.gustKt) ? `- Gust ${worstWind.gustKt.toFixed(1)} kt` : "",
    "",
    ...seasLines,
    "",
    "Operational read:",
    "- Use this as model guidance only; compare against official coastal/offshore forecast before sailing.",
  ].filter(Boolean);

  return {
    summary: lines.join("\n"),
    timeline,
    sourceNotes:
      "GRIB source: uploaded model file parsed by local NavDash server using wgrib2. Treat as model guidance and cross-check against official forecast products.",
  };
}

export async function POST(request: Request) {
  let tmpFile = "";

  try {
    const form = await request.formData();
    const file = form.get("file");
    const latRaw = Number(form.get("lat"));
    const lonRaw = Number(form.get("lon"));

    if (!(file instanceof File)) {
      return Response.json({ error: "No GRIB file was uploaded." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    tmpFile = path.join(os.tmpdir(), `navdash-grib-${Date.now()}-${safeName}`);

    await fs.writeFile(tmpFile, buffer);

    const inventoryResult = await runFirstAvailableWgrib2([tmpFile, "-s"]);
    const inventoryPreview = inventoryResult.stdout
      .split(/\r?\n/)
      .slice(0, 40)
      .join("\n");

    let summary = "";
    let sourceNotes = "";
    let timeline: ForecastTimelineRow[] = [];
    let overlayPoints: GribOverlayPoint[] = [];
    let routeForecast: RouteForecast | null = null;
    let isobarGrid: IsobarGridPoint[] = [];
    let status = `GRIB loaded with ${inventoryResult.exe}.`;

    if (Number.isFinite(latRaw) && Number.isFinite(lonRaw)) {
      const sampled = await runFirstAvailableWgrib2([
        tmpFile,
        "-s",
        "-lon",
        String(lonRaw),
        String(latRaw),
      ]);

      const records = parseSampleOutput(sampled.stdout);
      const result = summarizeSamples(records, latRaw, lonRaw);
      const routeState = await loadRouteState();
      summary = result.summary;
      sourceNotes = result.sourceNotes;
      timeline = result.timeline;
      routeForecast = await buildRouteForecast(tmpFile);
      isobarGrid = await buildIsobarGrid(tmpFile, latRaw, lonRaw, routeState);
      overlayPoints = [
        ...routeForecastOverlayPoints(routeForecast),
        ...(await buildOverlayPoints(tmpFile, latRaw, lonRaw)),
      ].slice(0, 35);
      status = routeForecast
        ? `GRIB sampled at active position, ${routeForecast.sampledPoints} route points, and ${isobarGrid.length} pressure grid points using ${sampled.exe}.`
        : `GRIB sampled at active position and ${isobarGrid.length} pressure grid points using ${sampled.exe}.`;
    } else {
      summary =
        "GRIB loaded and inventoried. Load a route and confirm AIS position before loading the GRIB to sample weather along the route.";
      sourceNotes =
        "GRIB source: uploaded model file. Position was not available, so only inventory was loaded.";
      timeline = [];
      overlayPoints = [];
      routeForecast = null;
      isobarGrid = [];
    }

    const loadedAt = new Date().toISOString();
    const persisted = await savePersistedGrib(buffer, safeName, {
      hasGrib: true,
      fileName: file.name,
      fileSize: file.size,
      loadedAt,
      status,
      summary,
      sourceNotes,
      timeline,
      overlayPoints,
      routeForecast,
      isobarGrid,
      inventoryPreview,
      savedFileName: "",
    });

    return Response.json(persisted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (tmpFile) {
      try {
        await fs.unlink(tmpFile);
      } catch {
        // Temp cleanup only.
      }
    }
  }
}

export async function GET() {
  try {
    const raw = await fs.readFile(gribSummaryPath(), "utf8");
    const summary = JSON.parse(raw);

    return Response.json({ hasGrib: true, ...summary });
  } catch {
    return Response.json({ hasGrib: false });
  }
}

export async function DELETE() {
  await clearPersistedGrib();
  return Response.json({ ok: true, hasGrib: false });
}
