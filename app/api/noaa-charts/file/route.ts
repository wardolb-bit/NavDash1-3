import { NextRequest, NextResponse } from "next/server";
import { getR2Object } from "../../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") || "";
  if (!key.startsWith("noaa/") || key.includes("..")) {
    return NextResponse.json({ error: "Invalid NOAA chart object key." }, { status: 400 });
  }

  try {
    const object = await getR2Object(key);
    if (!object.ok) {
      return NextResponse.json({ error: object.status === 404 ? "Chart object not found." : "Could not read chart object." }, { status: object.status });
    }

    const headers = new Headers();
    headers.set("content-type", object.headers.get("content-type") || "application/octet-stream");
    headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
    const length = object.headers.get("content-length");
    if (length) headers.set("content-length", length);

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read chart object." }, { status: 500 });
  }
}
