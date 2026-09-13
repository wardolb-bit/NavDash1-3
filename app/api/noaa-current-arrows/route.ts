import { NextRequest, NextResponse } from "next/server";

const DATASET = "noaacwBLENDEDNRTcurrentsDaily";
const ERDDAP_BASE = `https://coastwatch.noaa.gov/erddap/griddap/${DATASET}`;
const LAT_MIN = -89.875;
const LON_MIN = -179.875;
const GRID_STEP = 0.25;
const LAT_SIZE = 720;
const LON_SIZE = 1440;

function finite(value: string | null) {
  const n = value == null ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function latIndex(lat: number) {
  return clamp(Math.round((lat - LAT_MIN) / GRID_STEP), 0, LAT_SIZE - 1);
}

function lonIndex(lon: number) {
  return clamp(Math.round((lon - LON_MIN) / GRID_STEP), 0, LON_SIZE - 1);
}

async function latestTimeIndex() {
  const response = await fetch(`${ERDDAP_BASE}.dds`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "NavDash/1.3 NOAA current arrows" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`NOAA DDS ${response.status}: ${text.slice(0, 180)}`);
  const match = text.match(/time\s*=\s*(\d+)\s*;/i);
  if (!match) throw new Error("Unable to determine NOAA current time dimension.");
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size < 1) throw new Error("NOAA current time dimension is invalid.");
  return size - 1;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const south = clamp(finite(q.get("south")), -89.875, 89.875);
  const north = clamp(finite(q.get("north")), -89.875, 89.875);
  const west = clamp(finite(q.get("west")), -179.875, 179.875);
  const east = clamp(finite(q.get("east")), -179.875, 179.875);

  if (![south, north, west, east].every(Number.isFinite) || north <= south || east <= west) {
    return NextResponse.json({ error: "Valid south/north/west/east bounds are required." }, { status: 400 });
  }

  const southI = latIndex(south);
  const northI = latIndex(north);
  const westI = lonIndex(west);
  const eastI = lonIndex(east);
  const spanCells = Math.max(northI - southI, eastI - westI);
  const stride = Math.max(1, Math.ceil(spanCells / 18));

  try {
    const timeI = await latestTimeIndex();
    const query = [
      `u_current[${timeI}:1:${timeI}][${southI}:${stride}:${northI}][${westI}:${stride}:${eastI}]`,
      `v_current[${timeI}:1:${timeI}][${southI}:${stride}:${northI}][${westI}:${stride}:${eastI}]`,
    ].join(",");

    const url = `${ERDDAP_BASE}.json?${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "NavDash/1.3 NOAA current arrows" },
    });

    const text = await response.text();
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json({
        error: "NOAA current service returned a non-JSON response.",
        upstreamStatus: response.status,
        detail: text.slice(0, 500),
      }, { status: 502 });
    }

    if (!response.ok) {
      return NextResponse.json({
        error: "NOAA current request failed.",
        upstreamStatus: response.status,
        detail: payload?.message || payload?.error || text.slice(0, 500),
      }, { status: 502 });
    }

    const table = payload?.table;
    const names: string[] = Array.isArray(table?.columnNames) ? table.columnNames : [];
    const rows: any[][] = Array.isArray(table?.rows) ? table.rows : [];
    const idx = (name: string) => names.indexOf(name);
    const latI = idx("latitude");
    const lonI = idx("longitude");
    const uI = idx("u_current");
    const vI = idx("v_current");
    const timeCol = idx("time");

    if ([latI, lonI, uI, vI].some((i) => i < 0)) {
      return NextResponse.json({
        error: "NOAA current response shape was unexpected.",
        columns: names,
      }, { status: 502 });
    }

    const points = rows.flatMap((row) => {
      const lat = Number(row[latI]);
      const lon = Number(row[lonI]);
      const u = Number(row[uI]);
      const v = Number(row[vI]);
      if (![lat, lon, u, v].every(Number.isFinite)) return [];
      return [{ lat, lon, u, v }];
    });

    return NextResponse.json({
      provider: "NOAA CoastWatch",
      product: "Blended Near Real Time Surface Currents",
      dataset: DATASET,
      validAt: rows.length && timeCol >= 0 ? String(rows[0][timeCol] || "") : "",
      units: "m/s",
      points,
      stride,
      grid: { southI, northI, westI, eastI, timeI },
    });
  } catch (error) {
    return NextResponse.json({
      error: "Unable to reach NOAA current service.",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
