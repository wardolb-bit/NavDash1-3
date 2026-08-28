"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type Point = { id?: string; name?: string; lat: number; lon: number };
type RouteState = { waypoints: Point[]; activeWaypointIndex: number };
type Motion = { lat: number; lon: number; sog: number };
type SolarMarker = { kind: "sunrise" | "sunset"; date: Date; lat: number; lon: number; routeDistanceNm: number };
type PixelMarker = SolarMarker & { left: number; top: number; label: string; detail: string };

type Multipart = { total: number; parts: string[]; fillBits: number };
const multipart = new Map<string, Multipart>();
const ROUTE_KEY = "navconsole-saved-route";
const SUN_HORIZON = -0.833;

const rad = (v: number) => (v * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;
const norm = (v: number) => ((v % 360) + 360) % 360;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function unwrap(lon: number, ref: number) {
  let value = lon;
  while (value - ref > 180) value -= 360;
  while (value - ref < -180) value += 360;
  return value;
}

function distanceNm(a: Point, b: Point) {
  const radius = 3440.065;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(unwrap(b.lon, a.lon) - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: Point, b: Point) {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLon = rad(unwrap(b.lon, a.lon) - a.lon);
  return norm(deg(Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon))));
}

function destination(start: Point, brg: number, distance: number): Point {
  const radius = 3440.065;
  const d = distance / radius;
  const b = rad(brg);
  const lat1 = rad(start.lat);
  const lon1 = rad(start.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

function cumulative(route: Point[]) {
  const values = [0];
  for (let i = 1; i < route.length; i += 1) values.push(values[i - 1] + distanceNm(route[i - 1], route[i]));
  return values;
}

function currentAlongRoute(route: Point[], activeWaypointIndex: number, motion: Motion) {
  if (route.length < 2) return 0;
  const endIndex = clamp(Math.round(activeWaypointIndex), 1, route.length - 1);
  const start = route[endIndex - 1];
  const end = route[endIndex];
  const refLat = (start.lat + end.lat + motion.lat) / 3;
  const refLon = start.lon;
  const sx = 60 * Math.cos(rad(refLat));
  const xy = (p: Point) => ({ x: (unwrap(p.lon, refLon) - refLon) * sx, y: (p.lat - start.lat) * 60 });
  const a = xy(start), b = xy(end), p = xy(motion);
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const ratio = len2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1) : 0;
  const c = cumulative(route);
  return c[endIndex - 1] + (c[endIndex] - c[endIndex - 1]) * ratio;
}

function pointAtDistance(route: Point[], c: number[], target: number) {
  if (route.length < 2) return null;
  const d = clamp(target, 0, c[c.length - 1]);
  let i = 0;
  while (i < route.length - 2 && c[i + 1] < d) i += 1;
  const leg = c[i + 1] - c[i];
  if (leg <= 0) return route[i];
  return destination(route[i], bearing(route[i], route[i + 1]), d - c[i]);
}

function six(c: string) {
  let v = c.charCodeAt(0) - 48;
  if (v > 40) v -= 8;
  return v;
}
function bits(payload: string) { return payload.split("").map((c) => six(c).toString(2).padStart(6, "0")).join(""); }
function u(value: string, start: number, length: number) { return parseInt(value.slice(start, start + length), 2); }
function s(value: string, start: number, length: number) { const raw = u(value, start, length), sign = 2 ** (length - 1); return raw >= sign ? raw - 2 ** length : raw; }

function aisBits(sentence: string) {
  const p = sentence.trim().split(",");
  if (p.length < 7 || !p[5]) return null;
  const total = Number(p[1]), number = Number(p[2]), sequence = p[3] || "0", channel = p[4] || "0";
  const fillBits = Number((p[6] || "0").split("*")[0]);
  if (total <= 1) {
    let out = bits(p[5]);
    if (fillBits > 0) out = out.slice(0, -fillBits);
    return out;
  }
  const key = `${p[0]}-${sequence}-${channel}`;
  const cached = multipart.get(key) || { total, parts: [], fillBits: 0 };
  cached.parts[number - 1] = p[5];
  cached.fillBits = fillBits;
  multipart.set(key, cached);
  if (cached.parts.filter(Boolean).length !== total) return null;
  multipart.delete(key);
  let out = bits(cached.parts.join(""));
  if (cached.fillBits > 0) out = out.slice(0, -cached.fillBits);
  return out;
}

function nmeaDegrees(raw: string, isLat: boolean) {
  const n = isLat ? 2 : 3;
  return Number(raw.slice(0, n)) + Number(raw.slice(n)) / 60;
}

function decodeNmea(sentence: string, previous: Motion | null): Motion | null {
  const p = sentence.trim().split(",");
  const type = (p[0] || "").replace(/^[$!]/, "");
  if ((type === "AIVDO" || type === "ABVDO") && p[5]) {
    try {
      const b = aisBits(sentence);
      if (!b || ![1, 2, 3].includes(u(b, 0, 6))) return previous;
      const sogRaw = u(b, 50, 10);
      const lon = s(b, 61, 28) / 600000;
      const lat = s(b, 89, 27) / 600000;
      const sog = sogRaw < 1023 ? sogRaw / 10 : previous?.sog ?? 0;
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, sog };
    } catch {}
  }
  if (/..RMC$/.test(type) && p[2] === "A" && p[3] && p[5]) {
    const lat = nmeaDegrees(p[3], true) * (p[4] === "S" ? -1 : 1);
    const lon = nmeaDegrees(p[5], false) * (p[6] === "W" ? -1 : 1);
    const sog = Number(p[7]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, sog: Number.isFinite(sog) ? sog : previous?.sog ?? 0 };
  }
  return previous;
}

