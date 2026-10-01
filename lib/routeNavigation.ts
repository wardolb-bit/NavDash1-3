export type LegGeometry = "Orthodrome" | "Loxodrome";

export type RoutePoint = {
  lat: number;
  lon: number;
};

export type RouteWaypoint = RoutePoint & {
  id?: string;
  name?: string;
  geometryType?: LegGeometry;
};

export type RouteGeometryPoint = RoutePoint & {
  distanceNm: number;
  legIndex: number;
};

export type ParsedRtzRoute = {
  routeName: string;
  waypoints: RouteWaypoint[];
};

const WGS84_A_M = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B_M = WGS84_A_M * (1 - WGS84_F);
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_E = Math.sqrt(WGS84_E2);
const METERS_PER_NM = 1852;
const SPHERICAL_RADIUS_NM = 3440.065;

function rad(value: number) {
  return value * Math.PI / 180;
}

function deg(value: number) {
  return value * 180 / Math.PI;
}

export function normalizeLongitudeDelta(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

export function normalizeLongitude(value: number) {
  let result = value;
  while (result >= 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

export function normalizeLegGeometry(value: unknown): LegGeometry | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "orthodrome" || normalized === "greatcircle" || normalized === "great circle") return "Orthodrome";
  if (normalized === "loxodrome" || normalized === "rhumbline" || normalized === "rhumb line") return "Loxodrome";
  return undefined;
}

function sphericalDistanceNm(a: RoutePoint, b: RoutePoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = rad(b.lat - a.lat);
  const dl = rad(normalizeLongitudeDelta(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return SPHERICAL_RADIUS_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function sphericalInitialBearingDeg(a: RoutePoint, b: RoutePoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(normalizeLongitudeDelta(b.lon - a.lon));
  return (deg(Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  )) + 360) % 360;
}

function vincentyInverse(a: RoutePoint, b: RoutePoint) {
  const phi1 = rad(a.lat);
  const phi2 = rad(b.lat);
  const L = rad(normalizeLongitudeDelta(b.lon - a.lon));
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let sinAlpha = 0;
  let cos2Alpha = 1;
  let cos2SigmaM = 0;
  let converged = false;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2
      + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return { distanceNm: 0, initialBearingDeg: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cos2Alpha = 1 - sinAlpha ** 2;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cos2Alpha;
    const C = WGS84_F / 16 * cos2Alpha * (4 + WGS84_F * (4 - 3 * cos2Alpha));
    const nextLambda = L + (1 - C) * WGS84_F * sinAlpha * (
      sigma + C * sinSigma * (
        cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)
      )
    );
    if (Math.abs(nextLambda - lambda) < 1e-12) {
      lambda = nextLambda;
      converged = true;
      break;
    }
    lambda = nextLambda;
  }

  if (!converged) {
    return {
      distanceNm: sphericalDistanceNm(a, b),
      initialBearingDeg: sphericalInitialBearingDeg(a, b),
    };
  }

  const uSq = cos2Alpha * (WGS84_A_M ** 2 - WGS84_B_M ** 2) / WGS84_B_M ** 2;
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = B * sinSigma * (
    cos2SigmaM + B / 4 * (
      cosSigma * (-1 + 2 * cos2SigmaM ** 2)
      - B / 6 * cos2SigmaM
        * (-3 + 4 * sinSigma ** 2)
        * (-3 + 4 * cos2SigmaM ** 2)
    )
  );
  const distanceNm = WGS84_B_M * A * (sigma - deltaSigma) / METERS_PER_NM;
  const initialBearingDeg = (deg(Math.atan2(
    cosU2 * Math.sin(lambda),
    cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda),
  )) + 360) % 360;

  return { distanceNm, initialBearingDeg };
}

export function geodesicDistanceNm(a: RoutePoint, b: RoutePoint) {
  return vincentyInverse(a, b).distanceNm;
}

export function geodesicInitialBearingDeg(a: RoutePoint, b: RoutePoint) {
  return vincentyInverse(a, b).initialBearingDeg;
}

function isometricLatitude(phi: number) {
  const sinPhi = Math.sin(phi);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2))
    - WGS84_E / 2 * Math.log((1 + WGS84_E * sinPhi) / (1 - WGS84_E * sinPhi));
}

