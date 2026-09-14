import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOAA_MCS_EXPORT =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/export";

function value(params: URLSearchParams, name: string) {
  for (const [key, val] of params.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) return val;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bbox = value(params, "bbox");
  const width = value(params, "width") || "256";
  const height = value(params, "height") || "256";
  const layers = value(params, "layers") || "1,2,3,4,5,6,7,12";
  const displayParams = value(params, "display_params");
  const transparent = value(params, "transparent") || "false";

  if (!bbox) {
    return NextResponse.json({ error: "Missing chart BBOX." }, { status: 400 });
  }

  const upstream = new URL(NOAA_MCS_EXPORT);
  upstream.searchParams.set("bbox", bbox);
  upstream.searchParams.set("size", `${width},${height}`);
  upstream.searchParams.set("layers", layers);
  upstream.searchParams.set("transparent", transparent);
  upstream.searchParams.set("dpi", "96");
  upstream.searchParams.set("forcecharts", "true");
  upstream.searchParams.set("f", "image");
  if (displayParams) upstream.searchParams.set("display_params", displayParams);

  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      headers: { "user-agent": "NavDash/1.3 NOAA Maritime Chart Service" },
    });

    const body = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/png";

    if (!response.ok) {
      return new NextResponse(body, {
        status: response.status,
        headers: { "content-type": contentType },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store, max-age=0",
        "x-navdash-enc-source": "NOAA Maritime Chart Service export",
        "x-navdash-enc-display-params": displayParams ? "forwarded" : "default",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA Maritime Chart export failed." },
      { status: 500 },
    );
  }
}
