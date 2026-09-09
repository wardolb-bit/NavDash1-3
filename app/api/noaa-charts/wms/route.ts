import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getR2Object, putR2Object } from "../../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOAA_WMS = "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer";
const NOAA_VISIBLE_LAYERS_WITH_OVERSCALE = "1,2,3,4,5,6,7,12";
const NOAA_DETAIL_DISPLAY_PARAMS = JSON.stringify({
  ECDISParameters: {
    DynamicParameters: {
      ParameterGroup: [
        {
          name: "DatasetDisplayRange",
          Parameter: [
            { name: "minZoom", value: 0.03 },
            { name: "maxZoom", value: 1.2 },
          ],
        },
      ],
    },
  },
});

function tunedParams(searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.set("layers", NOAA_VISIBLE_LAYERS_WITH_OVERSCALE);
  params.set("display_params", NOAA_DETAIL_DISPLAY_PARAMS);
  return params;
}

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

export async function GET(request: NextRequest) {
  const incomingParams = request.nextUrl.searchParams;
  const operation = requestValue(incomingParams, "request");
  const service = requestValue(incomingParams, "service");

  if ((operation && operation.toLowerCase() !== "getmap") || (service && service.toLowerCase() !== "wms")) {
    return NextResponse.json({ error: "Only NOAA ENC WMS GetMap requests are supported." }, { status: 400 });
  }

  const params = tunedParams(incomingParams);
  const query = normalizedQuery(params);
  if (!query) return NextResponse.json({ error: "Missing WMS query parameters." }, { status: 400 });

  const utcDay = new Date().toISOString().slice(0, 10);
  const digest = createHash("sha256").update(query).digest("hex");
  const cacheKey = `noaa/wms/${utcDay}/${digest}.png`;

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
        },
      });
    }

    if (cached.status !== 404) {
      throw new Error(`R2 ENC cache read failed: ${cached.status} ${await cached.text()}`);
    }

    const sourceUrl = `${NOAA_WMS}?${query}`;
    const source = await fetch(sourceUrl, {
      cache: "no-store",
      headers: { "user-agent": "NavDash/1.3 NOAA ENC cache" },
    });

    if (!source.ok) {
      return new NextResponse(await source.arrayBuffer(), {
        status: source.status,
        headers: { "content-type": source.headers.get("content-type") || "text/plain" },
      });
    }

    const contentType = source.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await source.arrayBuffer());
    await putR2Object(cacheKey, bytes, contentType);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, immutable",
        "x-navdash-enc-cache": "MISS",
        "x-navdash-enc-source": "NOAA Office of Coast Survey ENC Online",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA ENC cache request failed." },
      { status: 500 },
    );
  }
}
