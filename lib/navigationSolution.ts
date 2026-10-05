import {
  geodesicDistanceNm,
  interpolateRouteLeg,
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

const SPHERICAL_RADIUS_NM = 3440.065;

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

function sphericalAngularDistance(a: RoutePoint, b: RoutePoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = rad(b.lat - a.lat);
  const dl = rad(normalizeLongitudeDelta(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2
    + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function sphericalInitialBearingRad(a: RoutePoint, b: RoutePoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(normalizeLongitudeDelta(b.lon - a.lon));
  return Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
}

export function navigationBearing(
  start: RoutePoint,
  end: RouteWaypoint,
) {
  if (end.geometryType === "Loxodrome") {
    const dLon = rad(normalizeLongitudeDelta(end.lon - start.lon));
    const dPsi = mercatorY(end.lat) - mercatorY(start.lat);
    return normalize360(deg(Math.atan2(dLon, dPsi)));
  }

  return normalize360(deg(sphericalInitialBearingRad(start, end)));
}

function rhumbLegMetrics(
  ship: RoutePoint,
  start: RoutePoint,
  end: RouteWaypoint,
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
    side: cross > 0 ? "PORT" : cross < 0 ? "STBD" : "--",
  };
}

function greatCircleLegMetrics(
  ship: RoutePoint,
  start: RoutePoint,
  end: RouteWaypoint,
): LegMetrics {
  const legAngle = sphericalAngularDistance(start, end);
  if (legAngle <= 1e-12) {
    return { ratio: 0, projectionRatio: 0, xte: 0, side: "--" };
  }

  const shipAngle = sphericalAngularDistance(start, ship);
  const legBearing = sphericalInitialBearingRad(start, end);
  const shipBearing = sphericalInitialBearingRad(start, ship);
  const bearingDelta = shipBearing - legBearing;
  const crossTrackAngle = Math.asin(
    Math.max(-1, Math.min(1, Math.sin(shipAngle) * Math.sin(bearingDelta))),
  );
  const alongTrackAngle = Math.atan2(
    Math.sin(shipAngle) * Math.cos(bearingDelta),
    Math.cos(shipAngle),
  );
  const ratio = alongTrackAngle / legAngle;
  const projectionRatio = Math.max(0, Math.min(1, ratio));
  const closestPoint = interpolateRouteLeg(start, end, projectionRatio);
  const xte = geodesicDistanceNm(ship, closestPoint);

  return {
    ratio,
    projectionRatio,
    xte: Number.isFinite(xte) ? xte : Math.abs(crossTrackAngle) * SPHERICAL_RADIUS_NM,
    side: crossTrackAngle > 0 ? "STBD" : crossTrackAngle < 0 ? "PORT" : "--",
  };
}

export function navigationLegMetrics(
  ship: RoutePoint,
  start: RoutePoint,
  end: RouteWaypoint,
): LegMetrics {
  return end.geometryType === "Loxodrome"
    ? rhumbLegMetrics(ship, start, end)
    : greatCircleLegMetrics(ship, start, end);
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
