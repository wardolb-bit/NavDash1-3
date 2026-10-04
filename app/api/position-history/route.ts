import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://uujlsvgromzapubtinfg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f9vBEVE5oMGl1GeLTVUFVg_7a48xwEe";
const TABLE_URL = `${SUPABASE_URL}/rest/v1/navdash_position_history`;
const MAX_AGE_MS = 30 * 60 * 60 * 1000;

type PositionHistoryEntry = {
  lat: number;
  lon: number;
  timestamp: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  receivedAt?: string;
};

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function finiteOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function GET() {
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const response = await fetch(
      `${TABLE_URL}?hour_bucket=gte.${encodeURIComponent(cutoff)}&select=hour_bucket,lat,lon,sog,cog,heading,received_at&order=hour_bucket.asc`,
      { headers: headers(), cache: "no-store" },
    );

    if (!response.ok) throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);

    const rows = await response.json();
    const entries: PositionHistoryEntry[] = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      timestamp: new Date(row.hour_bucket).getTime(),
      sog: finiteOrNull(row.sog),
      cog: finiteOrNull(row.cog),
      heading: finiteOrNull(row.heading),
      receivedAt: typeof row.received_at === "string" ? row.received_at : undefined,
    })).filter((entry: PositionHistoryEntry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lon) && Number.isFinite(entry.timestamp));

    return NextResponse.json({
      entries,
      sampleCount: entries.length,
      oldestTimestamp: entries[0]?.timestamp ?? null,
      newestTimestamp: entries[entries.length - 1]?.timestamp ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { entries: [], sampleCount: 0, error: error instanceof Error ? error.message : "Could not read position history." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const lat = Number(payload?.lat);
    const lon = Number(payload?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return NextResponse.json({ ok: false, error: "Valid live position required." }, { status: 400 });
    }

    const now = new Date();
    const hourBucket = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0,
    )).toISOString();

    const response = await fetch(`${TABLE_URL}?on_conflict=hour_bucket`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify({
        hour_bucket: hourBucket,
        lat,
        lon,
        sog: finiteOrNull(payload?.sog),
        cog: finiteOrNull(payload?.cog),
        heading: finiteOrNull(payload?.heading),
        received_at: now.toISOString(),
      }),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);

    return NextResponse.json({ ok: true, hourBucket }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save position history." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
