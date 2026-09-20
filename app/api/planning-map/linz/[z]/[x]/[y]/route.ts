import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;
  const apiKey = process.env.LINZ_API_KEY;
  const layerId = process.env.LINZ_HYDRO_LAYER_ID;

  if (!apiKey || !layerId) {
    return new NextResponse("LINZ hydrographic tiles are not configured", { status: 404 });
  }

  const url = `https://tiles-a.data-cdn.linz.govt.nz/services;key=${encodeURIComponent(apiKey)}/tiles/v4/layer=${encodeURIComponent(layerId)}/EPSG:3857/${z}/${x}/${y}.png`;

  try {
    const upstream = await fetch(url, { next: { revalidate: 86400 } });
    if (!upstream.ok) return new NextResponse("LINZ tile unavailable", { status: upstream.status });
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch {
    return new NextResponse("LINZ tile unavailable", { status: 502 });
  }
}
