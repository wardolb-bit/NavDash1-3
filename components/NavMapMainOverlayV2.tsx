"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type OwnShip = { lat: number; lon: number; sog: number; cog: number; heading: number | null };
type Waypoint = { id?: string; name?: string; lat: number; lon: number };
type UserMark = { id: string; name: string; lat: number; lon: number };
type MeasurePoint = { lat: number; lon: number };
type ToolMode = "pan" | "mark" | "measure";
type MeasureMode = "ship" | "points";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const MAP_VIEW_STORAGE_KEY = "navdash-main-map-view-v3";
const USER_CHART_STORAGE_KEY = "navdash-user-chart-v1";

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}
function payloadToBits(payload: string) {
  return payload.split("").map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}
function unsigned(bits: string, start: number, length: number) { return parseInt(bits.slice(start, start + length), 2); }
function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}
function decodeOwnShip(line: string): OwnShip | null {
  try {
    if (!line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;
    const sog = unsigned(bits, 50, 10) / 10;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cog = unsigned(bits, 116, 12) / 10;
    const headingRaw = unsigned(bits, 128, 9);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, sog, cog, heading: headingRaw === 511 ? null : headingRaw };
  } catch { return null; }
}

function destinationPoint(lat: number, lon: number, bearing: number, distanceNm: number) {
  const radiusNm = 3440.065;
  const distanceRad = distanceNm / radiusNm;
  const bearingRad = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceRad) + Math.cos(lat1) * Math.sin(distanceRad) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(distanceRad) * Math.cos(lat1), Math.cos(distanceRad) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180 };
}

function distanceAndBearing(from: MeasurePoint, to: MeasurePoint) {
  const radiusNm = 3440.065;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distanceNm = 2 * radiusNm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return { distanceNm, bearing: (bearing + 360) % 360 };
}

function longitudeNearReference(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function unwrapRouteNear(route: Waypoint[], referenceLon: number) {
  if (!route.length) return [] as Array<[number, number]>;
  const points: Array<[number, number]> = [];
  let previousLon = longitudeNearReference(route[0].lon, referenceLon);
  points.push([route[0].lat, previousLon]);
  for (let index = 1; index < route.length; index += 1) {
    const lon = longitudeNearReference(route[index].lon, previousLon);
    points.push([route[index].lat, lon]);
    previousLon = lon;
  }
  return points;
}

function normalizeRoutePayload(payload: any): Waypoint[] {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  return raw.map((wp: any) => ({
    id: typeof wp?.id === "string" ? wp.id : undefined,
    name: typeof wp?.name === "string" ? wp.name : undefined,
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function readSavedRoute() {
  try {
    const local = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (local) return normalizeRoutePayload(JSON.parse(local));
  } catch {}
  return [] as Waypoint[];
}

function routeSignature(route: Waypoint[]) {
  return route.map((wp) => `${wp.id || ""}|${wp.name || ""}|${wp.lat.toFixed(6)}|${wp.lon.toFixed(6)}`).join(";");
}


type CelestialKind = "sunrise" | "sunset" | "moonrise" | "moonset";
type CelestialEvent = { kind: CelestialKind; date: Date; lat: number; lon: number };
const cRad = (d: number) => d * Math.PI / 180;
const cDeg = (r: number) => r * 180 / Math.PI;
const cNorm = (v: number) => ((v % 360) + 360) % 360;

function cGmst(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return cNorm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000);
}

function cSunRaDec(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = cNorm(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = cNorm(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const c = Math.sin(cRad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(cRad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(cRad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = cRad(trueLong - 0.00569 - 0.00478 * Math.sin(cRad(omega)));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = cRad(eps0 + 0.00256 * Math.cos(cRad(omega)));
  return { ra: cNorm(cDeg(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)))), dec: cDeg(Math.asin(Math.sin(eps) * Math.sin(lambda))) };
}

function cMoonRaDec(date: Date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;
  const n = cNorm(125.1228 - 0.0529538083 * d), i = 5.1454, w = cNorm(318.0634 + 0.1643573223 * d), a = 60.2666, e = 0.0549, m = cNorm(115.3654 + 13.0649929509 * d);
  let E = cRad(m) + e * Math.sin(cRad(m)) * (1 + e * Math.cos(cRad(m)));
  for (let k = 0; k < 3; k += 1) E -= (E - e * Math.sin(E) - cRad(m)) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E), v = cDeg(Math.atan2(yv, xv)), r = Math.sqrt(xv * xv + yv * yv);
  const xh = r * (Math.cos(cRad(n)) * Math.cos(cRad(v + w)) - Math.sin(cRad(n)) * Math.sin(cRad(v + w)) * Math.cos(cRad(i)));
  const yh = r * (Math.sin(cRad(n)) * Math.cos(cRad(v + w)) + Math.cos(cRad(n)) * Math.sin(cRad(v + w)) * Math.cos(cRad(i)));
  const zh = r * Math.sin(cRad(v + w)) * Math.sin(cRad(i));
  const lon = cDeg(Math.atan2(yh, xh)), lat = cDeg(Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)));
  const ecl = cRad(23.4393 - 3.563e-7 * d);
  const xe = r * Math.cos(cRad(lon)) * Math.cos(cRad(lat)), ye = r * Math.sin(cRad(lon)) * Math.cos(cRad(lat)), ze = r * Math.sin(cRad(lat));
  const xeq = xe, yeq = ye * Math.cos(ecl) - ze * Math.sin(ecl), zeq = ye * Math.sin(ecl) + ze * Math.cos(ecl);
  return { ra: cNorm(cDeg(Math.atan2(yeq, xeq))), dec: cDeg(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq))) };
}

function cAltitude(lat: number, lon: number, date: Date, body: { ra: number; dec: number }) {
  const h = cRad(cNorm(cGmst(date) + lon - body.ra));
  return cDeg(Math.asin(Math.sin(cRad(lat)) * Math.sin(cRad(body.dec)) + Math.cos(cRad(lat)) * Math.cos(cRad(body.dec)) * Math.cos(h)));
}

function cRouteGeometry(route: Waypoint[], referenceLon: number) {
  const points = unwrapRouteNear(route, referenceLon);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceAndBearing({ lat: points[i - 1][0], lon: points[i - 1][1] }, { lat: points[i][0], lon: points[i][1] }).distanceNm);
  }
  return { points, cumulative };
}

