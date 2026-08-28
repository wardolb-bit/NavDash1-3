"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type RoutePoint = { id?: string; name?: string; lat: number; lon: number };
type RouteState = { waypoints: RoutePoint[]; activeWaypointIndex: number };
type Motion = { lat: number; lon: number; sog: number };
type MarkerEvent = {
  kind: "sunrise" | "sunset";
  date: Date;
  lat: number;
  lon: number;
  routeDistanceNm: number;
};
type PixelMarker = MarkerEvent & { left: number; top: number; label: string; detail: string };

type Multipart = { total: number; parts: string[]; fillBits: number };
const multipart = new Map<string, Multipart>();
const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const SUN_ALTITUDE_DEG = -0.833;

const rad = (value: number) => (value * Math.PI) / 180;
const deg = (value: number) => (value * 180) / Math.PI;
const norm360 = (value: number) => ((value % 360) + 360) % 360;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function unwrapLongitudeNear(lon: number, referenceLon: number) {
  let value = lon;
  while (value - referenceLon > 180) value -= 360;
  while (value - referenceLon < -180) value += 360;
  return value;
}

function distanceNm(a: RoutePoint, b: RoutePoint) {
  const radiusNm = 3440.065;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(unwrapLongitudeNear(b.lon, a.lon) - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingDeg(a: RoutePoint, b: RoutePoint) {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLon = rad(unwrapLongitudeNear(b.lon, a.lon) - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return norm360(deg(Math.atan2(y, x)));
}

function destinationPoint(start: RoutePoint, bearing: number, distance: number): RoutePoint {
  const radiusNm = 3440.065;
  const angularDistance = distance / radiusNm;
  const brg = rad(bearing);
  const lat1 = rad(start.lat);
  const lon1 = rad(start.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

function cumulativeRouteDistances(route: RoutePoint[]) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceNm(route[i - 1], route[i]));
  }
  return cumulative;
}

function projectToActiveLeg(route: RoutePoint[], activeWaypointIndex: number, motion: Motion) {
  if (route.length < 2) return 0;
  const endIndex = clamp(Math.round(activeWaypointIndex), 1, route.length - 1);
  const start = route[endIndex - 1];
  const end = route[endIndex];
  const refLat = (start.lat + end.lat + motion.lat) / 3;
  const refLon = start.lon;
  const scaleX = 60 * Math.cos(rad(refLat));
  const xy = (point: RoutePoint) => ({
    x: (unwrapLongitudeNear(point.lon, refLon) - refLon) * scaleX,
    y: (point.lat - start.lat) * 60,
  });
  const a = xy(start);
  const b = xy(end);
  const p = xy(motion);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const length2 = vx * vx + vy * vy;
  const ratio = length2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / length2, 0, 1) : 0;
  const cumulative = cumulativeRouteDistances(route);
  return cumulative[endIndex - 1] + (cumulative[endIndex] - cumulative[endIndex - 1]) * ratio;
}

function positionAtRouteDistance(route: RoutePoint[], cumulative: number[], routeDistanceNm: number): RoutePoint | null {
  if (route.length < 2) return null;
  const clampedDistance = clamp(routeDistanceNm, 0, cumulative[cumulative.length - 1]);
  let index = 0;
  while (index < route.length - 2 && cumulative[index + 1] < clampedDistance) index += 1;
  const start = route[index];
  const end = route[index + 1];
  const legDistance = cumulative[index + 1] - cumulative[index];
  if (legDistance <= 0) return start;
  return destinationPoint(start, bearingDeg(start, end), clampedDistance - cumulative[index]);
}

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const raw = unsigned(bits, start, length);
  const sign = 2 ** (length - 1);
  return raw >= sign ? raw - 2 ** length : raw;
}

function aisBits(sentence: string) {
  const parts = sentence.trim().split(",");
  if (parts.length < 7) return null;
  const source = parts[0];
  const total = Number(parts[1]);
  const number = Number(parts[2]);
  const sequence = parts[3] || "0";
  const channel = parts[4] || "0";
  const payload = parts[5];
  const fillBits = Number((parts[6] || "0").split("*")[0]);
  if (!payload) return null;
  if (total <= 1) {
    let bits = payloadToBits(payload);
    if (fillBits > 0) bits = bits.slice(0, -fillBits);
    return bits;
  }
  const key = `${source}-${sequence}-${channel}`;
  const cached = multipart.get(key) || { total, parts: [], fillBits: 0 };
  cached.parts[number - 1] = payload;
  cached.fillBits = fillBits;
  multipart.set(key, cached);
  if (cached.parts.filter(Boolean).length !== total) return null;
  multipart.delete(key);
  let bits = payloadToBits(cached.parts.join(""));
  if (cached.fillBits > 0) bits = bits.slice(0, -cached.fillBits);
  return bits;
}