function meridionalArcM(phi: number) {
  const e2 = WGS84_E2;
  return WGS84_A_M * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - 35 * e2 ** 3 / 3072 * Math.sin(6 * phi)
  );
}

function meridionalRadiusM(phi: number) {
  const denom = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  return WGS84_A_M * (1 - WGS84_E2) / (denom ** 1.5);
}

export function rhumbDistanceNm(a: RoutePoint, b: RoutePoint) {
  const phi1 = rad(a.lat);
  const phi2 = rad(b.lat);
  const dLambda = rad(normalizeLongitudeDelta(b.lon - a.lon));
  const dPsi = isometricLatitude(phi2) - isometricLatitude(phi1);
  const dMeridian = meridionalArcM(phi2) - meridionalArcM(phi1);
  const course = Math.atan2(dLambda, dPsi);
  const cosCourse = Math.cos(course);

  if (Math.abs(cosCourse) > 1e-12) {
    return Math.abs(dMeridian / cosCourse) / METERS_PER_NM;
  }

  const primeVertical = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * Math.sin(phi1) ** 2);
  return Math.abs(primeVertical * Math.cos(phi1) * dLambda) / METERS_PER_NM;
}

export function routeLegDistanceNm(start: RoutePoint, end: RouteWaypoint) {
  return end.geometryType === "Loxodrome"
    ? rhumbDistanceNm(start, end)
    : geodesicDistanceNm(start, end);
}

export function routeDistanceNm(waypoints: RouteWaypoint[]) {
  let total = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    total += routeLegDistanceNm(waypoints[index - 1], waypoints[index]);
  }
  return total;
}

export function routeRemainingDistanceNm(
  position: RoutePoint,
  waypoints: RouteWaypoint[],
  activeWaypointIndex: number,
) {
  if (waypoints.length < 2 || activeWaypointIndex < 1 || activeWaypointIndex >= waypoints.length) return 0;
  let total = routeLegDistanceNm(position, waypoints[activeWaypointIndex]);
  for (let index = activeWaypointIndex + 1; index < waypoints.length; index += 1) {
    total += routeLegDistanceNm(waypoints[index - 1], waypoints[index]);
  }
  return total;
}

function geodesicDestination(start: RoutePoint, initialBearingDeg: number, distanceNm: number): RoutePoint {
  if (distanceNm <= 0) return { ...start };
  const alpha1 = rad(initialBearingDeg);
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const phi1 = rad(start.lat);
  const tanU1 = (1 - WGS84_F) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 ** 2);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha ** 2;
  const uSq = cosSqAlpha * (WGS84_A_M ** 2 - WGS84_B_M ** 2) / WGS84_B_M ** 2;
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const distanceM = distanceNm * METERS_PER_NM;
  let sigma = distanceM / (WGS84_B_M * A);

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const twoSigmaM = 2 * sigma1 + sigma;
    const sinSigma = Math.sin(sigma);
    const cosSigma = Math.cos(sigma);
    const cosTwoSigmaM = Math.cos(twoSigmaM);
    const deltaSigma = B * sinSigma * (
      cosTwoSigmaM + B / 4 * (
        cosSigma * (-1 + 2 * cosTwoSigmaM ** 2)
        - B / 6 * cosTwoSigmaM
          * (-3 + 4 * sinSigma ** 2)
          * (-3 + 4 * cosTwoSigmaM ** 2)
      )
    );
    const nextSigma = distanceM / (WGS84_B_M * A) + deltaSigma;
    if (Math.abs(nextSigma - sigma) < 1e-12) {
      sigma = nextSigma;
      break;
    }
    sigma = nextSigma;
  }

  const sinSigma = Math.sin(sigma);
  const cosSigma = Math.cos(sigma);
  const twoSigmaM = 2 * sigma1 + sigma;
  const cosTwoSigmaM = Math.cos(twoSigmaM);
  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - WGS84_F) * Math.sqrt(sinAlpha ** 2 + tmp ** 2),
  );
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1,
  );
  const C = WGS84_F / 16 * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
  const L = lambda - (1 - C) * WGS84_F * sinAlpha * (
    sigma + C * sinSigma * (
      cosTwoSigmaM + C * cosSigma * (-1 + 2 * cosTwoSigmaM ** 2)
    )
  );

  return {
    lat: deg(phi2),
    lon: normalizeLongitude(start.lon + deg(L)),
  };
}

