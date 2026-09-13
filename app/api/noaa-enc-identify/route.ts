import { NextRequest, NextResponse } from "next/server";

const NOAA_IDENTIFY_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/identify";

function finiteNumber(value: string | null, fallback?: number) {
  const parsed = value === null ? Number.NaN : Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function webMercator(lon: number, lat: number) {
  const x = (lon * 20037508.342789244) / 180;
  const clippedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y =
    (Math.log(Math.tan(((90 + clippedLat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.342789244 / 180);
  return { x, y };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const lat = finiteNumber(search.get("lat"));
  const lon = finiteNumber(search.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat!) > 90 || Math.abs(lon!) > 180) {
    return NextResponse.json({ error: "Valid lat/lon are required." }, { status: 400 });
  }

  const west = finiteNumber(search.get("west"), lon! - 0.2)!;
  const south = finiteNumber(search.get("south"), lat! - 0.2)!;
  const east = finiteNumber(search.get("east"), lon! + 0.2)!;
  const north = finiteNumber(search.get("north"), lat! + 0.2)!;
  const width = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("width"), 1200)!)));
  const height = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("height"), 800)!)));
  const tolerance = Math.max(2, Math.min(24, Math.round(finiteNumber(search.get("tolerance"), 8)!)));

  const point = webMercator(lon!, lat!);
  const sw = webMercator(west, south);
  const ne = webMercator(east, north);

  const params = new URLSearchParams({
    userid: "",
    geometry: JSON.stringify({ x: point.x, y: point.y }),
    geometrytype: "esriGeometryPoint",
    sr: "102100",
    spatialreference: "102100",
    tolerance: String(tolerance),
    returngeometry: "false",
    mapextent: `${sw.x},${sw.y},${ne.x},${ne.y}`,
    imagedisplay: `${width},${height},96`,
    layers: "visible:1,2,3,4,5,6,7",
    f: "json",
  });

  try {
    const response = await fetch(`${NOAA_IDENTIFY_URL}?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "NavDash/1.3 NOAA ENC identify" },
    });

    const text = await response.text();
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "NOAA returned a non-JSON response.", upstreamStatus: response.status, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }

    if (!response.ok || payload?.error) {
      return NextResponse.json(
        { error: "NOAA ENC identify request failed.", upstreamStatus: response.status, detail: payload?.error || payload },
        { status: 502 },
      );
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    return NextResponse.json({
      source: "NOAA Office of Coast Survey ENC Online",
      queriedAt: new Date().toISOString(),
      lat,
      lon,
      results,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      {
        error: timedOut ? "NOAA ENC lookup timed out." : "Unable to reach NOAA ENC Online.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