function nmeaDegrees(raw: string, isLat: boolean) {
  const degreeDigits = isLat ? 2 : 3;
  return Number(raw.slice(0, degreeDigits)) + Number(raw.slice(degreeDigits)) / 60;
}

function decodeMotion(sentence: string, previous: Motion | null): Motion | null {
  const parts = sentence.trim().split(",");
  const type = (parts[0] || "").replace(/^[$!]/, "");

  if ((type === "AIVDO" || type === "ABVDO") && parts[5]) {
    try {
      const bits = aisBits(sentence);
      if (!bits || ![1, 2, 3].includes(unsigned(bits, 0, 6))) return previous;
      const sogRaw = unsigned(bits, 50, 10);
      const lon = signed(bits, 61, 28) / 600000;
      const lat = signed(bits, 89, 27) / 600000;
      const sog = sogRaw < 1023 ? sogRaw / 10 : previous?.sog ?? 0;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return previous;
      return { lat, lon, sog };
    } catch {
      return previous;
    }
  }

  if (/..RMC$/.test(type) && parts[2] === "A" && parts[3] && parts[5]) {
    const lat = nmeaDegrees(parts[3], true) * (parts[4] === "S" ? -1 : 1);
    const lon = nmeaDegrees(parts[5], false) * (parts[6] === "W" ? -1 : 1);
    const sog = Number(parts[7]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, sog: Number.isFinite(sog) ? sog : previous?.sog ?? 0 };
    }
  }

  return previous;
}

function solarParams(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = norm360(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const c =
    Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const lambdaRad = rad(lambda);
  const epsRad = rad(eps);
  return {
    ra: norm360(deg(Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)))),
    dec: deg(Math.asin(Math.sin(epsRad) * Math.sin(lambdaRad))),
  };
}

function gmst(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

function sunAltitude(lat: number, lon: number, date: Date) {
  const sun = solarParams(date);
  const hourAngle = rad(norm360(gmst(date) + lon - sun.ra));
  return deg(
    Math.asin(
      Math.sin(rad(lat)) * Math.sin(rad(sun.dec)) +
        Math.cos(rad(lat)) * Math.cos(rad(sun.dec)) * Math.cos(hourAngle),
    ),
  );
}

function findUpcomingSolarEvents(route: RoutePoint[], activeWaypointIndex: number, motion: Motion): MarkerEvent[] {
  if (route.length < 2 || !Number.isFinite(motion.sog) || motion.sog < 0.5) return [];
  const cumulative = cumulativeRouteDistances(route);
  const total = cumulative[cumulative.length - 1];
  const currentAlong = projectToActiveLeg(route, activeWaypointIndex, motion);
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];

  const now = new Date();
  const maxHours = Math.min(36, remaining / motion.sog);
  const stepMinutes = 10;
  const events: MarkerEvent[] = [];

  const sample = (minutesAhead: number) => {
    const routeDistanceNm = Math.min(total, currentAlong + motion.sog * (minutesAhead / 60));
    const pos = positionAtRouteDistance(route, cumulative, routeDistanceNm);
    if (!pos) return null;
    const date = new Date(now.getTime() + minutesAhead * 60000);
    return { date, pos, routeDistanceNm, altitude: sunAltitude(pos.lat, pos.lon, date) - SUN_ALTITUDE_DEG };
  };

  let previous = sample(0);
  for (let minutes = stepMinutes; minutes <= maxHours * 60 && previous; minutes += stepMinutes) {
    const current = sample(minutes);
    if (!current) break;
    const rising = previous.altitude < 0 && current.altitude >= 0;
    const setting = previous.altitude >= 0 && current.altitude < 0;
    if (rising || setting) {
      const denominator = current.altitude - previous.altitude;
      const fraction = Math.abs(denominator) > 1e-9 ? clamp(-previous.altitude / denominator, 0, 1) : 0.5;
      const refinedMinutes = minutes - stepMinutes + stepMinutes * fraction;
      const refined = sample(refinedMinutes);
      if (refined) {
        events.push({
          kind: rising ? "sunrise" : "sunset",
          date: refined.date,
          lat: refined.pos.lat,
          lon: refined.pos.lon,
          routeDistanceNm: refined.routeDistanceNm,
        });
      }
    }
    if (events.some((event) => event.kind === "sunrise") && events.some((event) => event.kind === "sunset")) break;
    previous = current;
  }

  return [
    events.find((event) => event.kind === "sunrise"),
    events.find((event) => event.kind === "sunset"),
  ].filter((event): event is MarkerEvent => Boolean(event));
}