function latitudeForMeridionalArc(targetM: number, initialPhi: number) {
  let phi = initialPhi;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const delta = (meridionalArcM(phi) - targetM) / meridionalRadiusM(phi);
    phi -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return phi;
}

export function interpolateRouteLeg(start: RoutePoint, end: RouteWaypoint, fraction: number): RoutePoint {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return { ...start };
  if (f >= 1) return { lat: end.lat, lon: end.lon };

  if (end.geometryType === "Loxodrome") {
    const phi1 = rad(start.lat);
    const phi2 = rad(end.lat);
    const m1 = meridionalArcM(phi1);
    const m2 = meridionalArcM(phi2);
    const phi = latitudeForMeridionalArc(m1 + (m2 - m1) * f, phi1 + (phi2 - phi1) * f);
    const dLon = normalizeLongitudeDelta(end.lon - start.lon);
    return {
      lat: deg(phi),
      lon: normalizeLongitude(start.lon + dLon * f),
    };
  }

  const inverse = vincentyInverse(start, end);
  return geodesicDestination(start, inverse.initialBearingDeg, inverse.distanceNm * f);
}

export function routeGeometryPoints(waypoints: RouteWaypoint[], maxStepNm = 50): RouteGeometryPoint[] {
  if (!waypoints.length) return [];
  const result: RouteGeometryPoint[] = [{
    lat: waypoints[0].lat,
    lon: waypoints[0].lon,
    distanceNm: 0,
    legIndex: 0,
  }];
  let cumulativeNm = 0;

  for (let index = 1; index < waypoints.length; index += 1) {
    const start = waypoints[index - 1];
    const end = waypoints[index];
    const legNm = routeLegDistanceNm(start, end);
    const segments = Math.max(1, Math.ceil(legNm / Math.max(1, maxStepNm)));
    for (let step = 1; step <= segments; step += 1) {
      const fraction = step / segments;
      const point = interpolateRouteLeg(start, end, fraction);
      result.push({
        ...point,
        distanceNm: cumulativeNm + legNm * fraction,
        legIndex: index,
      });
    }
    cumulativeNm += legNm;
  }

  return result;
}

export function pointAtRouteDistanceNm(
  waypoints: RouteWaypoint[],
  targetNm: number,
  maxStepNm = 50,
): RouteGeometryPoint | null {
  const geometry = routeGeometryPoints(waypoints, maxStepNm);
  if (!geometry.length) return null;
  const target = Math.max(0, Math.min(geometry[geometry.length - 1].distanceNm, targetNm));
  if (target <= 0 || geometry.length === 1) return geometry[0];

  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1];
    const next = geometry[index];
    if (target > next.distanceNm) continue;
    const span = next.distanceNm - previous.distanceNm;
    const fraction = span <= 0 ? 0 : (target - previous.distanceNm) / span;
    const dLon = normalizeLongitudeDelta(next.lon - previous.lon);
    return {
      lat: previous.lat + (next.lat - previous.lat) * fraction,
      lon: normalizeLongitude(previous.lon + dLon * fraction),
      distanceNm: target,
      legIndex: next.legIndex,
    };
  }

  return geometry[geometry.length - 1];
}