function cCurrentAlong(points: Array<[number, number]>, cumulative: number[], ship: OwnShip) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lon1] = points[i - 1], [lat2, lon2] = points[i];
    const shipLon = longitudeNearReference(ship.lon, lon1);
    const refLat = cRad((lat1 + lat2 + ship.lat) / 3);
    const x1 = lon1 * 60 * Math.cos(refLat), y1 = lat1 * 60;
    const x2 = lon2 * 60 * Math.cos(refLat), y2 = lat2 * 60;
    const xs = shipLon * 60 * Math.cos(refLat), ys = ship.lat * 60;
    const vx = x2 - x1, vy = y2 - y1, wx = xs - x1, wy = ys - y1;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    const px = x1 + t * vx, py = y1 + t * vy;
    const dist = Math.hypot(xs - px, ys - py);
    if (dist < bestDistance) {
      bestDistance = dist;
      const legNm = cumulative[i] - cumulative[i - 1];
      bestAlong = cumulative[i - 1] + legNm * t;
    }
  }
  return bestAlong;
}

function cPositionAt(points: Array<[number, number]>, cumulative: number[], distanceNm: number) {
  const total = cumulative[cumulative.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distanceNm));
  let i = 0;
  while (i < points.length - 2 && cumulative[i + 1] < target) i += 1;
  const start = { lat: points[i][0], lon: points[i][1] }, end = { lat: points[i + 1][0], lon: points[i + 1][1] };
  const leg = distanceAndBearing(start, end);
  if (leg.distanceNm <= 0) return start;
  const pos = destinationPoint(start.lat, start.lon, leg.bearing, target - cumulative[i]);
  return { lat: pos.lat, lon: longitudeNearReference(pos.lon, start.lon) };
}

