import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://jvisswvllnvaicdroljr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aoiZwFyorDFcf_LyNCfhqA_acPun8X2";
const TABLE_URL = `${SUPABASE_URL}/rest/v1/navdash_route_state`;

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type RouteState = {
  type: "route-state";
  routeName: string;
  waypoints: Waypoint[];
  activeWaypointIndex: number;
  savedAt: string;
};

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function normalizeRoutePayload(payload: any): RouteState | null {
  const rawWaypoints = Array.isArray(payload?.waypoints) ? payload.waypoints : [];

  const waypoints: Waypoint[] = rawWaypoints
    .map((wp: any, index: number) => {
      const lat = Number(wp?.lat ?? wp?.latitude);
      const lon = Number(wp?.lon ?? wp?.lng ?? wp?.longitude);

      return {
        id: typeof wp?.id === "string" && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, "0")}`,
        name: typeof wp?.name === "string" && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
        lat,
        lon,
      };
    })
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

  if (waypoints.length < 2) return null;

  const activeWaypointIndexRaw = Number(payload?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(activeWaypointIndexRaw)
    ? Math.max(1, Math.min(Math.round(activeWaypointIndexRaw), waypoints.length - 1))
    : 1;

  return {
    type: "route-state",
    routeName: typeof payload?.routeName === "string" && payload.routeName.trim()
      ? payload.routeName.trim()
      : "Loaded RTZ Route",
    waypoints,
    activeWaypointIndex,
    savedAt: typeof payload?.savedAt === "string" ? payload.savedAt : new Date().toISOString(),
  };
}

function rowToRouteState(row: any): RouteState | null {
  if (!row) return null;
  return normalizeRoutePayload({
    routeName: row.route_name,
    waypoints: row.waypoints,
    activeWaypointIndex: row.active_waypoint_index,
    savedAt: row.saved_at,
  });
}

export async function GET() {
  try {
    const response = await fetch(
      `${TABLE_URL}?id=eq.current&select=route_name,waypoints,active_waypoint_index,saved_at&limit=1`,
      { headers: headers(), cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
    }

    const rows = await response.json();
    const routeState = rowToRouteState(Array.isArray(rows) ? rows[0] : null);

    if (!routeState) {
      return NextResponse.json({ hasRoute: false }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(
      { hasRoute: true, ...routeState },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { hasRoute: false, error: error instanceof Error ? error.message : "Could not read shared route state." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const normalized = normalizeRoutePayload(payload);

    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "Route must include at least two usable waypoints." },
        { status: 400 },
      );
    }

    const response = await fetch(TABLE_URL, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        id: "current",
        route_name: normalized.routeName,
        waypoints: normalized.waypoints,
        active_waypoint_index: normalized.activeWaypointIndex,
        saved_at: normalized.savedAt,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);
    }

    return NextResponse.json(
      { ok: true, hasRoute: true, ...normalized },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save shared route state." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE() {
  try {
    const response = await fetch(`${TABLE_URL}?id=eq.current`, {
      method: "DELETE",
      headers: headers({ Prefer: "return=minimal" }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Supabase delete failed: ${response.status} ${await response.text()}`);
    }

    return NextResponse.json(
      { ok: true, hasRoute: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not clear shared route state." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