function splitRouteAtDateLine(route: RoutePoint[]) {
  if (!route.length) return [] as RoutePoint[][];
  const segments: RoutePoint[][] = [[route[0]]];
  for (let i = 1; i < route.length; i += 1) {
    const start = route[i - 1];
    const end = route[i];
    const delta = end.lon - start.lon;
    const current = segments[segments.length - 1];
    if (Math.abs(delta) <= 180) {
      current.push(end);
      continue;
    }
    const adjustedEndLon = delta > 180 ? end.lon - 360 : end.lon + 360;
    const seamLon = delta > 180 ? -180 : 180;
    const oppositeSeamLon = -seamLon;
    const ratio = (seamLon - start.lon) / (adjustedEndLon - start.lon);
    const seamLat = start.lat + (end.lat - start.lat) * ratio;
    current.push({ lat: seamLat, lon: seamLon });
    segments.push([{ lat: seamLat, lon: oppositeSeamLon }, end]);
  }
  return segments;
}

function formatLocalEvent(event: MarkerEvent) {
  const offset = clamp(Math.round(event.lon / 15), -12, 14);
  const local = new Date(event.date.getTime() + offset * 3600000);
  const time = local.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const date = local.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  });
  const offsetText = offset === 0 ? "UTC" : `UTC${offset > 0 ? "+" : ""}${offset}`;
  return { label: `${event.kind === "sunrise" ? "SUNRISE" : "SUNSET"} ${time}`, detail: `${date} ${time} LT (${offsetText})` };
}

