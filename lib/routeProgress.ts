import {
  geodesicDistanceNm,
  normalizeLongitude,
  normalizeLongitudeDelta,
  type RouteGeometryPoint,
  type RoutePoint,
} from "./routeNavigation";

export type RouteProjection = RouteGeometryPoint & {
  crossTrackNm: number;
};

export function projectPositionOntoRouteGeometry(
  position: RoutePoint,
  geometry: RouteGeometryPoint[],
): RouteProjection | null {
  if (!geometry.length) return null;
  if (geometry.length === 1) {
    return {
      ...geometry[0],
      crossTrackNm: geodesicDistanceNm(position, geometry[0]),
    };
  }

  let best: RouteProjection | null = null;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const referenceLatRad = ((start.lat + end.lat + position.lat) / 3) * Math.PI / 180;
    const lonScale = Math.max(1e-6, Math.cos(referenceLatRad));

    const segmentLonDelta = normalizeLongitudeDelta(end.lon - start.lon);
    const shipLonDelta = normalizeLongitudeDelta(position.lon - start.lon);

    const vx = segmentLonDelta * lonScale;
    const vy = end.lat - start.lat;
    const wx = shipLonDelta * lonScale;
    const wy = position.lat - start.lat;
    const lengthSquared = vx * vx + vy * vy;
    const fraction = lengthSquared > 0
      ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared))
      : 0;

    const projected = {
      lat: start.lat + (end.lat - start.lat) * fraction,
      lon: normalizeLongitude(start.lon + segmentLonDelta * fraction),
    };
    const crossTrackNm = geodesicDistanceNm(position, projected);

    if (!best || crossTrackNm < best.crossTrackNm) {
      best = {
        ...projected,
        distanceNm: start.distanceNm + (end.distanceNm - start.distanceNm) * fraction,
        legIndex: end.legIndex,
        crossTrackNm,
      };
    }
  }

  return best;
}
