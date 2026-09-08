import { NextResponse } from "next/server";
import { getR2Object } from "../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOG_KEY = "noaa/catalog.json";

export async function GET() {
  try {
    const response = await getR2Object(CATALOG_KEY);
    if (response.status === 404) return NextResponse.json({ charts: [] });
    if (!response.ok) throw new Error(`R2 catalog read failed: ${response.status} ${await response.text()}`);

    const catalog = await response.json();
    return NextResponse.json(catalog, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { charts: [], error: error instanceof Error ? error.message : "Could not read NOAA chart catalog." },
      { status: 500 },
    );
  }
}
