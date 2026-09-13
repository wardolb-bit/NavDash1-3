import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LAND_LAYERS = [
  { service: "enc_overview", layer: 93, name: "Overview.Land_Area" },
  { service: "enc_general", layer: 121, name: "General.Land_Area" },
  { service: "enc_coastal", layer: 171, name: "Coastal.Land_Area" },
  { service: "enc_harbour", layer: 233, name: "Harbor.Land_Area" },
] as const;

function finite(value: string | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function fetchLayer(
  service: string,
  layer: number,
  west: number,
  south: number,
  east: number,
  north: number,
) {
  const base = `https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/${service}/MapServer/${layer}/query`;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${west},${south},${east},${north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });

  const response = await fetch(`${base}?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
    headers: { "User-Agent": "NavDash/1.3 NOAA ENC land polygon mask" },
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${service}/${layer} ${response.status}: ${text.slice(0, 240)}`);

  const payload = JSON.parse(text);
  return Array.isArray(payload?.features) ? payload.features : [];
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const westRaw = finite(search.get("west"));
  const southRaw = finite(search.get("south"));
  const eastRaw = finite(search.get("east"));
  const northRaw = finite(search.get("north"));

  if (westRaw === null || southRaw === null || eastRaw === null || northRaw === null) {
    return NextResponse.json({ error: "west, south, east and north are required" }, { status: 400 });
  }

  const west = clamp(westRaw, -180, 180);
  const east = clamp(eastRaw, -180, 180);
  const south = clamp(Math.min(southRaw, northRaw), -85, 85);
  const north = clamp(Math.max(southRaw, northRaw), -85, 85);

  if (east <= west) {
    return NextResponse.json({ error: "Dateline-spanning ENC land masks are not enabled." }, { status: 400 });
  }

  try {
    const results = await Promise.allSettled(
      LAND_LAYERS.map((entry) => fetchLayer(entry.service, entry.layer, west, south, east, north)),
    );

    const features: any[] = [];
    const sources: string[] = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        features.push(...result.value);
        sources.push(LAND_LAYERS[index].name);
      }
    });

    if (!sources.length) {
      throw new Error("All NOAA ENC land polygon layers failed.");
    }

    return NextResponse.json(
      {
        source: "NOAA Office of Coast Survey ENC Direct",
        sources,
        bounds: { west, south, east, north },
        type: "FeatureCollection",
        features,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOAA ENC land polygons unavailable";
    console.error("NOAA ENC land polygon mask failure", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
