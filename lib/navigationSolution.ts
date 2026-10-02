import {
  geodesicDistanceNm,
  normalizeLongitudeDelta,
  routeDistanceNm,
  routeLegDistanceNm,
  routeRemainingDistanceNm,
  type RoutePoint,
  type RouteWaypoint,
} from "./routeNavigation";

export type NavigationShip = RoutePoint & {
  sog?: number | null;
};

export type CrossTrackSide = "PORT" | "STBD" | "--";

export type LegMetrics = {
  ratio: number;
  projectionRatio: number;
  xte: number;
  side: CrossTrackSide;
};

export type NavigationSolution<TWaypoint extends RouteWaypoint = RouteWaypoint> = {
  activeIndex: number;
  start: TWaypoint;
  next: TWaypoint;
  destination: TWaypoint;
  metrics: LegMetrics;
  dtg: number;
  nextDistance: number;
  progress: number;
  etaHours: number | null;
  bearing: number;
};

function rad(value: number) {
  return value * Math.PI / 180;
}

function deg(value: number) {
  return value * 180 / Math.PI;
}

function normalize360(value: number) {
  return ((value % 360) + 360) % 360;
}

function mercatorY(lat: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return Math.log(Math.tan(Math.PI / 4 + rad(clampedLat) / 2));
}

export function navigationBearing(
  start: RoutePoint,
  end: RoutePoint,
) {
  const p1 = rad(start.lat);
  const p2 = rad(end.lat);
  const dl = rad(normalizeLongitudeDelta(end.lon - start.lon));
  return normalize360(deg(Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  )));
}

export function navigationLegMetrics(
  ship: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): LegMetrics {
  const startX = rad(start.lon);
  const startY = mercatorY(start.lat);
  const endX = startX + rad(normalizeLongitudeDelta(end.lon - start.lon));
  const endY = mercatorY(end.lat);
  const shipX = startX + rad(normalizeLongitudeDelta(ship.lon - start.lon));
  const shipY = mercatorY(ship.lat);

  const vx = endX - startX;
  const vy = endY - startY;
  const wx = shipX - startX;
  const wy = shipY - startY;
  const len2 = vx * vx + vy * vy;

  if (len2 <= 1e-16) {
    return { ratio: 0, projectionRatio: 0, xte: 0, side: "--" };
  }

  const ratio = (wx * vx + wy * vy) / len2;
  const projectionRatio = Math.max(0, Math.min(1, ratio));
  const closestX = startX + projectionRatio * vx;
  const closestY = startY + projectionRatio * vy;
  const closestLat = deg(Math.atan(Math.sinh(closestY)));
  const closestLon = deg(closestX);
  const cross = vx * wy - vy * wx;

  return {
    ratio,
    projectionRatio,
    xte: geodesicDistanceNm(ship, { lat: closestLat, lon: closestLon }),
    side: cross > 0 ? "STBD" : cross < 0 ? "PORT" : "--",
  };
}

export function logicalRouteLegIndex<TWaypoint extends RouteWaypoint>(
  route: TWaypoint[],
  ship: RoutePoint | null,
  currentLegIndex: number,
) {
  if (!ship || route.length < 2) return null;

  let best: { index: number; metrics: LegMetrics; score: number } | null = null;

  for (let index = 1; index < route.length; index += 1) {
    const metrics = navigationLegMetrics(ship, route[index - 1], route[index]);
    const jumpPenalty = Math.abs(index - currentLegIndex) * 0.35;
    const endPenalty = metrics.projectionRatio <= 0 || metrics.projectionRatio >= 1 ? 0.25 : 0;
    const score = metrics.xte + jumpPenalty + endPenalty;

    if (!best || score < best.score) {
      best = { index, metrics, score };
    }
  }

  return best?.index ?? null;
}

export function calculateNavigationSolution<TWaypoint extends RouteWaypoint>(
  route: TWaypoint[],
  ship: NavigationShip | null,
  currentLegIndex: number,
): NavigationSolution<TWaypoint> | null {
  if (!ship || route.length < 2) return null;

  const logicalIndex = logicalRouteLegIndex(route, ship, currentLegIndex);
  const activeIndex = logicalIndex ?? Math.max(1, Math.min(currentLegIndex, route.length - 1));
  const start = route[activeIndex - 1];
  const next = route[activeIndex];
  const destination = route[route.length - 1];

  if (!start || !next || !destination) return null;

  const metrics = navigationLegMetrics(ship, start, next);
  const dtg = routeRemainingDistanceNm(ship, route, activeIndex);
  const total = routeDistanceNm(route);
  const nextDistance = routeLegDistanceNm(ship, next);
  const progress = total > 0
    ? Math.max(0, Math.min(100, ((total - dtg) / total) * 100))
    : 0;
  const etaHours = typeof ship.sog === "number" && Number.isFinite(ship.sog) && ship.sog > 0.1
    ? dtg / ship.sog
    : null;

  return {
    activeIndex,
    start,
    next,
    destination,
    metrics,
    dtg,
    nextDistance,
    progress,
    etaHours,
    bearing: navigationBearing(start, next),
  };
}
