import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getR2Object, putR2Object } from "../../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOAA_MCS_EXPORT =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/export";

function normalizedQuery(searchParams: URLSearchParams) {
  return Array.from(searchParams.entries())
    .filter(([key]) => !key.startsWith("_"))
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function requestValue(searchParams: URLSearchParams, name: string) {
  for (const [key, value] of searchParams.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

function spatialReference(searchParams: URLSearchParams) {
  const raw = requestValue(searchParams, "crs") || requestValue(searchParams, "srs") || "EPSG:3857";
  const match = raw.match(/(\d+)$/);
  return match?.[1] || "3857";
}

function arcgisSpatialReference(sr: string) {
  const wkid = sr === "3857" ? 102100 : Number(sr) || 102100;
  return JSON.stringify({ wkid });
}

function maritimeLayers(raw: string | null) {
  const value = (raw || "1,2,3,4,5,6,7").trim();
  return value.includes(":") ? value : `show:${value}`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const operation = requestValue(params, "request");
  const service = requestValue(params, "service");

  if ((operation && operation.toLowerCase() !== "getmap") || (service && service.toLowerCase() !== "wms")) {
    return NextResponse.json({ error: "Only NOAA ENC chart-image requests are supported." }, { status: 400 });
  }

  const bbox = requestValue(params, "bbox");
  if (!bbox) return NextResponse.json({ error: "Missing chart BBOX." }, { status: 400 });

  const width = requestValue(params, "width") || "256";
  const height = requestValue(params, "height") || "256";
  const layers = maritimeLayers(requestValue(params, "layers"));
  const transparent = requestValue(params, "transparent") || "false";
  const displayParams = requestValue(params, "display_params");
  const sr = spatialReference(params);
  const arcgisSr = arcgisSpatialReference(sr);

  const cacheIdentity = new URLSearchParams();
  cacheIdentity.set("bbox", bbox);
  cacheIdentity.set("width", width);
  cacheIdentity.set("height", height);
  cacheIdentity.set("layers", layers);
  cacheIdentity.set("transparent", transparent);
  cacheIdentity.set("sr", sr);
  if (displayParams) cacheIdentity.set("display_params", displayParams);

  const query = normalizedQuery(cacheIdentity);
  const utcDay = new Date().toISOString().slice(0, 10);
  const digest = createHash("sha256").update(query).digest("hex");
  const cacheKey = `noaa/mcs-export-v2/${utcDay}/${digest}.png`;

  try {
    const cached = await getR2Object(cacheKey);
    if (cached.ok) {
      const body = await cached.arrayBuffer();
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": cached.headers.get("content-type") || "image/png",
          "cache-control": "public, max-age=86400, immutable",
          "x-navdash-enc-cache": "HIT",
          "x-navdash-enc-source": "NOAA Maritime Chart Service export",
        },
      });
    }

    if (cached.status !== 404) {
      throw new Error(`R2 ENC cache read failed: ${cached.status} ${await cached.text()}`);
    }

    const upstream = new URL(NOAA_MCS_EXPORT);
    upstream.searchParams.set("bbox", bbox);
    upstream.searchParams.set("bboxSR", arcgisSr);
    upstream.searchParams.set("imageSR", arcgisSr);
    upstream.searchParams.set("size", `${width},${height}`);
    upstream.searchParams.set("layers", layers);
    upstream.searchParams.set("transparent", transparent);
    upstream.searchParams.set("dpi", "96");
    upstream.searchParams.set("f", "image");
    if (displayParams) upstream.searchParams.set("display_params", displayParams);

    const source = await fetch(upstream, {
      cache: "no-store",
      headers: { "user-agent": "NavDash/1.3 NOAA Maritime Chart Service" },
    });

    const contentType = source.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await source.arrayBuffer());

    if (!source.ok) {
      return new NextResponse(bytes, {
        status: source.status,
        headers: { "content-type": contentType },
      });
    }

    await putR2Object(cacheKey, bytes, contentType);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, immutable",
        "x-navdash-enc-cache": "MISS",
        "x-navdash-enc-source": "NOAA Maritime Chart Service export",
        "x-navdash-enc-sr": sr,
        "x-navdash-enc-display-params": displayParams ? "forwarded" : "default",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA ENC chart request failed." },
      { status: 500 },
    );
  }
}