function motionFromObject(msg: any, previous: Motion | null): Motion | null {
  const candidates = [msg, msg?.data, msg?.payload, msg?.position, msg?.ownShip, msg?.ship];
  for (const value of candidates) {
    if (!value || typeof value !== "object") continue;
    const lat = Number(value?.lat ?? value?.latitude ?? value?.position?.lat ?? value?.position?.latitude);
    const lon = Number(value?.lon ?? value?.lng ?? value?.longitude ?? value?.position?.lon ?? value?.position?.lng ?? value?.position?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const sogValue = value?.sog ?? value?.speed ?? value?.speedOverGround ?? value?.position?.sog;
    const sog = Number.isFinite(Number(sogValue)) ? Number(sogValue) : previous?.sog ?? 0;
    return { lat, lon, sog };
  }
  return previous;
}

function motionFromMessage(raw: string, previous: Motion | null): Motion | null {
  let msg: any = raw;
  try { msg = JSON.parse(raw); } catch {}
  const nmeaCandidates = typeof msg === "string" ? [msg] : [msg?.line, msg?.sentence, msg?.nmea, msg?.raw, typeof msg?.data === "string" ? msg.data : null, typeof msg?.payload === "string" ? msg.payload : null];
  for (const candidate of nmeaCandidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.startsWith("!AIVDO") || trimmed.startsWith("!ABVDO") || /\$..RMC,/.test(trimmed)) {
      const decoded = decodeNmea(trimmed, previous);
      if (decoded && (decoded.lat !== previous?.lat || decoded.lon !== previous?.lon || decoded.sog !== previous?.sog)) return decoded;
    }
  }
  return typeof msg === "object" ? motionFromObject(msg, previous) : previous;
}

function solarParams(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = norm(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = norm(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  return { ra: norm(deg(Math.atan2(Math.cos(rad(eps)) * Math.sin(rad(lambda)), Math.cos(rad(lambda))))), dec: deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)))) };
}
function gmst(date: Date) { const jd = date.getTime() / 86400000 + 2440587.5, t = (jd - 2451545) / 36525; return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000); }
function sunAltitude(lat: number, lon: number, date: Date) {
  const sun = solarParams(date);
  const h = rad(norm(gmst(date) + lon - sun.ra));
  return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(rad(sun.dec)) + Math.cos(rad(lat)) * Math.cos(rad(sun.dec)) * Math.cos(h)));
}

