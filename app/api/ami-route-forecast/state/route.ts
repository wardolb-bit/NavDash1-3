import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://jvisswvllnvaicdroljr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aoiZwFyorDFcf_LyNCfhqA_acPun8X2";
const TABLE_URL = `${SUPABASE_URL}/rest/v1/navdash_ami_forecast_state`;

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function writeState(forecast: unknown) {
  const response = await fetch(TABLE_URL, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: "current", forecast, updated_at: new Date().toISOString() }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);
}

export async function GET() {
  try {
    const response = await fetch(`${TABLE_URL}?id=eq.current&select=forecast,updated_at&limit=1`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return NextResponse.json(
      {
        ok: true,
        initialized: Boolean(row),
        forecast: row?.forecast ?? null,
        updatedAt: row?.updated_at ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Shared AMI forecast could not be read." },
      { status: 502 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const forecast = body?.forecast;
    if (!forecast || forecast.version !== 1 || !Array.isArray(forecast.forecastPoints)) {
      return NextResponse.json({ ok: false, error: "Invalid AMI forecast payload." }, { status: 400 });
    }
    await writeState(forecast);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Shared AMI forecast could not be saved." },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  try {
    await writeState(null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Shared AMI forecast could not be cleared." },
      { status: 502 },
    );
  }
}
