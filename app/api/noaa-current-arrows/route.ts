import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATASET = "noaacwBLENDEDNRTcurrentsDaily";
const ERDDAP_BASE = `https://coastwatch.noaa.gov/erddap/griddap/${DATASET}`;

type ErddapJson = {
  table?: {
    columnNames?: string[];
    rows?: unknown[][];
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function latestTimestamp() {
  const response = await fetch(`${ERDDAP_BASE}.das`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "NavDash/1.3 NOAA current arrows" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`NOAA metadata ${response.status}: ${text.slice(0, 240)}`);
  const match = text.match(/time_coverage_end\s+"([^"]+)"/i);
  if (!match) throw new Error("NOAA current metadata did not include time_coverage_end.");
  return match[1];
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  let south = finite(search.get("south"));
  let north = finite(search.get("north"));
  let west = finite(search.get("west"));
  let east = finite(search.get("east"));

  if (south === null || north === null || west === null || east === null) {
    return NextResponse.json({ error: "south, north, west and east are required" }, { status: 400 });
  }

  const requestedSouth = south;
  const requestedNorth = north;
  south = clamp(Math.min(requestedSouth, requestedNorth), -89.875, 89.875);
  north = clamp(Math.max(requestedSouth, requestedNorth), -89.875, 89.875);
  west = clamp(west, -179.875, 179.875);
  east = clamp(east, -179.875, 179.875);

  if (east <= west) {
    return NextResponse.json({ error: "Dateline-spanning current view is not enabled in this preview." }, { status: 400 });
  }

  const latSpan = Math.max(0.25, north - south);
  const lonSpan = Math.max(0.25, east - west);
  const rawCells = Math.max(latSpan * 4, lonSpan * 4);
  const stride = Math.max(1, Math.ceil(rawCells / 42));

  try {
    const timestamp = await latestTimestamp();
    const q = (v: string) =>
      `${v}[(${timestamp})][(${south!.toFixed(3)}):${stride}:(${north!.toFixed(3)})][(${west!.toFixed(3)}):${stride}:(${east!.toFixed(3)})]`;
    const url = `${ERDDAP_BASE}.json?${q("u_current")},${q("v_current")}`;

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "NavDash/1.3 NOAA current arrows" },
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 800);
      console.error("NOAA current upstream failure", { status: response.status, timestamp, url, detail });
      throw new Error(`NOAA ERDDAP ${response.status}: ${detail}`);
    }

    const payload = (await response.json()) as ErddapJson;
    const names = payload.table?.columnNames || [];
    const rows = payload.table?.rows || [];
    const timeIndex = names.indexOf("time");
    const latIndex = names.indexOf("latitude");
    const lonIndex = names.indexOf("longitude");
    const uIndex = names.indexOf("u_current");
    const vIndex = names.indexOf("v_current");

    if (latIndex < 0 || lonIndex < 0 || uIndex < 0 || vIndex < 0) {
      throw new Error("NOAA current response did not contain the expected vector columns.");
    }

    const points = rows.flatMap((row) => {
      const lat = finite(row[latIndex]);
      const lon = finite(row[lonIndex]);
      const u = finite(row[uIndex]);
      const v = finite(row[vIndex]);
      if (lat === null || lon === null || u === null || v === null || Math.abs(u) > 20 || Math.abs(v) > 20) return [];
      return [{ lat, lon, u, v }];
    });

    const validAt = timeIndex >= 0 && rows.length ? String(rows[0][timeIndex] ?? timestamp) : timestamp;

    return NextResponse.json(
      {
        provider: "NOAA NESDIS CoastWatch",
        product: "Near-real-time global surface geostrophic currents",
        dataset: DATASET,
        validAt,
        stride,
        units: "m/s",
        points,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOAA surface currents unavailable";
    console.error("NOAA current API failure", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
