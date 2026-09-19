import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await context.params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new NextResponse("Invalid tile", { status: 400 });
  }

  try {
    const upstream = await fetch(`https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": "NavDash planning map" },
      next: { revalidate: 86400 },
    });
    if (!upstream.ok) return new NextResponse(null, { status: upstream.status });

    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-NavDash-Source": "OpenSeaMap seamarks",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