function loadRouteFromStorage(): RouteState | null {
  try {
    const candidates = [
      localStorage.getItem(ROUTE_STORAGE_KEY),
      sessionStorage.getItem(ROUTE_STORAGE_KEY),
      localStorage.getItem("navdash-v12-loaded-route"),
      sessionStorage.getItem("navdash-v12-loaded-route"),
    ];
    for (const raw of candidates) {
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const waypoints = Array.isArray(parsed?.waypoints)
        ? parsed.waypoints
            .map((point: any, index: number) => ({
              id: String(point?.id || `WP${index + 1}`),
              name: String(point?.name || ""),
              lat: Number(point?.lat ?? point?.latitude),
              lon: Number(point?.lon ?? point?.lng ?? point?.longitude),
            }))
            .filter((point: RoutePoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
        : [];
      if (waypoints.length >= 2) {
        return { waypoints, activeWaypointIndex: Number.isFinite(Number(parsed?.activeWaypointIndex)) ? Number(parsed.activeWaypointIndex) : 1 };
      }
    }
  } catch {}
  return null;
}

function routePolylinePaths(map: HTMLElement) {
  return Array.from(map.querySelectorAll("svg path.leaflet-interactive")).filter((node): node is SVGPathElement => {
    if (!(node instanceof SVGPathElement)) return false;
    const stroke = (node.getAttribute("stroke") || "").toLowerCase();
    const fill = (node.getAttribute("fill") || "").toLowerCase();
    const weight = Number(node.getAttribute("stroke-width"));
    return stroke === "#c9a227" && fill === "none" && Math.abs(weight - 4) < 0.2;
  });
}

function eventPixel(map: HTMLElement, route: RoutePoint[], event: MarkerEvent) {
  const paths = routePolylinePaths(map);
  const routeSegments = splitRouteAtDateLine(route);
  if (!paths.length || paths.length !== routeSegments.length) return null;

  const segmentDistances = routeSegments.map((segment) => {
    let total = 0;
    for (let i = 1; i < segment.length; i += 1) total += distanceNm(segment[i - 1], segment[i]);
    return total;
  });
  let remaining = event.routeDistanceNm;
  let segmentIndex = 0;
  while (segmentIndex < segmentDistances.length - 1 && remaining > segmentDistances[segmentIndex]) {
    remaining -= segmentDistances[segmentIndex];
    segmentIndex += 1;
  }
  const geoLength = segmentDistances[segmentIndex];
  const fraction = geoLength > 0 ? clamp(remaining / geoLength, 0, 1) : 0;
  const path = paths[segmentIndex];
  const pathLength = path.getTotalLength();
  if (!Number.isFinite(pathLength) || pathLength <= 0) return null;
  const point = path.getPointAtLength(pathLength * fraction);
  const matrix = path.getScreenCTM();
  if (!matrix) return null;
  const svg = path.ownerSVGElement;
  if (!svg) return null;
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = point.x;
  svgPoint.y = point.y;
  const screenPoint = svgPoint.matrixTransform(matrix);
  const rect = map.getBoundingClientRect();
  return { left: screenPoint.x - rect.left, top: screenPoint.y - rect.top };
}

export function BridgeSunRouteMarkers() {
  const pathname = usePathname();
  const [map, setMap] = useState<HTMLElement | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [pixels, setPixels] = useState<PixelMarker[]>([]);

  useEffect(() => {
    if (pathname !== "/") {
      setMap(null);
      return;
    }
    let timer = 0;
    const findMap = () => {
      const element = document.getElementById("v12-map");
      if (element instanceof HTMLElement) setMap(element);
      else timer = window.setTimeout(findMap, 400);
    };
    findMap();
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    const sync = async () => {
      const local = loadRouteFromStorage();
      if (local) {
        setRouteState(local);
        return;
      }
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok) return;
        const parsed = await response.json();
        const waypoints = Array.isArray(parsed?.waypoints)
          ? parsed.waypoints
              .map((point: any) => ({ lat: Number(point?.lat), lon: Number(point?.lon), id: point?.id, name: point?.name }))
              .filter((point: RoutePoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
          : [];
        if (waypoints.length >= 2) {
          setRouteState({ waypoints, activeWaypointIndex: Number(parsed?.activeWaypointIndex) || 1 });
        }
      } catch {}
    };
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => window.clearInterval(timer);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let stopped = false;
    let latest: Motion | null = null;
    const connect = () => {
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data));
            if (message?.type !== "nmea" || typeof message.line !== "string") return;
            latest = decodeMotion(message.line, latest);
            if (latest) setMotion({ ...latest });
          } catch {}
        };
        socket.onclose = () => {
          if (!stopped) retry = window.setTimeout(connect, 3000);
        };
      } catch {
        retry = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [pathname]);

  const events = useMemo(() => {
    if (!routeState || !motion) return [];
    return findUpcomingSolarEvents(routeState.waypoints, routeState.activeWaypointIndex, motion);
  }, [routeState, motion?.lat, motion?.lon, motion?.sog]);

  useEffect(() => {
    if (!map || !routeState) {
      setPixels([]);
      return;
    }
    const syncPixels = () => {
      const next = events
        .map((event) => {
          const pixel = eventPixel(map, routeState.waypoints, event);
          if (!pixel) return null;
          const text = formatLocalEvent(event);
          return { ...event, ...pixel, ...text };
        })
        .filter((item): item is PixelMarker => Boolean(item));
      setPixels(next);
    };
    syncPixels();
    const timer = window.setInterval(syncPixels, 350);
    window.addEventListener("resize", syncPixels);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", syncPixels);
    };
  }, [map, routeState, events]);

  if (pathname !== "/" || !map || !pixels.length) return null;

  return createPortal(
    <>
      {pixels.map((marker) => {
        const sunrise = marker.kind === "sunrise";
        return (
          <div
            key={marker.kind}
            title={`${sunrise ? "Sunrise" : "Sunset"} predicted on active route · ${marker.detail}`}
            style={{
              position: "absolute",
              left: marker.left,
              top: marker.top,
              zIndex: 1120,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                display: "block",
                background: sunrise ? "#fbbf24" : "#f59e0b",
                border: "2px solid #071019",
                boxShadow: "0 0 0 1px rgba(255,255,255,.72), 0 1px 4px rgba(0,0,0,.55)",
              }}
            />
            <span
              style={{
                padding: "3px 5px",
                borderRadius: 3,
                border: `1px solid ${sunrise ? "#fbbf24" : "#f59e0b"}`,
                background: "rgba(7,16,25,.88)",
                color: sunrise ? "#fde68a" : "#fdba74",
                font: "700 9px/1.1 system-ui, sans-serif",
                letterSpacing: ".045em",
                boxShadow: "0 1px 4px rgba(0,0,0,.32)",
              }}
            >
              {marker.label}
            </span>
          </div>
        );
      })}
    </>,
    map,
  );
}
