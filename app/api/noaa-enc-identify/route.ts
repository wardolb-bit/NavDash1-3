import { NextRequest, NextResponse } from "next/server";

const NOAA_IDENTIFY_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/identify";

function finiteNumber(value: string | null, fallback?: number) {
  const parsed = value === null ? Number.NaN : Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function longitudeNearReference(value: number, reference: number) {
  let adjusted = value;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}

function webMercator(lon: number, lat: number) {
  const x = (lon * 20037508.342789244) / 180;
  const clippedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y =
    (Math.log(Math.tan(((90 + clippedLat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.342789244 / 180);
  return { x, y };
}

async function fetchNoaaIdentify(url: string, timeoutMs: number) {
  return fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "NavDash/1.3 NOAA ENC identify" },
  });
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const lat = finiteNumber(search.get("lat"));
  const rawLon = finiteNumber(search.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(rawLon) || Math.abs(lat!) > 90) {
    return NextResponse.json({ error: "Valid lat/lon are required." }, { status: 400 });
  }

  const lon = normalizeLongitude(rawLon!);
  const rawWest = finiteNumber(search.get("west"), rawLon! - 0.2)!;
  const rawEast = finiteNumber(search.get("east"), rawLon! + 0.2)!;
  const west = longitudeNearReference(rawWest, lon);
  const east = longitudeNearReference(rawEast, lon);
  const south = finiteNumber(search.get("south"), lat! - 0.2)!;
  const north = finiteNumber(search.get("north"), lat! + 0.2)!;
  const width = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("width"), 1200)!)));
  const height = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("height"), 800)!)));
  const tolerance = Math.max(2, Math.min(24, Math.round(finiteNumber(search.get("tolerance"), 8)!)));

  const point = webMercator(lon, lat!);
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

  const url = `${NOAA_IDENTIFY_URL}?${params.toString()}`;
  let lastError: unknown;

  // NOAA's Maritime Chart Service occasionally stalls. Give the normal request a
  // short window, then retry once with a longer window before reporting failure.
  for (const timeoutMs of [8000, 18000]) {
    try {
      const response = await fetchNoaaIdentify(url, timeoutMs);
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
      lastError = error;
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!timedOut) break;
    }
  }

  const timedOut =
    lastError instanceof Error && (lastError.name === "TimeoutError" || lastError.name === "AbortError");
  return NextResponse.json(
    {
      error: timedOut ? "NOAA ENC lookup timed out after retry." : "Unable to reach NOAA ENC Online.",
      detail: lastError instanceof Error ? lastError.message : String(lastError),
    },
    { status: 502 },
  );
}
