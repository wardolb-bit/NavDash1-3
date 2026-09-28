"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { name: string; lat: number; lon: number };
type ForecastPoint = {
  lat: number; lon: number; distanceNm: number;
  windKt: number | null; windDirectionDeg: number | null; gustKt: number | null;
  waveHeightFt: number | null; wavePeriodSec: number | null; waveDirectionDeg?: number | null;
  source: string; waveSource?: string;
};
type WeatherFrame = { validAt: string; points: ForecastPoint[] };
type WeatherResponse = {
  provider: string; product: string; generatedAt: string;
  modelRun?: string | null; modelCycle?: string | null;
  waveModelRun?: string | null; waveModelCycle?: string | null; waveProduct?: string | null;
  sampleCount: number; coveredSampleCount: number; frames: WeatherFrame[]; note?: string | null;
};
type WaveResponse = {
  provider?: string; product: string; modelRun?: string | null; modelCycle?: string | null;
  frames: Array<{ validAt: string; points: Array<{
    lat: number; lon: number; distanceNm: number; waveHeightFt: number | null;
    wavePeriodSec: number | null; waveDirectionDeg: number | null; source: string;
  }> }>;
};
type EncounterPoint = ForecastPoint & { eta: Date; validAt: Date; beyondHorizon: boolean };

const DEPARTURE_KEY = "navdash-route-weather-departure";
const SPEED_KEY = "navdash-route-weather-speed-kt";

