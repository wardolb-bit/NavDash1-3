import { NextRequest, NextResponse } from "next/server";

const MSIL_KEY = process.env.MSIL_API_KEY || "0e83ad5d93214e04abf37c970c32b641";

const SOURCES = [
  { type: "lighthouse", url: "https://api.msil.go.jp/lights/lighthouse/v2/MapServer/1/query" },
  { type: "buoy", url: "https://api.msil.go.jp/lights/buoy/v2/MapServer/1/query" },
  { type: "beacon", url: "https://api.msil.go.jp/lights/beacon/v2/MapServer/1/query" },
  { type: "other", url: "https://api.msil.go.jp/lights/other/v2/MapServer/1/query" },
] as const;

type AtonType = (typeof SOURCES)[number]["type"];

function parseNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validBounds(west: number, south: number, east: number, north: number) {
  return west >= 122 && west <= 154 && east >= 122 && east <= 154
    && south >= 20 && south <= 47 && north >= 20 && north <= 47
    && west < east && south < north;
}

async function fetchLayer(type: AtonType, endpoint: string, bbox: string) {
  const params = new URLSearchParams({
    f: "geojson",
    where: "1=1",
    geometry: bbox,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
  });

  const response = await fetch(`${endpoint}?${params.toString()}`, {
    headers: { "Ocp-Apim-Subscription-Key": MSIL_KEY },
    next: { revalidate: 3600 },
  });

  if (!response.ok) throw new Error(`${type}:${response.status}`);
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];

  return features.map((feature: any) => ({
    type,
    lat: Number(feature?.geometry?.coordinates?.[1]),
    lon: Number(feature?.geometry?.coordinates?.[0]),
    number: String(feature?.properties?.["航路標識番号"] ?? "").trim(),
    name: String(feature?.properties?.["名称"] ?? "").trim(),
    reading: String(feature?.properties?.["読み"] ?? "").trim(),
    source: String(feature?.properties?.["出典"] ?? "海上保安庁").trim(),
  })).filter((item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

export async function GET(request: NextRequest) {
  const west = parseNumber(request.nextUrl.searchParams.get("west"));
  const south = parseNumber(request.nextUrl.searchParams.get("south"));
  const east = parseNumber(request.nextUrl.searchParams.get("east"));
  const north = parseNumber(request.nextUrl.searchParams.get("north"));

  if (west === null || south === null || east === null || north === null || !validBounds(west, south, east, north)) {
    return NextResponse.json({ error: "Valid Japan-area map bounds are required." }, { status: 400 });
  }

  const bbox = `${west},${south},${east},${north}`;
  const results = await Promise.allSettled(SOURCES.map((source) => fetchLayer(source.type, source.url, bbox)));
  const aids = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [SOURCES[index].type] : []);

  return NextResponse.json({
    aids,
    failed,
    source: "Japan Coast Guard Umi-shiru API",
    disclaimer: "This service uses information obtained via the Umi-shiru API. The Japan Coast Guard does not guarantee this service's content.",
  }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
