import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

function routeFilePath() {
  return path.join(process.env.NAVDASH_DATA_DIR || path.join(process.cwd(), "data"), "loaded-route.json");
}

function normalizeRoutePayload(payload: any) {
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

export async function GET() {
  try {
    const raw = await fs.readFile(routeFilePath(), "utf8");
    const parsed = normalizeRoutePayload(JSON.parse(raw));

    if (!parsed) {
      return NextResponse.json({ hasRoute: false });
    }

    return NextResponse.json({ hasRoute: true, ...parsed });
  } catch {
    return NextResponse.json({ hasRoute: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const normalized = normalizeRoutePayload(payload);

    if (!normalized) {
      return NextResponse.json({ ok: false, error: "Route must include at least two usable waypoints." }, { status: 400 });
    }

    const filePath = routeFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");

    return NextResponse.json({ ok: true, hasRoute: true, ...normalized });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save shared route state." }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await fs.unlink(routeFilePath());
  } catch {
    // File may not exist yet.
  }

  return NextResponse.json({ ok: true, hasRoute: false });
}