function cloneRoute(route: Waypoint[]) { return route.map((wp) => ({ ...wp })); }
function normalizeLon(lon: number) { let next = lon; while (next > 180) next -= 360; while (next < -180) next += 360; return next; }
function longitudeNearReference(lon: number, referenceLon: number) { let adjusted = lon; while (adjusted - referenceLon > 180) adjusted -= 360; while (adjusted - referenceLon < -180) adjusted += 360; return adjusted; }
function unwrapRouteForDisplay(route: Waypoint[]) {
  if (!route.length) return [] as Waypoint[];
  const result = [{ ...route[0] }];
  for (let i = 1; i < route.length; i += 1) result.push({ ...route[i], lon: longitudeNearReference(route[i].lon, result[i - 1].lon) });
  return result;
}
function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065; const p1 = a.lat * Math.PI / 180; const p2 = b.lat * Math.PI / 180; const dp = (b.lat - a.lat) * Math.PI / 180;
  let dl = (b.lon - a.lon) * Math.PI / 180; if (dl > Math.PI) dl -= Math.PI * 2; if (dl < -Math.PI) dl += Math.PI * 2;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearingBetween(a: Waypoint, b: Waypoint) {
  const p1 = a.lat * Math.PI / 180; const p2 = b.lat * Math.PI / 180; let dl = (b.lon - a.lon) * Math.PI / 180;
  if (dl > Math.PI) dl -= Math.PI * 2; if (dl < -Math.PI) dl += Math.PI * 2;
  const y = Math.sin(dl) * Math.cos(p2); const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function routeLengthNm(route: Waypoint[]) { let total = 0; for (let i = 1; i < route.length; i += 1) total += nmBetween(route[i - 1], route[i]); return total; }
function routeWaypointDistances(route: Waypoint[]) { const out: number[] = []; let total = 0; route.forEach((wp, i) => { if (i > 0) total += nmBetween(route[i - 1], wp); out.push(total); }); return out; }
function pointAtDistance(route: Waypoint[], targetNm: number) {
  if (!route.length) return null;
  const display = unwrapRouteForDisplay(route);
  if (display.length === 1 || targetNm <= 0) return display[0];
  let travelled = 0;
  for (let i = 1; i < route.length; i += 1) {
    const legNm = nmBetween(route[i - 1], route[i]);
    if (travelled + legNm >= targetNm) {
      const ratio = legNm <= 0 ? 0 : (targetNm - travelled) / legNm;
      return {
        name: "Forecast horizon",
        lat: display[i - 1].lat + (display[i].lat - display[i - 1].lat) * ratio,
        lon: display[i - 1].lon + (display[i].lon - display[i - 1].lon) * ratio,
      };
    }
    travelled += legNm;
  }
  return display[display.length - 1];
}
function routeSlice(route: Waypoint[], startNm: number, endNm: number) {
  if (route.length < 2) return [] as Array<[number, number]>;
  const total = routeLengthNm(route);
  const start = Math.max(0, Math.min(total, startNm));
  const end = Math.max(start, Math.min(total, endNm));
  const startPoint = pointAtDistance(route, start);
  const endPoint = pointAtDistance(route, end);
  if (!startPoint || !endPoint) return [] as Array<[number, number]>;
  const display = unwrapRouteForDisplay(route);
  const distances = routeWaypointDistances(route);
  const points: Array<[number, number]> = [[startPoint.lat, startPoint.lon]];
  display.forEach((wp, i) => { if (distances[i] > start && distances[i] < end) points.push([wp.lat, wp.lon]); });
  points.push([endPoint.lat, longitudeNearReference(endPoint.lon, points[points.length - 1][1])]);
  return points;
}
function parseRtz(text: string): { routeName: string; waypoints: Waypoint[] } {
  const doc = new DOMParser().parseFromString(text, "application/xml"); if (doc.querySelector("parsererror")) throw new Error("RTZ XML could not be parsed.");
  const routeInfo = doc.querySelector("routeInfo");
  const waypoints = Array.from(doc.querySelectorAll("waypoint")).map((node, index) => { const pos = node.querySelector("position"); return { name: node.getAttribute("name") || `WP${String(index + 1).padStart(2, "0")}`, lat: Number(pos?.getAttribute("lat")), lon: Number(pos?.getAttribute("lon")) }; }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return { routeName: routeInfo?.getAttribute("routeName") || "Imported Route", waypoints };
}
function xmlEscape(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function buildRtz(routeName: string, route: Waypoint[]) {
  const safeName = routeName.trim() || "NavDash Route";
  const waypointXml = route.map((wp, i) => `    <waypoint id="${i + 1}" name="${xmlEscape(wp.name || `WP${String(i + 1).padStart(2, "0")}`)}">\n      <position lat="${wp.lat.toFixed(8)}" lon="${normalizeLon(wp.lon).toFixed(8)}"/>\n      ${i === 0 ? "" : '<leg portsideXTD="0.10" starboardXTD="0.10" geometryType="Loxodrome"/>'}\n    </waypoint>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<route xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.cirm.org/RTZ/1/0" version="1.0" xsi:schemaLocation="http://www.cirm.org/RTZ/1/0 rtz.xsd">\n  <routeInfo routeName="${xmlEscape(safeName)}" routeAuthor="NavDash"/>\n  <waypoints>\n    <defaultWaypoint radius="0.10">\n      <leg portsideXTD="0.10" starboardXTD="0.10" geometryType="Loxodrome"/>\n    </defaultWaypoint>\n${waypointXml}\n  </waypoints>\n</route>\n`;
}
function seaColor(wave: number | null | undefined) { if (wave == null || !Number.isFinite(wave)) return "#64748b"; if (wave >= 10) return "#ef4444"; if (wave >= 7) return "#f59e0b"; if (wave >= 5) return "#eab308"; return "#22c55e"; }
function compass(deg: number | null | undefined) { if (deg == null || !Number.isFinite(deg)) return "--"; const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]; return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }
function formatUtc(value: string | Date | null | undefined) {
  if (!value) return "--"; const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date).replace(",", "") + "Z";
}
function mergeWave(base: WeatherResponse, wave: WaveResponse | null): WeatherResponse {
  if (!wave?.frames?.length) return base;
  return {
    ...base,
    product: `${base.product} + ${wave.product}`,
    waveProduct: wave.product,
    waveModelRun: wave.modelRun || null,
    waveModelCycle: wave.modelCycle || null,
    frames: base.frames.map((frame) => {
      const target = new Date(frame.validAt).getTime(); let bestFrame = wave.frames[0]; let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - target);
      for (const candidate of wave.frames) { const delta = Math.abs(new Date(candidate.validAt).getTime() - target); if (delta < bestDelta) { bestFrame = candidate; bestDelta = delta; } }
      return { ...frame, points: frame.points.map((point) => {
        let nearest = bestFrame.points[0]; let nearestDelta = Number.POSITIVE_INFINITY;
        for (const candidate of bestFrame.points) { const delta = Math.abs(candidate.distanceNm - point.distanceNm); if (delta < nearestDelta) { nearest = candidate; nearestDelta = delta; } }
        return nearest ? { ...point, waveHeightFt: nearest.waveHeightFt, wavePeriodSec: nearest.wavePeriodSec, waveDirectionDeg: nearest.waveDirectionDeg, waveSource: nearest.source } : point;
      }) };
    }),
  };
}

export default function RouteSandboxPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const mapEl = useRef<HTMLDivElement | null>(null); const mapRef = useRef<any>(null); const routeLayerRef = useRef<any>(null); const weatherLayerRef = useRef<any>(null); const fitNextRef = useRef(true);
  const baseLayerRef = useRef<any>(null); const seamarkLayerRef = useRef<any>(null); const encLayerRef = useRef<any>(null);
  const historyRef = useRef<Waypoint[][]>([]); const redoRef = useRef<Waypoint[][]>([]);
  const [route, setRoute] = useState<Waypoint[]>([]); const [baseline, setBaseline] = useState<Waypoint[]>([]); const [routeName, setRouteName] = useState("No route loaded");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null); const [addMode, setAddMode] = useState(false); const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [status, setStatus] = useState("Load the current NavDash route or an RTZ file, then reshape it on the chart."); const [analyzing, setAnalyzing] = useState(false); const [speedKt, setSpeedKt] = useState(9);
  const [departure, setDeparture] = useState(() => { const now = new Date(); now.setMinutes(0, 0, 0); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`; });

  const panel = day ? "border-slate-300 bg-white" : "border-slate-700/50 bg-[#071019]";
  const cell = day ? "border-slate-300 bg-slate-50" : "border-slate-800 bg-[#050a0f]";
  const muted = day ? "text-slate-600" : "text-slate-400";

  const totalNm = useMemo(() => routeLengthNm(route), [route]);
  const distances = useMemo(() => routeWaypointDistances(route), [route]);
  const legs = useMemo(() => route.slice(1).map((wp, i) => ({ from: route[i], to: wp, course: bearingBetween(route[i], wp), distance: nmBetween(route[i], wp) })), [route]);

  const forecastCoverage = useMemo(() => {
    const voyageHours = speedKt > 0 ? totalNm / speedKt : 0; const dep = new Date(departure);
    if (!weather?.frames?.length || !Number.isFinite(dep.getTime()) || voyageHours <= 0) return { voyageHours, coveredHours: 0, coveredNm: 0, uncoveredNm: totalNm, percent: 0, latestValid: null as Date | null };
    const times = weather.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite); if (!times.length) return { voyageHours, coveredHours: 0, coveredNm: 0, uncoveredNm: totalNm, percent: 0, latestValid: null as Date | null };
    const latestMs = Math.max(...times); const availableHours = Math.max(0, (latestMs - dep.getTime()) / 3600000); const coveredHours = Math.min(voyageHours, availableHours); const coveredNm = Math.min(totalNm, coveredHours * speedKt);
    return { voyageHours, coveredHours, coveredNm, uncoveredNm: Math.max(0, totalNm - coveredNm), percent: totalNm > 0 ? coveredNm / totalNm * 100 : 0, latestValid: new Date(latestMs) };
  }, [weather, departure, totalNm, speedKt]);

  const encounter = useMemo<EncounterPoint[]>(() => {
    if (!weather?.frames?.length || speedKt <= 0) return []; const dep = new Date(departure); if (!Number.isFinite(dep.getTime())) return [];
    const latestMs = Math.max(...weather.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite)); const points = weather.frames[0]?.points || [];
    return points.map((first, index) => {
      const eta = new Date(dep.getTime() + first.distanceNm / speedKt * 3600000); let bestFrame = weather.frames[0]; let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - eta.getTime());
      for (const frame of weather.frames) { const delta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime()); if (delta < bestDelta) { bestFrame = frame; bestDelta = delta; } }
      const point = bestFrame.points[index] || first; const beyondHorizon = eta.getTime() > latestMs;
      if (beyondHorizon) return { ...point, windKt: null, windDirectionDeg: null, gustKt: null, waveHeightFt: null, wavePeriodSec: null, waveDirectionDeg: null, source: "Outside forecast horizon", waveSource: undefined, eta, validAt: new Date(latestMs), beyondHorizon: true };
      return { ...point, eta, validAt: new Date(bestFrame.validAt), beyondHorizon: false };
    });
  }, [weather, speedKt, departure]);

  const coveredEncounter = useMemo(() => encounter.filter((p) => !p.beyondHorizon && p.distanceNm <= forecastCoverage.coveredNm + 0.5), [encounter, forecastCoverage.coveredNm]);
  const maxSea = useMemo(() => coveredEncounter.reduce<EncounterPoint | null>((best, p) => p.waveHeightFt != null && (!best || best.waveHeightFt == null || p.waveHeightFt > best.waveHeightFt) ? p : best, null), [coveredEncounter]);
  const maxWind = useMemo(() => coveredEncounter.reduce<EncounterPoint | null>((best, p) => p.windKt != null && (!best || best.windKt == null || p.windKt > best.windKt) ? p : best, null), [coveredEncounter]);

  useEffect(() => { try { const savedDeparture = window.localStorage.getItem(DEPARTURE_KEY); const savedSpeed = Number(window.localStorage.getItem(SPEED_KEY)); if (savedDeparture) setDeparture(savedDeparture); if (Number.isFinite(savedSpeed) && savedSpeed > 0) setSpeedKt(savedSpeed); } catch {} }, []);

  useEffect(() => {
    let cancelled = false;
    async function initMap() {
      if (!mapEl.current || mapRef.current) return; const L = await import("leaflet"); if (cancelled || !mapEl.current) return;
      if (!document.querySelector('link[data-route-sandbox-leaflet="true"]')) { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; link.setAttribute("data-route-sandbox-leaflet", "true"); document.head.appendChild(link); }
      const map = L.map(mapEl.current, { attributionControl: false, zoomControl: true, worldCopyJump: true }).setView([20, 0], 3);
      routeLayerRef.current = L.layerGroup().addTo(map); weatherLayerRef.current = L.layerGroup().addTo(map);
      map.on("click", (event: any) => { if (!(map as any).__navdashAddMode) return; window.dispatchEvent(new CustomEvent("navdash-route-sandbox-add", { detail: { lat: event.latlng.lat, lon: normalizeLon(event.latlng.lng) } })); });
      mapRef.current = map; setTimeout(() => map.invalidateSize(), 100);
    }
    void initMap(); return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    async function applyMapTheme() {
      const map = mapRef.current; if (!map) return; const L = await import("leaflet");
      for (const layer of [baseLayerRef.current, seamarkLayerRef.current, encLayerRef.current]) { if (layer) try { map.removeLayer(layer); } catch {} }
      baseLayerRef.current = null; seamarkLayerRef.current = null; encLayerRef.current = null;
      if (mapEl.current) mapEl.current.style.background = day ? "#dbe5e8" : "#071019";
      if (day) {
        baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
        seamarkLayerRef.current = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      }
      encLayerRef.current = L.tileLayer.wms("/api/noaa-charts/wms", { layers: day ? "0,1,2,3,4,5,6,7" : "1,2,3,4,5,6,7", format: "image/png", transparent: true, version: "1.1.1", opacity: day ? 0.88 : 1, tileSize: 512, maxZoom: 18 } as any).addTo(map);
      routeLayerRef.current?.bringToFront?.(); weatherLayerRef.current?.bringToFront?.();
    }
    void applyMapTheme();
  }, [day]);

  useEffect(() => { if (mapRef.current) (mapRef.current as any).__navdashAddMode = addMode; }, [addMode]);
  useEffect(() => {
    const handler = (event: Event) => { const detail = (event as CustomEvent<{ lat: number; lon: number }>).detail; if (!detail) return; pushHistory(); setRoute((current) => { const insertAt = selectedIndex == null ? current.length : selectedIndex + 1; const next = cloneRoute(current); next.splice(insertAt, 0, { name: `WP${String(insertAt + 1).padStart(2, "0")}`, lat: detail.lat, lon: detail.lon }); return next.map((wp, i) => ({ ...wp, name: wp.name || `WP${String(i + 1).padStart(2, "0")}` })); }); setWeather(null); setStatus("Waypoint added. Re-run weather when the option looks right."); };
    window.addEventListener("navdash-route-sandbox-add", handler); return () => window.removeEventListener("navdash-route-sandbox-add", handler);
  }, [selectedIndex, route]);

  useEffect(() => {
    async function drawRoute() {
      const map = mapRef.current; const layer = routeLayerRef.current; if (!map || !layer) return; const L = await import("leaflet"); layer.clearLayers(); if (!route.length) return;
      const display = unwrapRouteForDisplay(route); const latlngs = display.map((wp) => [wp.lat, wp.lon] as [number, number]);
      if (latlngs.length > 1) {
        if (weather && forecastCoverage.coveredNm < totalNm - 0.5) {
          const covered = routeSlice(route, 0, forecastCoverage.coveredNm); const uncovered = routeSlice(route, forecastCoverage.coveredNm, totalNm);
          if (covered.length > 1) L.polyline(covered, { color: "#22d3ee", weight: 4, opacity: 0.98 }).addTo(layer);
          if (uncovered.length > 1) L.polyline(uncovered, { color: day ? "#64748b" : "#94a3b8", weight: 3, opacity: 0.7, dashArray: "10 9" }).bindTooltip("ROUTE BEYOND CURRENT FORECAST HORIZON", { sticky: true }).addTo(layer);
          const edge = pointAtDistance(route, forecastCoverage.coveredNm);
          if (edge) {
            const edgeIcon = L.divIcon({ className: "", html: `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap;transform:translate(-11px,-11px)"><div style="width:22px;height:22px;border-radius:50%;background:#f59e0b;border:3px solid #fff7c2;box-shadow:0 0 0 3px rgba(245,158,11,.3)"></div><div style="background:${day ? "rgba(255,255,255,.96)" : "rgba(7,16,25,.96)"};color:${day ? "#17212b" : "#f8fafc"};border:1px solid #f59e0b;padding:4px 6px;font:800 9px/1.1 system-ui,sans-serif;letter-spacing:.05em">FORECAST ENDS<br/>${forecastCoverage.coveredNm.toFixed(0)} NM</div></div>`, iconSize: [118, 38], iconAnchor: [11, 11] });
            L.marker([edge.lat, edge.lon], { icon: edgeIcon, interactive: true }).bindTooltip(`Forecast valid through ${formatUtc(forecastCoverage.latestValid)}<br/>${forecastCoverage.uncoveredNm.toFixed(0)} NM remains beyond current horizon`, { direction: "top" }).addTo(layer);
          }
        } else {
          L.polyline(latlngs, { color: "#22d3ee", weight: 3, opacity: 0.95 }).addTo(layer);
        }
      }
      display.forEach((wp, index) => { const selected = selectedIndex === index; const icon = L.divIcon({ className: "", html: `<div style="width:${selected ? 20 : 16}px;height:${selected ? 20 : 16}px;border-radius:50%;background:${selected ? "#f1d56b" : day ? "#fff" : "#071019"};border:3px solid ${selected ? "#fff7c2" : "#f1d56b"};box-shadow:0 0 0 2px rgba(0,0,0,.35)"></div>`, iconSize: [selected ? 20 : 16, selected ? 20 : 16], iconAnchor: [selected ? 10 : 8, selected ? 10 : 8] });
        const marker = L.marker([wp.lat, wp.lon], { icon, draggable: true, autoPan: true }).addTo(layer); marker.bindTooltip(`${index + 1}. ${wp.name}`, { direction: "top" }); marker.on("click", (event: any) => { event.originalEvent?.stopPropagation?.(); setSelectedIndex(index); setAddMode(false); }); marker.on("dragstart", () => { pushHistory(); setSelectedIndex(index); }); marker.on("dragend", (event: any) => { const pos = event.target.getLatLng(); setRoute((current) => current.map((item, i) => i === index ? { ...item, lat: pos.lat, lon: normalizeLon(pos.lng) } : item)); setWeather(null); setStatus("Waypoint moved. Re-run weather to test this geometry."); });
      });
      if (fitNextRef.current && latlngs.length > 1) { map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] }); fitNextRef.current = false; }
    }
    void drawRoute();
  }, [route, selectedIndex, weather, forecastCoverage.coveredNm, forecastCoverage.uncoveredNm, forecastCoverage.latestValid, totalNm, day]);

  useEffect(() => {
    async function drawWeather() {
      const layer = weatherLayerRef.current; if (!layer) return; const L = await import("leaflet"); layer.clearLayers();
      encounter.forEach((point) => { const tip = point.beyondHorizon ? `<b>${point.distanceNm.toFixed(0)} NM</b><br/><b>OUTSIDE FORECAST HORIZON</b>` : `<b>${point.distanceNm.toFixed(0)} NM</b><br/>Wind ${point.windKt == null ? "--" : `${compass(point.windDirectionDeg)} ${point.windKt.toFixed(0)} kt`}<br/>Seas ${point.waveHeightFt == null ? "--" : `${point.waveHeightFt.toFixed(1)} ft`}`;
        L.circleMarker([point.lat, point.lon], { radius: 6, color: day ? "#17212b" : "#f8fafc", weight: 1, fillColor: point.beyondHorizon ? "#64748b" : seaColor(point.waveHeightFt), fillOpacity: 0.9 }).bindTooltip(tip, { direction: "top" }).addTo(layer);
      });
    }
    void drawWeather();
  }, [encounter, day]);

  function pushHistory() { historyRef.current = [...historyRef.current.slice(-19), cloneRoute(route)]; redoRef.current = []; }
  function loadIntoSandbox(name: string, waypoints: Waypoint[]) { if (waypoints.length < 2) throw new Error("Route needs at least two usable waypoints."); const copy = cloneRoute(waypoints); setRoute(copy); setBaseline(cloneRoute(copy)); setRouteName(name); setSelectedIndex(null); setWeather(null); historyRef.current = []; redoRef.current = []; fitNextRef.current = true; setStatus(`${copy.length} waypoints copied into the sandbox. The source route is untouched.`); }
  async function loadCurrentRoute() {
    try { setStatus("Loading current NavDash route…"); const response = await fetch("/api/route-state", { cache: "no-store" }); const json = await response.json(); if (!response.ok || !json?.hasRoute) throw new Error(json?.error || "No current shared NavDash route is loaded.");
      const waypoints: Waypoint[] = (Array.isArray(json.waypoints) ? json.waypoints : []).map((wp: any, index: number) => ({ name: typeof wp?.name === "string" && wp.name.trim() ? wp.name.trim() : `WP${String(index + 1).padStart(2, "0")}`, lat: Number(wp?.lat ?? wp?.latitude), lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude) })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
      loadIntoSandbox(typeof json.routeName === "string" && json.routeName.trim() ? `${json.routeName.trim()} - SANDBOX` : "Current Route - SANDBOX", waypoints);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not load current route."); }
  }
  async function loadRtz(file: File) { try { const parsed = parseRtz(await file.text()); loadIntoSandbox(`${parsed.routeName} - SANDBOX`, parsed.waypoints); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not read RTZ."); } }
  async function analyzeRoute() {
    if (route.length < 2) return; setAnalyzing(true); setStatus("Sampling winds and waves along the sandbox route…"); setWeather(null);
    try { const windResponse = await fetch("/api/noaa-route-weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints: route }) }); const windJson = await windResponse.json(); if (!windResponse.ok) throw new Error(windJson?.error || "Route weather request failed."); let merged = windJson as WeatherResponse;
      const basePoints = merged.frames?.[0]?.points || []; const validTimes = merged.frames?.map((frame) => frame.validAt) || [];
      if (basePoints.length && validTimes.length) { try { const waveResponse = await fetch("/api/gfs-wave-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: basePoints.map((p) => ({ lat: p.lat, lon: p.lon, distanceNm: p.distanceNm })), validTimes }) }); const waveJson = await waveResponse.json(); if (waveResponse.ok) merged = mergeWave(merged, waveJson as WaveResponse); } catch {} }
      setWeather(merged);
      const dep = new Date(departure); const latest = merged.frames?.length ? Math.max(...merged.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite)) : NaN; const coveredNm = Number.isFinite(latest) && Number.isFinite(dep.getTime()) ? Math.max(0, Math.min(totalNm, ((latest - dep.getTime()) / 3600000) * speedKt)) : 0;
      setStatus(`Weather loaded. Forecast horizon covers about ${coveredNm.toFixed(0)} NM of this ${totalNm.toFixed(0)} NM route at ${speedKt.toFixed(1)} kt.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Weather analysis failed."); } finally { setAnalyzing(false); }
  }
  function updateSelected(patch: Partial<Waypoint>) { if (selectedIndex == null) return; pushHistory(); setRoute((current) => current.map((wp, i) => i === selectedIndex ? { ...wp, ...patch } : wp)); setWeather(null); }
  function deleteSelected() { if (selectedIndex == null || route.length <= 2) return; pushHistory(); setRoute((current) => current.filter((_, i) => i !== selectedIndex)); setSelectedIndex(null); setWeather(null); setStatus("Waypoint deleted. Re-run weather when ready."); }
  function undo() { const previous = historyRef.current.pop(); if (!previous) return; redoRef.current = [...redoRef.current.slice(-19), cloneRoute(route)]; setRoute(cloneRoute(previous)); setWeather(null); setSelectedIndex(null); setStatus("Last route edit undone."); }
  function redo() { const next = redoRef.current.pop(); if (!next) return; historyRef.current = [...historyRef.current.slice(-19), cloneRoute(route)]; setRoute(cloneRoute(next)); setWeather(null); setSelectedIndex(null); setStatus("Route edit redone."); }
  function resetSandbox() { if (baseline.length < 2) return; pushHistory(); setRoute(cloneRoute(baseline)); setWeather(null); setSelectedIndex(null); fitNextRef.current = true; setStatus("Sandbox reset to the original loaded route."); }
  function exportRtz() { if (route.length < 2) return; const xml = buildRtz(routeName.replace(/\s+-\s+SANDBOX$/i, ""), route); const blob = new Blob([xml], { type: "application/xml" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${routeName.replace(/\s+-\s+SANDBOX$/i, "").replace(/[^a-z0-9._-]+/gi, "_") || "NavDash_Route"}.rtz`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); setStatus("RTZ exported. Run the normal route safety/chart checks before navigational use."); }

  const selected = selectedIndex == null ? null : route[selectedIndex];
  const coverageWarning = weather && forecastCoverage.percent < 99.5;
  const inputClass = `mt-1 w-full border px-2 py-2 text-sm ${day ? "border-slate-300 bg-white text-slate-900" : "border-slate-700 bg-[#050a0f] text-slate-100"}`;

  return (
    <main className={`min-h-screen p-2 ${day ? "bg-slate-100 text-slate-900" : "bg-[#04080c] text-slate-100"}`}>
      <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 border px-3 py-2 ${panel}`}><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH ROUTE LAB</div><div className="text-sm font-black">RTZ routing sandbox</div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={toggleTheme} className={`border px-3 py-2 text-[10px] font-black ${day ? "border-slate-400 bg-slate-100 text-slate-800" : "border-[#c9a227]/50 bg-[#101820] text-[#f1d56b]"}`}>{day ? "BRIDGE NIGHT" : "DAY"}</button><Link href="/route-weather-lab" className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">WEATHER LAB</Link><Link href="/bridge" className={`border px-3 py-2 text-[10px] font-black ${day ? "border-slate-400 bg-slate-100 text-slate-800" : "border-[#c9a227]/50 bg-[#101820] text-[#f1d56b]"}`}>MAIN</Link></div></div>
      <div className={`mb-2 flex flex-wrap gap-2 border p-2 ${panel}`}>
        <button onClick={loadCurrentRoute} className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD CURRENT ROUTE</button>
        <label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml" className="hidden" onChange={(e) => e.target.files?.[0] && void loadRtz(e.target.files[0])}/></label>
        <button disabled={route.length < 2} onClick={() => setAddMode((value) => !value)} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${addMode ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : day ? "border-slate-400 bg-white text-slate-700" : "border-slate-700 text-slate-300"}`}>{addMode ? "CLICK MAP TO ADD WP" : "ADD WAYPOINT"}</button>
        <button disabled={!historyRef.current.length} onClick={undo} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${day ? "border-slate-400 bg-white text-slate-700" : "border-slate-700 text-slate-300"}`}>UNDO</button><button disabled={!redoRef.current.length} onClick={redo} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${day ? "border-slate-400 bg-white text-slate-700" : "border-slate-700 text-slate-300"}`}>REDO</button>
        <button disabled={baseline.length < 2} onClick={resetSandbox} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${day ? "border-slate-400 bg-white text-slate-700" : "border-slate-700 text-slate-300"}`}>RESET OPTION</button>
        <button disabled={route.length < 2 || analyzing} onClick={analyzeRoute} className="border border-emerald-500/50 bg-emerald-950/20 px-3 py-2 text-[10px] font-black text-emerald-500 disabled:opacity-40">{analyzing ? "ANALYZING…" : "TEST WEATHER"}</button>
        <button disabled={route.length < 2} onClick={exportRtz} className="border border-[#c9a227]/60 bg-[#17130a] px-3 py-2 text-[10px] font-black text-[#f1d56b] disabled:opacity-40">EXPORT RTZ</button>
      </div>

      {weather && <div className={`mb-2 border p-3 ${coverageWarning ? day ? "border-amber-500 bg-amber-50" : "border-amber-500/60 bg-amber-950/20" : day ? "border-emerald-500 bg-emerald-50" : "border-emerald-500/40 bg-emerald-950/10"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className={`text-[10px] font-black uppercase tracking-[0.15em] ${coverageWarning ? "text-amber-600" : "text-emerald-600"}`}>FORECAST ROUTE COVERAGE</div><div className="mt-1 text-lg font-black">{forecastCoverage.coveredNm.toFixed(0)} NM of {totalNm.toFixed(0)} NM <span className={`text-sm ${muted}`}>({forecastCoverage.percent.toFixed(0)}%)</span></div></div><div className={`text-right text-[10px] font-bold ${muted}`}><div>VALID THROUGH <span className={day ? "text-slate-900" : "text-slate-200"}>{formatUtc(forecastCoverage.latestValid)}</span></div><div>{forecastCoverage.uncoveredNm > 1 ? <span className="text-amber-600">{forecastCoverage.uncoveredNm.toFixed(0)} NM BEYOND FORECAST HORIZON</span> : <span className="text-emerald-600">FULL ROUTE INSIDE CURRENT HORIZON</span>}</div></div></div>
        <div className={`mt-2 h-2 overflow-hidden rounded ${day ? "bg-slate-200" : "bg-slate-800"}`}><div className={`h-full ${coverageWarning ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.max(0, Math.min(100, forecastCoverage.percent))}%` }}/></div>
        {coverageWarning && <div className={`mt-2 text-[10px] font-bold ${day ? "text-amber-800" : "text-amber-200"}`}>The amber FORECAST ENDS marker on the track is the current model horizon at the entered departure time and speed. The dashed route beyond it has no ETA-matched forecast.</div>}
      </div>}

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={`border p-2 ${panel}`}>
          <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-6">
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">ROUTE</div><div className="truncate text-xs font-black text-cyan-600">{routeName}</div></div>
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">WAYPOINTS</div><div className="text-lg font-black">{route.length || "--"}</div></div>
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">DISTANCE</div><div className="text-lg font-black">{route.length ? `${totalNm.toFixed(0)} NM` : "--"}</div></div>
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">WX COVERED</div><div className={`text-lg font-black ${coverageWarning ? "text-amber-500" : "text-emerald-500"}`}>{weather ? `${forecastCoverage.coveredNm.toFixed(0)} NM` : "--"}</div></div>
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">MAX SEAS · COVERED</div><div className="text-lg font-black text-[#c9a227]">{maxSea?.waveHeightFt == null ? "--" : `${maxSea.waveHeightFt.toFixed(1)} ft`}</div></div>
            <div className={`border p-2 ${cell}`}><div className="text-[8px] font-black text-slate-500">MAX WIND · COVERED</div><div className="text-lg font-black text-cyan-500">{maxWind?.windKt == null ? "--" : `${compass(maxWind.windDirectionDeg)} ${maxWind.windKt.toFixed(0)} kt`}</div></div>
          </div>
          <div className={`relative overflow-hidden border ${day ? "border-slate-300" : "border-slate-800"}`}><div ref={mapEl} style={{ width: "100%", height: "66vh", minHeight: 520, background: day ? "#dbe5e8" : "#0a141d" }}/>{addMode && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 border border-[#c9a227]/70 bg-[#17130a]/95 px-3 py-2 text-[10px] font-black text-[#f1d56b]">CLICK CHART TO INSERT AFTER {selectedIndex == null ? "LAST WP" : `WP ${selectedIndex + 1}`}</div>}</div>
        </section>

        <aside className="space-y-2">
          <section className={`border p-3 ${panel}`}><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">VOYAGE TEST</div><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[9px] font-black text-slate-500">DEPARTURE<input type="datetime-local" value={departure} onChange={(e) => { setDeparture(e.target.value); setWeather(null); try { window.localStorage.setItem(DEPARTURE_KEY, e.target.value); } catch {} }} className={inputClass}/></label><label className="text-[9px] font-black text-slate-500">SPEED KT<input type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(e) => { const next = Math.max(1, Number(e.target.value) || 1); setSpeedKt(next); try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch {} }} className={inputClass}/></label></div><div className={`mt-3 text-[10px] font-bold ${muted}`}>ETA duration: {route.length ? `${(totalNm / speedKt).toFixed(1)} h` : "--"}</div></section>

          {weather && <section className={`border border-cyan-500/30 p-3 ${day ? "bg-white" : "bg-[#071019]"}`}><div className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-500">WEATHER SOURCE / MODEL</div><div className="mt-2 space-y-2 text-[10px]"><div><span className="text-slate-500">ATMOSPHERE</span><div className={day ? "font-bold text-slate-900" : "font-bold text-slate-200"}>{weather.provider}</div><div className={muted}>{weather.product}</div></div><div className={`grid grid-cols-2 gap-2 border-t pt-2 ${day ? "border-slate-200" : "border-slate-800"}`}><div><div className="text-slate-500">ATMOS RUN</div><div className="font-black text-cyan-500">{formatUtc(weather.modelRun)}</div></div><div><div className="text-slate-500">WAVE RUN</div><div className="font-black text-cyan-500">{formatUtc(weather.waveModelRun)}</div></div></div><div className={`border-t pt-2 ${day ? "border-slate-200" : "border-slate-800"}`}><div className="text-slate-500">WAVE PRODUCT</div><div className={day ? "font-bold text-slate-800" : "font-bold text-slate-300"}>{weather.waveProduct || "NWS/local wave guidance only"}</div></div><div className={`border-t pt-2 ${day ? "border-slate-200" : "border-slate-800"}`}><div className="text-slate-500">FORECAST VALID THROUGH</div><div className="font-black text-[#c9a227]">{formatUtc(forecastCoverage.latestValid)}</div></div></div></section>}

          <section className={`border p-3 ${panel}`}><div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">SELECTED WAYPOINT</div><span className="text-[9px] text-slate-500">drag on chart</span></div>{selected ? <div className="mt-2 space-y-2"><label className="block text-[9px] font-black text-slate-500">NAME<input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} className={inputClass}/></label><div className="grid grid-cols-2 gap-2"><label className="text-[9px] font-black text-slate-500">LAT<input type="number" step="0.000001" value={selected.lat} onChange={(e) => updateSelected({ lat: Math.max(-90, Math.min(90, Number(e.target.value) || 0)) })} className={inputClass}/></label><label className="text-[9px] font-black text-slate-500">LON<input type="number" step="0.000001" value={selected.lon} onChange={(e) => updateSelected({ lon: normalizeLon(Number(e.target.value) || 0) })} className={inputClass}/></label></div><div className={`text-[10px] ${muted}`}>Along route: {(distances[selectedIndex ?? 0] || 0).toFixed(1)} NM</div><button disabled={route.length <= 2} onClick={deleteSelected} className="w-full border border-red-500/40 bg-red-950/20 px-3 py-2 text-[10px] font-black text-red-500 disabled:opacity-40">DELETE WAYPOINT</button></div> : <div className={`mt-2 text-[11px] ${muted}`}>Click a waypoint to select it. Drag it directly on the chart, or enter exact coordinates here.</div>}</section>
          <section className={`border p-3 ${panel}`}><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">LEG CHECK</div><div className="mt-2 max-h-[260px] overflow-y-auto"><table className="w-full text-[10px]"><thead className="text-left text-slate-500"><tr><th className="py-1">LEG</th><th>COURSE</th><th>NM</th></tr></thead><tbody>{legs.map((leg, i) => <tr key={i} className={`border-t ${day ? "border-slate-200" : "border-slate-800"}`}><td className="py-1.5 font-bold">{i + 1}→{i + 2}</td><td className="font-black text-cyan-500">{leg.course.toFixed(0).padStart(3, "0")}°</td><td>{leg.distance.toFixed(1)}</td></tr>)}</tbody></table></div></section>
          <section className={`border p-3 ${panel}`}><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">STATUS</div><div className={`mt-2 text-[11px] leading-relaxed ${muted}`}>{status}</div></section>
        </aside>
      </div>
    </main>
  );
}