function upcomingEvents(route: Point[], activeWaypointIndex: number, motion: Motion): SolarMarker[] {
  if (route.length < 2 || !Number.isFinite(motion.sog) || motion.sog < 0.5) return [];
  const c = cumulative(route);
  const total = c[c.length - 1];
  const along = currentAlongRoute(route, activeWaypointIndex, motion);
  const remaining = Math.max(0, total - along);
  if (remaining < 0.1) return [];
  const now = new Date();
  const maxHours = Math.min(30, remaining / motion.sog);
  const sample = (minutes: number) => {
    const routeDistanceNm = Math.min(total, along + motion.sog * minutes / 60);
    const pos = pointAtDistance(route, c, routeDistanceNm);
    if (!pos) return null;
    const date = new Date(now.getTime() + minutes * 60000);
    return { pos, date, routeDistanceNm, altitude: sunAltitude(pos.lat, pos.lon, date) - SUN_HORIZON };
  };
  const found: SolarMarker[] = [];
  let previous = sample(0);
  for (let minutes = 10; minutes <= maxHours * 60 && previous; minutes += 10) {
    const current = sample(minutes);
    if (!current) break;
    const rising = previous.altitude < 0 && current.altitude >= 0;
    const setting = previous.altitude >= 0 && current.altitude < 0;
    if (rising || setting) {
      const denominator = current.altitude - previous.altitude;
      const fraction = Math.abs(denominator) > 1e-9 ? clamp(-previous.altitude / denominator, 0, 1) : 0.5;
      const refined = sample(minutes - 10 + 10 * fraction);
      if (refined) found.push({ kind: rising ? "sunrise" : "sunset", date: refined.date, lat: refined.pos.lat, lon: refined.pos.lon, routeDistanceNm: refined.routeDistanceNm });
    }
    if (found.some((e) => e.kind === "sunrise") && found.some((e) => e.kind === "sunset")) break;
    previous = current;
  }
  return [found.find((e) => e.kind === "sunrise"), found.find((e) => e.kind === "sunset")].filter((e): e is SolarMarker => Boolean(e));
}

function splitDateLine(route: Point[]) {
  if (!route.length) return [] as Point[][];
  const segments: Point[][] = [[route[0]]];
  for (let i = 1; i < route.length; i += 1) {
    const start = route[i - 1], end = route[i], delta = end.lon - start.lon, current = segments[segments.length - 1];
    if (Math.abs(delta) <= 180) { current.push(end); continue; }
    const adjusted = delta > 180 ? end.lon - 360 : end.lon + 360;
    const seamLon = delta > 180 ? -180 : 180;
    const ratio = (seamLon - start.lon) / (adjusted - start.lon);
    const seamLat = start.lat + (end.lat - start.lat) * ratio;
    current.push({ lat: seamLat, lon: seamLon });
    segments.push([{ lat: seamLat, lon: -seamLon }, end]);
  }
  return segments;
}

function loadRoute(): RouteState | null {
  try {
    const candidates = [localStorage.getItem(ROUTE_KEY), sessionStorage.getItem(ROUTE_KEY), localStorage.getItem("navdash-v12-loaded-route"), sessionStorage.getItem("navdash-v12-loaded-route")];
    for (const raw of candidates) {
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const waypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints.map((p: any, i: number) => ({ id: String(p?.id || `WP${i + 1}`), name: String(p?.name || ""), lat: Number(p?.lat ?? p?.latitude), lon: Number(p?.lon ?? p?.lng ?? p?.longitude) })).filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
      if (waypoints.length >= 2) return { waypoints, activeWaypointIndex: Number.isFinite(Number(parsed?.activeWaypointIndex)) ? Number(parsed.activeWaypointIndex) : 1 };
    }
  } catch {}
  return null;
}

function routePaths(map: HTMLElement) {
  const candidates = Array.from(map.querySelectorAll("svg path.leaflet-interactive")).filter((node): node is SVGPathElement => {
    if (!(node instanceof SVGPathElement)) return false;
    const stroke = (node.getAttribute("stroke") || "").toLowerCase();
    const fill = (node.getAttribute("fill") || "").toLowerCase();
    const weight = Number(node.getAttribute("stroke-width"));
    return stroke === "#c9a227" && fill === "none" && Math.abs(weight - 4) < 0.3;
  });
  return candidates.sort((a, b) => b.getTotalLength() - a.getTotalLength());
}

function markerPixel(map: HTMLElement, route: Point[], event: SolarMarker) {
  const segments = splitDateLine(route);
  let paths = routePaths(map);
  if (paths.length < segments.length) return null;
  paths = paths.slice(0, segments.length);
  const segmentDistances = segments.map((segment) => segment.slice(1).reduce((sum, point, i) => sum + distanceNm(segment[i], point), 0));
  let remaining = event.routeDistanceNm;
  let index = 0;
  while (index < segmentDistances.length - 1 && remaining > segmentDistances[index]) { remaining -= segmentDistances[index]; index += 1; }
  const fraction = segmentDistances[index] > 0 ? clamp(remaining / segmentDistances[index], 0, 1) : 0;
  const path = paths[index];
  const length = path.getTotalLength();
  if (!(length > 0)) return null;
  const point = path.getPointAtLength(length * fraction);
  const matrix = path.getScreenCTM();
  const svg = path.ownerSVGElement;
  if (!matrix || !svg) return null;
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = point.x; svgPoint.y = point.y;
  const screen = svgPoint.matrixTransform(matrix);
  const rect = map.getBoundingClientRect();
  return { left: screen.x - rect.left, top: screen.y - rect.top };
}