function cPredictEvents(route: Waypoint[], ship: OwnShip): CelestialEvent[] {
  if (route.length < 2) return [];
  const geometry = cRouteGeometry(route, ship.lon);
  const total = geometry.cumulative[geometry.cumulative.length - 1] || 0;
  const currentAlong = cCurrentAlong(geometry.points, geometry.cumulative, ship);
  const remaining = Math.max(0, total - currentAlong);
  if (remaining < 0.1) return [];
  const sog = Number.isFinite(ship.sog) && ship.sog > 0.5 ? ship.sog : 10;
  const maxMinutes = Math.min(7 * 24 * 60, remaining / sog * 60);
  const now = new Date();
  const found = new Map<CelestialKind, CelestialEvent>();
  const sample = (minutes: number) => {
    const pos = cPositionAt(geometry.points, geometry.cumulative, currentAlong + sog * minutes / 60);
    const date = new Date(now.getTime() + minutes * 60000);
    return { pos, date, sun: cAltitude(pos.lat, pos.lon, date, cSunRaDec(date)) + 0.833, moon: cAltitude(pos.lat, pos.lon, date, cMoonRaDec(date)) + 0.3 };
  };
  const step = 10;
  let previous = sample(0);
  for (let minutes = step; minutes <= maxMinutes; minutes += step) {
    const current = sample(minutes);
    const checks: Array<[CelestialKind, number, number]> = [["sunrise", previous.sun, current.sun], ["sunset", previous.sun, current.sun], ["moonrise", previous.moon, current.moon], ["moonset", previous.moon, current.moon]];
    for (const [kind, before, after] of checks) {
      if (found.has(kind)) continue;
      const rising = kind.endsWith("rise");
      if (!(rising ? before < 0 && after >= 0 : before >= 0 && after < 0)) continue;
      const denom = after - before;
      const f = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, -before / denom)) : 0.5;
      const refined = sample(minutes - step + step * f);
      found.set(kind, { kind, date: refined.date, lat: refined.pos.lat, lon: refined.pos.lon });
    }
    if (found.size === 4) break;
    previous = current;
  }
  return (["sunrise", "sunset", "moonrise", "moonset"] as CelestialKind[]).map((kind) => found.get(kind)).filter((event): event is CelestialEvent => Boolean(event));
}

