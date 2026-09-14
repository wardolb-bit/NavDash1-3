import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://uujlsvgromzapubtinfg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f9vBEVE5oMGl1GeLTVUFVg_7a48xwEe";
const TABLE_URL = `${SUPABASE_URL}/rest/v1/navdash_route_state`;

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function GET() {
  try {
    const response = await fetch(
      `${TABLE_URL}?id=eq.current&select=weather_departure,weather_speed_kt&limit=1`,
      { headers: headers(), cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return NextResponse.json({
      departure: row?.weather_departure ?? null,
      speedKt: Number.isFinite(Number(row?.weather_speed_kt)) ? Number(row.weather_speed_kt) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read weather planning state." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const speedKt = Number(body?.speedKt);
    const departure = new Date(String(body?.departure || ""));
    if (!Number.isFinite(speedKt) || speedKt <= 0 || !Number.isFinite(departure.getTime())) {
      return NextResponse.json({ ok: false, error: "Valid departure and planning speed are required." }, { status: 400 });
    }

    const response = await fetch(`${TABLE_URL}?id=eq.current`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        weather_departure: departure.toISOString(),
        weather_speed_kt: speedKt,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);

    return NextResponse.json({ ok: true, departure: departure.toISOString(), speedKt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save weather planning state." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