function localLabel(event: SolarMarker) {
  const offset = clamp(Math.round(event.lon / 15), -12, 14);
  const local = new Date(event.date.getTime() + offset * 3600000);
  const time = local.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  const day = local.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "2-digit" });
  const zone = offset === 0 ? "UTC" : `UTC${offset > 0 ? "+" : ""}${offset}`;
  return { label: `${event.kind === "sunrise" ? "SUNRISE" : "SUNSET"} ${time}`, detail: `${day} ${time} LT (${zone})` };
}

export function BridgeSunRouteMarkersV2() {
  const pathname = usePathname();
  const [map, setMap] = useState<HTMLElement | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [pixels, setPixels] = useState<PixelMarker[]>([]);

  useEffect(() => {
    if (pathname !== "/") { setMap(null); return; }
    let timer = 0;
    const find = () => { const element = document.getElementById("v12-map"); if (element instanceof HTMLElement) setMap(element); else timer = window.setTimeout(find, 300); };
    find();
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    const sync = async () => {
      const local = loadRoute();
      if (local) { setRouteState(local); return; }
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok) return;
        const parsed = await response.json();
        const waypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints.map((p: any) => ({ lat: Number(p?.lat ?? p?.latitude), lon: Number(p?.lon ?? p?.lng ?? p?.longitude), id: p?.id, name: p?.name })).filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
        if (waypoints.length >= 2) setRouteState({ waypoints, activeWaypointIndex: Number(parsed?.activeWaypointIndex) || 1 });
      } catch {}
    };
    sync();
    const timer = window.setInterval(sync, 4000);
    return () => window.clearInterval(timer);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    let socket: WebSocket | null = null, retry = 0, stopped = false, latest: Motion | null = null;
    const connect = () => {
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          latest = motionFromMessage(String(event.data), latest);
          if (latest) setMotion({ ...latest });
        };
        socket.onclose = () => { if (!stopped) retry = window.setTimeout(connect, 3000); };
      } catch { retry = window.setTimeout(connect, 3000); }
    };
    connect();
    return () => { stopped = true; window.clearTimeout(retry); socket?.close(); };
  }, [pathname]);

  const events = useMemo(() => routeState && motion ? upcomingEvents(routeState.waypoints, routeState.activeWaypointIndex, motion) : [], [routeState, motion?.lat, motion?.lon, motion?.sog]);

  useEffect(() => {
    if (!map || !routeState) { setPixels([]); return; }
    const sync = () => setPixels(events.map((event) => {
      const pixel = markerPixel(map, routeState.waypoints, event);
      if (!pixel) return null;
      return { ...event, ...pixel, ...localLabel(event) };
    }).filter((item): item is PixelMarker => Boolean(item)));
    sync();
    const timer = window.setInterval(sync, 350);
    window.addEventListener("resize", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", sync); };
  }, [map, routeState, events]);

  if (pathname !== "/" || !map || !pixels.length) return null;
  return createPortal(<>{pixels.map((marker) => {
    const sunrise = marker.kind === "sunrise";
    return <div key={marker.kind} title={`${sunrise ? "Sunrise" : "Sunset"} predicted on active route · ${marker.detail}`} style={{ position: "absolute", left: marker.left, top: marker.top, zIndex: 1120, transform: "translate(-50%, -50%)", pointerEvents: "auto", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: "50%", display: "block", background: sunrise ? "#fbbf24" : "#f59e0b", border: "2px solid #071019", boxShadow: "0 0 0 1px rgba(255,255,255,.78), 0 1px 5px rgba(0,0,0,.65)" }} />
      <span style={{ padding: "3px 6px", borderRadius: 3, border: `1px solid ${sunrise ? "#fbbf24" : "#f59e0b"}`, background: "rgba(7,16,25,.92)", color: sunrise ? "#fde68a" : "#fdba74", font: "700 9px/1.1 system-ui,sans-serif", letterSpacing: ".045em", boxShadow: "0 1px 4px rgba(0,0,0,.4)" }}>{marker.label}</span>
    </div>;
  })}</>, map);
}
