import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://jvisswvllnvaicdroljr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aoiZwFyorDFcf_LyNCfhqA_acPun8X2";
const SESSION_COOKIE = "navdash-device-token-v1";

function supabaseHeaders() {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Device access RPC failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function deviceToken(request: NextRequest) {
  return request.headers.get("x-navdash-device-token")?.trim() || request.cookies.get(SESSION_COOKIE)?.value?.trim() || "";
}

function withSession(response: NextResponse, token: string) {
  if (!token) return response;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const token = deviceToken(request);
    const action = request.nextUrl.searchParams.get("action");

    if (action === "list") {
      const devices = await rpc("navdash_list_devices", { p_requester_token: token });
      return NextResponse.json({ ok: true, devices: Array.isArray(devices) ? devices : [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await rpc("navdash_check_device", { p_token: token });
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    return result?.ok ? withSession(response, token) : response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, role: "crew", error: error instanceof Error ? error.message : "Device access check failed." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "pair") {
      const code = String(body?.code || "").trim();
      const token = String(body?.token || "").trim();
      const name = String(body?.name || "").trim();
      const result = await rpc("navdash_pair_device", {
        p_code: code,
        p_token: token,
        p_name: name,
      });
      const response = NextResponse.json(result, { status: result?.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
      return result?.ok ? withSession(response, token) : response;
    }

    if (action === "recover-wheelhouse") {
      const recoveryKey = String(body?.recoveryKey || "").trim();
      const token = String(body?.token || "").trim();
      const name = String(body?.name || "Wheelhouse PC").trim();
      const result = await rpc("navdash_recover_device", {
        p_recovery_key: recoveryKey,
        p_token: token,
        p_name: name,
      });
      const response = NextResponse.json(result, { status: result?.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } });
      return result?.ok ? withSession(response, token) : response;
    }

    if (action === "create-code") {
      const requesterToken = deviceToken(request);
      const role = body?.role === "crew" ? "crew" : "bridge";
      const maxUses = Math.max(1, Math.min(Number(body?.maxUses) || 1, 10));
      const minutes = Math.max(5, Math.min(Number(body?.minutes) || 30, 1440));
      const code = randomBytes(4).toString("hex").toUpperCase();
      const result = await rpc("navdash_create_pairing_code", {
        p_requester_token: requesterToken,
        p_code: code,
        p_role: role,
        p_max_uses: maxUses,
        p_minutes: minutes,
      });
      return NextResponse.json(result?.ok ? { ...result, code, role, maxUses, minutes } : result, {
        status: result?.ok ? 200 : 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (action === "revoke") {
      const requesterToken = deviceToken(request);
      const deviceId = String(body?.deviceId || "");
      const revoked = await rpc("navdash_revoke_device", {
        p_requester_token: requesterToken,
        p_device_id: deviceId,
      });
      return NextResponse.json({ ok: Boolean(revoked) }, {
        status: revoked ? 200 : 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown device access action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Device access action failed." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}