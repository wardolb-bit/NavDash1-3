import { NextRequest, NextResponse } from "next/server";

const DATASET = "noaacwBLENDEDNRTcurrentsDaily";
const ERDDAP = `https://coastwatch.noaa.gov/erddap/griddap/${DATASET}.json`;

function finite(value: string | null) {
  const n = value == null ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const south = clamp(finite(q.get("south")), -89.5, 89.5);
  const north = clamp(finite(q.get("north")), -89.5, 89.5);
  const west = clamp(finite(q.get("west")), -180, 180);
  const east = clamp(finite(q.get("east")), -180, 180);

  if (![south, north, west, east].every(Number.isFinite) || north <= south || east <= west) {
    return NextResponse.json({ error: "Valid south/north/west/east bounds are required." }, { status: 400 });
  }

  const latSpan = north - south;
  const lonSpan = east - west;
  const stride = Math.max(1, Math.ceil(Math.max(latSpan, lonSpan) / 3));
  const query = [
    `u_current[(last)][(${south}):${stride}:(${north})][(${west}):${stride}:(${east})]`,
    `v_current[(last)][(${south}):${stride}:(${north})][(${west}):${stride}:(${east})]`,
  ].join(",");

  try {
    const response = await fetch(`${ERDDAP}?${encodeURIComponent(query)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "NavDash/1.3 NOAA current arrows" },
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: "NOAA current request failed." }, { status: 502 });
    }

    const table = payload?.table;
    const names: string[] = Array.isArray(table?.columnNames) ? table.columnNames : [];
    const rows: any[][] = Array.isArray(table?.rows) ? table.rows : [];
    const idx = (name: string) => names.indexOf(name);
    const latI = idx("latitude");
    const lonI = idx("longitude");
    const uI = idx("u_current");
    const vI = idx("v_current");
    const timeI = idx("time");

    if ([latI, lonI, uI, vI].some((i) => i < 0)) {
      return NextResponse.json({ error: "NOAA current response shape was unexpected." }, { status: 502 });
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
      validAt: rows.length && timeI >= 0 ? String(rows[0][timeI] || "") : "",
      units: "m/s",
      points,
    });
  } catch (error) {
    return NextResponse.json({
      error: "Unable to reach NOAA current service.",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