export function routeSliceBetweenDistances(
  waypoints: RouteWaypoint[],
  startNm: number,
  endNm: number,
  maxStepNm = 50,
) {
  const geometry = routeGeometryPoints(waypoints, maxStepNm);
  if (geometry.length < 2) return [] as RouteGeometryPoint[];
  const total = geometry[geometry.length - 1].distanceNm;
  const start = Math.max(0, Math.min(total, Math.min(startNm, endNm)));
  const end = Math.max(start, Math.min(total, Math.max(startNm, endNm)));
  const first = pointAtRouteDistanceNm(waypoints, start, maxStepNm);
  const last = pointAtRouteDistanceNm(waypoints, end, maxStepNm);
  if (!first || !last) return [] as RouteGeometryPoint[];
  return [
    first,
    ...geometry.filter((point) => point.distanceNm > start && point.distanceNm < end),
    last,
  ];
}

function getAttr(node: Element | null, names: string[]) {
  if (!node) return null;
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value !== null && value !== "") return value;
  }
  return null;
}

function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim();
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;
  const hemi = text.match(/[NSEW]/i)?.[0]?.toUpperCase();
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;
  let value = nums.length >= 3
    ? Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600
    : nums.length >= 2
      ? Math.abs(nums[0]) + nums[1] / 60
      : nums[0];
  if (hemi === "S" || hemi === "W" || (!hemi && nums[0] < 0)) value *= -1;
  if ((isLat && Math.abs(value) > 90) || (!isLat && Math.abs(value) > 180)) return NaN;
  return value;
}

export function parseRtzRouteXml(xmlText: string): ParsedRtzRoute {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeInfo = doc.querySelector("routeInfo,RouteInfo");
  const routeName = getAttr(routeInfo, ["routeName", "RouteName", "name", "Name"])
    || getAttr(routeNode, ["routeName", "RouteName", "name", "Name", "id", "ID"])
    || routeNode.querySelector("routeName,name")?.textContent?.trim()
    || "Loaded RTZ Route";

  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP"))
    .map((node, index): RouteWaypoint => {
      const pos = node.querySelector("position,Position,pos") || node;
      const leg = node.querySelector("leg,Leg");
      const lat = parseCoordinate(
        getAttr(pos, ["lat", "Lat", "latitude", "Latitude"])
          || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]),
        true,
      );
      const lon = parseCoordinate(
        getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"])
          || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]),
        false,
      );
      return {
        id: getAttr(node, ["id", "ID", "revision", "number"])
          || `WP${String(index + 1).padStart(2, "0")}`,
        name: getAttr(node, ["name", "Name", "waypointName", "WaypointName"])
          || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim()
          || `Waypoint ${index + 1}`,
        lat,
        lon,
        geometryType: normalizeLegGeometry(getAttr(leg, ["geometryType", "GeometryType"])),
      };
    })
    .filter((waypoint) => Number.isFinite(waypoint.lat)
      && Number.isFinite(waypoint.lon)
      && Math.abs(waypoint.lat) <= 90
      && Math.abs(waypoint.lon) <= 180);

  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}

export function normalizeRouteWaypoints(raw: unknown): RouteWaypoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value: any, index): RouteWaypoint => ({
      id: typeof value?.id === "string" && value.id.trim()
        ? value.id.trim()
        : `WP${String(index + 1).padStart(2, "0")}`,
      name: typeof value?.name === "string" && value.name.trim()
        ? value.name.trim()
        : `Waypoint ${index + 1}`,
      lat: Number(value?.lat ?? value?.latitude),
      lon: Number(value?.lon ?? value?.lng ?? value?.longitude),
      geometryType: normalizeLegGeometry(value?.geometryType),
    }))
    .filter((waypoint) => Number.isFinite(waypoint.lat)
      && Number.isFinite(waypoint.lon)
      && Math.abs(waypoint.lat) <= 90
      && Math.abs(waypoint.lon) <= 180);
}

export function routeSignature(waypoints: RouteWaypoint[]) {
  return waypoints
    .map((waypoint) => `${waypoint.lat.toFixed(6)},${waypoint.lon.toFixed(6)},${waypoint.geometryType || ""}`)
    .join(";");
}
