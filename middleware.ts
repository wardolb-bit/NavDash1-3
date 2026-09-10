import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = "https://jvisswvllnvaicdroljr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aoiZwFyorDFcf_LyNCfhqA_acPun8X2";
const SESSION_COOKIE = "navdash-device-token-v1";

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

function isShipNetwork(request: NextRequest) {
  const ip = requestIp(request);
  if (!ip) return false;

  const allowed = (process.env.NAVDASH_SHIP_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowed.includes(ip);
}

async function validPairedDevice(token: string) {
  if (!token) return false;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/navdash_check_device`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
      cache: "no-store",
    });

    if (!response.ok) return false;
    const result = await response.json();
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Pairing/recovery must remain reachable so approved devices can establish access.
  if (pathname.startsWith("/device-access")) return NextResponse.next();

  // Public/static assets are not sensitive and should not be forced through auth.
  if (pathname.includes(".")) return NextResponse.next();

  // Shipboard internet gets through the outer gate automatically.
  if (isShipNetwork(request)) return NextResponse.next();

  // Remote access remains available to an already paired Crew or Bridge device.
  const token = request.cookies.get(SESSION_COOKIE)?.value?.trim() || "";
  if (await validPairedDevice(token)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/device-access";
  url.searchParams.set("restricted", "1");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