function cLocalTime(event: CelestialEvent) {
  const wrappedLon = ((((event.lon + 180) % 360) + 360) % 360) - 180;
  const offset = Math.max(-12, Math.min(14, Math.round(wrappedLon / 15)));
  const local = new Date(event.date.getTime() + offset * 3600000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function readSavedMapView(): { lat: number; lon: number; zoom: number } | null {
  try {
    const raw = window.sessionStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lon = Number(parsed?.lon);
    const zoom = Number(parsed?.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || zoom < 1 || zoom > 19) return null;
    return { lat, lon, zoom };
  } catch { return null; }
}

function readUserChart(): UserMark[] {
  try {
    const raw = window.localStorage.getItem(USER_CHART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((mark: any, index: number) => ({
      id: typeof mark?.id === "string" ? mark.id : `mark-${index + 1}`,
      name: typeof mark?.name === "string" ? mark.name : `Mark ${index + 1}`,
      lat: Number(mark?.lat),
      lon: Number(mark?.lon),
    })).filter((mark: UserMark) => Number.isFinite(mark.lat) && Number.isFinite(mark.lon) && Math.abs(mark.lat) <= 90 && Math.abs(mark.lon) <= 180);
  } catch { return []; }
}

export function NavMapMainOverlayV2() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const findHost = () => {
      if (cancelled) return;
      const element = document.getElementById("v12-map");
      if (element) {
        if (getComputedStyle(element).position === "static") element.style.position = "relative";
        setHost(element);
        return;
      }
      timer = window.setTimeout(findHost, 100);
    };
    findHost();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  if (!host) return null;
  return createPortal(<IsolatedMainMap />, host);
}

function IsolatedMainMap() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const ownLayerRef = useRef<any>(null);
  const ownMarkerRef = useRef<any>(null);
  const headingVectorRef = useRef<any>(null);
  const cogVectorRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const routeMarkersRef = useRef<any[]>([]);
  const celestialLayerRef = useRef<any>(null);
  const userChartLayerRef = useRef<any>(null);
  const measurementLayerRef = useRef<any>(null);
  const routeSignatureRef = useRef("");
  const didInitialRouteFitRef = useRef(false);
  const didInitialOwnShipCenterRef = useRef(false);
  const toolModeRef = useRef<ToolMode>("pan");
  const measureModeRef = useRef<MeasureMode>("ship");
  const measureStartRef = useRef<MeasurePoint | null>(null);
  const ownShipRef = useRef<OwnShip | null>(null);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [toolMode, setToolMode] = useState<ToolMode>("pan");
  const [measureMode, setMeasureMode] = useState<MeasureMode>("ship");
  const [userMarks, setUserMarks] = useState<UserMark[]>([]);
  const [measurement, setMeasurement] = useState<{ distanceNm: number; bearing: number; source: MeasureMode } | null>(null);

  useEffect(() => { toolModeRef.current = toolMode; }, [toolMode]);
  useEffect(() => { measureModeRef.current = measureMode; }, [measureMode]);
  useEffect(() => { ownShipRef.current = ownShip; }, [ownShip]);

  useEffect(() => {
    const handleCenterOwnShip = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button || !/center\s+own\s+ship/i.test(button.textContent || "")) return;
      const ship = ownShipRef.current;
      const map = mapRef.current;
      if (!ship || !map) return;
      map.panTo([ship.lat, ship.lon], { animate: true, duration: 0.5 });
    };
    document.addEventListener("click", handleCenterOwnShip, true);
    return () => document.removeEventListener("click", handleCenterOwnShip, true);
  }, []);

  useEffect(() => { setUserMarks(readUserChart()); }, []);
  useEffect(() => { try { window.localStorage.setItem(USER_CHART_STORAGE_KEY, JSON.stringify(userMarks)); } catch {} }, [userMarks]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const timeouts: number[] = [];

    async function initMap() {
      const element = elementRef.current;
      if (!element || mapRef.current || cancelled) return;
      const L = await import("leaflet");
      if (cancelled) return;

      if (!document.querySelector('link[data-navmap-main-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-navmap-main-leaflet", "true");
        document.head.appendChild(link);
      }

      const savedView = readSavedMapView();
      const map = L.map(element, { zoomControl: true, attributionControl: false, preferCanvas: false, worldCopyJump: true, minZoom: 3 });
      if (savedView) {
        map.setView([savedView.lat, savedView.lon], savedView.zoom, { animate: false });
        didInitialRouteFitRef.current = true;
      } else {
        map.setView([13.4443, 144.7937], 7, { animate: false });
      }

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      try {
        L.tileLayer.wms("https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer", {
          layers: "0,1,2,3,4,5,6,7,8,9,10,11,12", format: "image/png", transparent: true, version: "1.1.1", opacity: 0.85,
        } as any).addTo(map);
      } catch {}

      const ownPane = map.createPane("navmap-main-ownship-v2");
      ownPane.style.zIndex = "720";
      const toolPane = map.createPane("navmap-main-tools-v1");
      toolPane.style.zIndex = "730";
      const celestialPane = map.createPane("navmap-main-celestial-v1");
      celestialPane.style.zIndex = "740";
      ownLayerRef.current = L.layerGroup([], { pane: "navmap-main-ownship-v2" } as any).addTo(map);
      userChartLayerRef.current = L.layerGroup([], { pane: "navmap-main-tools-v1" } as any).addTo(map);
      measurementLayerRef.current = L.layerGroup([], { pane: "navmap-main-tools-v1" } as any).addTo(map);
      celestialLayerRef.current = L.layerGroup([], { pane: "navmap-main-celestial-v1" } as any).addTo(map);
      mapRef.current = map;

      const drawMeasurement = (start: MeasurePoint, end: MeasurePoint, source: MeasureMode) => {
        const result = distanceAndBearing(start, end);
        measurementLayerRef.current?.clearLayers();
        L.polyline([[start.lat, start.lon], [end.lat, end.lon]], { pane: "navmap-main-tools-v1", color: "#22d3ee", weight: 3, opacity: 0.95, dashArray: "8 6" }).addTo(measurementLayerRef.current);
        if (source === "points") {
          L.circleMarker([start.lat, start.lon], { pane: "navmap-main-tools-v1", radius: 5, color: "#22d3ee", fillColor: "#071019", fillOpacity: 1, weight: 2 }).addTo(measurementLayerRef.current);
        }
        L.circleMarker([end.lat, end.lon], { pane: "navmap-main-tools-v1", radius: 5, color: "#22d3ee", fillColor: "#071019", fillOpacity: 1, weight: 2 }).addTo(measurementLayerRef.current);
        const midpoint: [number, number] = [(start.lat + end.lat) / 2, (start.lon + end.lon) / 2];
        L.tooltip({ permanent: true, direction: "center", className: "navmap-measure-label", pane: "navmap-main-tools-v1" })
          .setLatLng(midpoint)
          .setContent(`${result.bearing.toFixed(1)}°T · ${result.distanceNm.toFixed(2)} NM`)
          .addTo(measurementLayerRef.current);
        setMeasurement({ ...result, source });
      };

      const handleMapClick = (event: any) => {
        const point = { lat: Number(event.latlng.lat), lon: Number(event.latlng.lng) };
        if (toolModeRef.current === "mark") {
          setUserMarks((current) => [...current, { id: `mark-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `Mark ${current.length + 1}`, lat: point.lat, lon: point.lon }]);
          return;
        }
        if (toolModeRef.current !== "measure") return;
        if (measureModeRef.current === "ship") {
          const ship = ownShipRef.current;
          if (!ship) return;
          measureStartRef.current = null;
          drawMeasurement({ lat: ship.lat, lon: ship.lon }, point, "ship");
          return;
        }
        if (!measureStartRef.current) {
          measureStartRef.current = point;
          setMeasurement(null);
          measurementLayerRef.current?.clearLayers();
          L.circleMarker([point.lat, point.lon], { pane: "navmap-main-tools-v1", radius: 5, color: "#22d3ee", fillColor: "#071019", fillOpacity: 1, weight: 2 }).addTo(measurementLayerRef.current);
          return;
        }
        const start = measureStartRef.current;
        measureStartRef.current = null;
        drawMeasurement(start, point, "points");
      };
      map.on("click", handleMapClick);
      (element as any).__navmapMainClickV2 = handleMapClick;

      const persistView = () => {
        try {
          const center = map.getCenter();
          window.sessionStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({ lat: center.lat, lon: center.lng, zoom: map.getZoom() }));
        } catch {}
      };
      map.on("moveend", persistView);
      map.on("zoomend", persistView);
      (element as any).__navmapMainPersistV2 = persistView;

      const invalidate = () => requestAnimationFrame(() => map.invalidateSize({ animate: false }));
      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(element);
      window.addEventListener("resize", invalidate);
      (element as any).__navmapMainInvalidateV2 = invalidate;
      for (const delay of [0, 80, 220, 500, 1000]) timeouts.push(window.setTimeout(invalidate, delay));
    }

    initMap();
    return () => {
      cancelled = true;
      timeouts.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      const element = elementRef.current as any;
      if (element?.__navmapMainInvalidateV2) window.removeEventListener("resize", element.__navmapMainInvalidateV2);
      if (mapRef.current) {
        const clickHandler = element?.__navmapMainClickV2;
        if (clickHandler) mapRef.current.off("click", clickHandler);
        const persistView = element?.__navmapMainPersistV2;
        if (persistView) {
          persistView();
          mapRef.current.off("moveend", persistView);
          mapRef.current.off("zoomend", persistView);
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
      ownLayerRef.current = null; ownMarkerRef.current = null; headingVectorRef.current = null; cogVectorRef.current = null;
      routeLayerRef.current = null; routeMarkersRef.current = [];
      userChartLayerRef.current = null; measurementLayerRef.current = null; celestialLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try { const json = JSON.parse(raw); raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw; } catch {}
          for (const line of raw.split(/\r?\n/)) { const decoded = decodeOwnShip(line.trim()); if (decoded) setOwnShip(decoded); }
        };
        socket.onclose = () => { if (!closed) retryTimer = window.setTimeout(connect, 2000); };
      } catch { retryTimer = window.setTimeout(connect, 2000); }
    };
    connect();
    return () => { closed = true; window.clearTimeout(retryTimer); if (socket) { socket.onclose = null; socket.close(); } };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      if (cancelled) return;
      let nextRoute = readSavedRoute();
      if (nextRoute.length < 2) {
        try { const response = await fetch("/api/route-state", { cache: "no-store" }); if (response.ok) nextRoute = normalizeRoutePayload(await response.json()); } catch {}
      }
      const signature = routeSignature(nextRoute);
      if (signature !== routeSignatureRef.current) { routeSignatureRef.current = signature; setRoute(nextRoute); }
      timer = window.setTimeout(refresh, 1500);
    };
    refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    async function updateRoute() {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      if (routeLayerRef.current) { try { map.removeLayer(routeLayerRef.current); } catch {} routeLayerRef.current = null; }
      for (const marker of routeMarkersRef.current) { try { map.removeLayer(marker); } catch {} }
      routeMarkersRef.current = [];
      if (route.length < 2) return;
      const referenceLon = ownShip?.lon ?? map.getCenter().lng;
      const points = unwrapRouteNear(route, referenceLon);
      const worldOffsets = [-360, 0, 360];
      const routeCopies = worldOffsets.map((offset) => L.polyline(points.map(([lat, lon]) => [lat, lon + offset]) as any, { color: "#c9a227", weight: 4, opacity: 0.95 }));
      routeLayerRef.current = L.layerGroup(routeCopies).addTo(map);
      routeMarkersRef.current = worldOffsets.flatMap((offset) => route.map((wp, index) => L.circleMarker([points[index][0], points[index][1] + offset] as any, { radius: 5, color: "#c9a227", fillColor: "#c9a227", fillOpacity: 0.85, weight: 2 }).bindTooltip(`${wp.id || `WP${index + 1}`} ${wp.name || ""}`.trim()).addTo(map)));
      didInitialRouteFitRef.current = true;
    }
    updateRoute();
  }, [route, ownShip ? Math.round((ownShip.lon - (route[0]?.lon ?? ownShip.lon)) / 360) : 0]);

  useEffect(() => {
    async function updateCelestial() {
      const map = mapRef.current;
      const layer = celestialLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (!ownShip || route.length < 2) return;
      const events = cPredictEvents(route, ownShip);
      const centerLon = map.getCenter().lng;
      for (const event of events) {
        const baseLon = longitudeNearReference(event.lon, centerLon);
        const isSun = event.kind.startsWith("sun");
        const isRise = event.kind.endsWith("rise");
        const color = isSun ? (isRise ? "#fbbf24" : "#f59e0b") : (isRise ? "#a5b4fc" : "#818cf8");
        const label = `${event.kind.toUpperCase()} ${cLocalTime(event)}`;
        for (const offset of [-360, 0, 360]) {
          L.circleMarker([event.lat, baseLon + offset], {
            pane: "navmap-main-celestial-v1",
            radius: 7,
            color: "#071019",
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          }).bindTooltip(label, { permanent: true, direction: "right", offset: [9, 0], opacity: 0.96, pane: "navmap-main-celestial-v1" }).addTo(layer);
        }
      }
    }
    updateCelestial();
  }, [route, ownShip?.lat, ownShip?.lon, ownShip?.sog]);

  useEffect(() => {
    async function updateUserChart() {
      const layer = userChartLayerRef.current;
      if (!layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      for (const mark of userMarks) {
        const marker = L.circleMarker([mark.lat, mark.lon], { pane: "navmap-main-tools-v1", radius: 6, color: "#f1d56b", fillColor: "#071019", fillOpacity: 1, weight: 2 }).addTo(layer);
        marker.bindTooltip(`${mark.name}<br>${mark.lat.toFixed(5)}, ${mark.lon.toFixed(5)}`);
      }
    }
    updateUserChart();
  }, [userMarks]);

  useEffect(() => {
    async function updateOwnShip() {
      const map = mapRef.current;
      const layer = ownLayerRef.current;
      if (!map || !layer || !ownShip) return;
      const L = await import("leaflet");
      const displayLon = longitudeNearReference(ownShip.lon, map.getCenter().lng);
      const position: [number, number] = [ownShip.lat, displayLon];
      if (!didInitialOwnShipCenterRef.current) { didInitialOwnShipCenterRef.current = true; map.setView(position, Math.max(map.getZoom(), 7), { animate: false }); }
      const orientation = ownShip.heading !== null && Number.isFinite(ownShip.heading) ? ownShip.heading : ownShip.cog;
      const icon = L.divIcon({ className: "navmap-main-ownship-icon", html: `<div style="width:30px;height:30px;transform:rotate(${orientation}deg);transform-origin:15px 15px;filter:drop-shadow(0 0 5px rgba(34,211,238,.35))"><svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#071019" stroke="#22d3ee" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#f1d56b" stroke-width="1.5"/><circle cx="15" cy="15" r="2.4" fill="#22d3ee"/></svg></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      if (!ownMarkerRef.current) ownMarkerRef.current = L.marker(position, { icon, pane: "navmap-main-ownship-v2", interactive: false }).addTo(layer);
      else { ownMarkerRef.current.setLatLng(position); ownMarkerRef.current.setIcon(icon); }
      if (headingVectorRef.current) layer.removeLayer(headingVectorRef.current);
      if (cogVectorRef.current) layer.removeLayer(cogVectorRef.current);
      headingVectorRef.current = null; cogVectorRef.current = null;
      if (ownShip.heading !== null && Number.isFinite(ownShip.heading)) {
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.heading, 0.8);
        headingVectorRef.current = L.polyline([position, [end.lat, longitudeNearReference(end.lon, displayLon)]], { pane: "navmap-main-ownship-v2", color: "#f1d56b", weight: 2, opacity: 0.9 }).addTo(layer);
      }
      if (Number.isFinite(ownShip.sog) && ownShip.sog > 0.1 && Number.isFinite(ownShip.cog)) {
        const distanceNm = ownShip.sog * (6 / 60);
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.cog, distanceNm);
        cogVectorRef.current = L.polyline([position, [end.lat, longitudeNearReference(end.lon, displayLon)]], { pane: "navmap-main-ownship-v2", color: "#22d3ee", weight: 2.5, opacity: 0.95, dashArray: "8 6" }).addTo(layer);
      }
    }
    updateOwnShip();
  }, [ownShip]);

  const clearMeasurement = () => { measureStartRef.current = null; setMeasurement(null); measurementLayerRef.current?.clearLayers(); };
  const setRangeBearingMode = (mode: MeasureMode) => { setToolMode("measure"); setMeasureMode(mode); measureStartRef.current = null; setMeasurement(null); measurementLayerRef.current?.clearLayers(); };
  const clearUserChart = () => { if (!window.confirm("Clear all user chart marks?")) return; setUserMarks([]); };

  const buttonStyle = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "#22d3ee" : "rgba(241,213,107,.45)"}`,
    background: active ? "rgba(34,211,238,.16)" : "rgba(7,16,25,.90)",
    color: active ? "#d9fbff" : "#f1d56b",
    minHeight: 36,
    padding: "7px 11px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".08em",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <>
      <div ref={elementRef} id="navmap-main-isolated-v2" style={{ position: "absolute", inset: 0, zIndex: 650, width: "100%", height: "100%", minHeight: "100%", background: "#0a141d" }} />
      <div style={{ position: "absolute", zIndex: 760, top: 10, left: 54, right: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 6, padding: 6, border: "1px solid rgba(241,213,107,.28)", borderRadius: 7, background: "rgba(5,12,18,.88)", backdropFilter: "blur(6px)", pointerEvents: "auto", flexWrap: "wrap" }}>
          <button type="button" style={buttonStyle(toolMode === "pan")} onClick={() => { setToolMode("pan"); clearMeasurement(); }}>PAN</button>
          <button type="button" style={buttonStyle(toolMode === "mark")} onClick={() => { setToolMode("mark"); clearMeasurement(); }}>USER CHART</button>
          <button type="button" style={buttonStyle(toolMode === "measure" && measureMode === "ship")} onClick={() => setRangeBearingMode("ship")}>FROM SHIP</button>
          <button type="button" style={buttonStyle(toolMode === "measure" && measureMode === "points")} onClick={() => setRangeBearingMode("points")}>TWO POINTS</button>
          <button type="button" style={buttonStyle(false)} onClick={clearMeasurement}>CLEAR MEASURE</button>
          <button type="button" style={buttonStyle(false)} onClick={clearUserChart} disabled={userMarks.length === 0}>CLEAR MARKS</button>
        </div>
        <div style={{ padding: "8px 10px", minHeight: 36, display: "flex", alignItems: "center", border: "1px solid rgba(34,211,238,.28)", borderRadius: 6, background: "rgba(5,12,18,.88)", color: "#d7e7ee", fontSize: 12, fontWeight: 650, pointerEvents: "auto" }}>
          {toolMode === "measure" && measureMode === "ship" && !measurement ? (ownShip ? "Tap map for range / bearing from ship" : "Waiting for AIS position") : null}
          {toolMode === "measure" && measureMode === "points" && !measurement ? (measureStartRef.current ? "Select end point" : "Select start point") : null}
          {toolMode === "mark" ? `Tap map to add mark · ${userMarks.length} saved` : null}
          {measurement ? `${measurement.source === "ship" ? "SHIP → " : ""}${measurement.bearing.toFixed(1)}°T · ${measurement.distanceNm.toFixed(2)} NM` : null}
          {toolMode === "pan" && !measurement ? `${userMarks.length} user mark${userMarks.length === 1 ? "" : "s"}` : null}
        </div>
      </div>
      <style>{`.navmap-measure-label{background:#071019!important;border:1px solid #22d3ee!important;color:#d9fbff!important;box-shadow:none!important;font:700 12px/1.2 system-ui,sans-serif!important;padding:5px 7px!important}.navmap-measure-label:before{display:none!important}`}</style>
    </>
  );
}
