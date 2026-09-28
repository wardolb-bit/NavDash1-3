"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Waypoint = { name: string; lat: number; lon: number };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg?: number | null;
  source: string;
  waveSource?: string;
};
type WeatherFrame = { validAt: string; points: ForecastPoint[] };
type WeatherResponse = {
  provider: string;
  product: string;
  generatedAt: string;
  sampleCount: number;
  coveredSampleCount: number;
  frames: WeatherFrame[];
  note?: string | null;
};
type WaveResponse = {
  product: string;
  frames: Array<{
    validAt: string;
    points: Array<{
      lat: number;
      lon: number;
      distanceNm: number;
      waveHeightFt: number | null;
      wavePeriodSec: number | null;
      waveDirectionDeg: number | null;
      source: string;
    }>;
  }>;
};
type EncounterPoint = ForecastPoint & { eta: Date; validAt: Date; beyondHorizon: boolean };

const DEPARTURE_KEY = "navdash-route-weather-departure";
const SPEED_KEY = "navdash-route-weather-speed-kt";

function cloneRoute(route: Waypoint[]) {
  return route.map((wp) => ({ ...wp }));
}

function normalizeLon(lon: number) {
  let next = lon;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function longitudeNearReference(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function unwrapRouteForDisplay(route: Waypoint[]) {
  if (!route.length) return [] as Waypoint[];
  const result = [{ ...route[0] }];
  for (let i = 1; i < route.length; i += 1) {
    result.push({ ...route[i], lon: longitudeNearReference(route[i].lon, result[i - 1].lon) });
  }
  return result;
}

function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  let dl = (b.lon - a.lon) * Math.PI / 180;
  if (dl > Math.PI) dl -= Math.PI * 2;
  if (dl < -Math.PI) dl += Math.PI * 2;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a: Waypoint, b: Waypoint) {
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  let dl = (b.lon - a.lon) * Math.PI / 180;
  if (dl > Math.PI) dl -= Math.PI * 2;
  if (dl < -Math.PI) dl += Math.PI * 2;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function routeLengthNm(route: Waypoint[]) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += nmBetween(route[i - 1], route[i]);
  return total;
}

function routeWaypointDistances(route: Waypoint[]) {
  const out: number[] = [];
  let total = 0;
  route.forEach((wp, i) => {
    if (i > 0) total += nmBetween(route[i - 1], wp);
    out.push(total);
  });
  return out;
}

function parseRtz(text: string): { routeName: string; waypoints: Waypoint[] } {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("RTZ XML could not be parsed.");
  const routeInfo = doc.querySelector("routeInfo");
  const waypoints = Array.from(doc.querySelectorAll("waypoint")).map((node, index) => {
    const pos = node.querySelector("position");
    return {
      name: node.getAttribute("name") || `WP${String(index + 1).padStart(2, "0")}`,
      lat: Number(pos?.getAttribute("lat")),
      lon: Number(pos?.getAttribute("lon")),
    };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return { routeName: routeInfo?.getAttribute("routeName") || "Imported Route", waypoints };
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildRtz(routeName: string, route: Waypoint[]) {
  const safeName = routeName.trim() || "NavDash Route";
  const waypointXml = route.map((wp, i) => `    <waypoint id="${i + 1}" name="${xmlEscape(wp.name || `WP${String(i + 1).padStart(2, "0")}`)}">\n      <position lat="${wp.lat.toFixed(8)}" lon="${normalizeLon(wp.lon).toFixed(8)}"/>\n      ${i === 0 ? "" : '<leg portsideXTD="0.10" starboardXTD="0.10" geometryType="Loxodrome"/>'}\n    </waypoint>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<route xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.cirm.org/RTZ/1/0" version="1.0" xsi:schemaLocation="http://www.cirm.org/RTZ/1/0 rtz.xsd">\n  <routeInfo routeName="${xmlEscape(safeName)}" routeAuthor="NavDash"/>\n  <waypoints>\n    <defaultWaypoint radius="0.10">\n      <leg portsideXTD="0.10" starboardXTD="0.10" geometryType="Loxodrome"/>\n    </defaultWaypoint>\n${waypointXml}\n  </waypoints>\n</route>\n`;
}

function seaColor(wave: number | null | undefined) {
  if (wave == null || !Number.isFinite(wave)) return "#64748b";
  if (wave >= 10) return "#ef4444";
  if (wave >= 7) return "#f59e0b";
  if (wave >= 5) return "#eab308";
  return "#22c55e";
}

function compass(deg: number | null | undefined) {
  if (deg == null || !Number.isFinite(deg)) return "--";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function mergeWave(base: WeatherResponse, wave: WaveResponse | null): WeatherResponse {
  if (!wave?.frames?.length) return base;
  return {
    ...base,
    product: `${base.product} + ${wave.product}`,
    frames: base.frames.map((frame) => {
      const target = new Date(frame.validAt).getTime();
      let bestFrame = wave.frames[0];
      let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - target);
      for (const candidate of wave.frames) {
        const delta = Math.abs(new Date(candidate.validAt).getTime() - target);
        if (delta < bestDelta) { bestFrame = candidate; bestDelta = delta; }
      }
      return {
        ...frame,
        points: frame.points.map((point) => {
          let nearest = bestFrame.points[0];
          let nearestDelta = Number.POSITIVE_INFINITY;
          for (const candidate of bestFrame.points) {
            const delta = Math.abs(candidate.distanceNm - point.distanceNm);
            if (delta < nearestDelta) { nearest = candidate; nearestDelta = delta; }
          }
          return nearest ? { ...point, waveHeightFt: nearest.waveHeightFt, wavePeriodSec: nearest.wavePeriodSec, waveDirectionDeg: nearest.waveDirectionDeg, waveSource: nearest.source } : point;
        }),
      };
    }),
  };
}

export default function RouteSandboxPage() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const weatherLayerRef = useRef<any>(null);
  const fitNextRef = useRef(true);
  const historyRef = useRef<Waypoint[][]>([]);

  const [route, setRoute] = useState<Waypoint[]>([]);
  const [baseline, setBaseline] = useState<Waypoint[]>([]);
  const [routeName, setRouteName] = useState("No route loaded");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [status, setStatus] = useState("Load the current NavDash route or an RTZ file, then reshape it on the chart.");
  const [analyzing, setAnalyzing] = useState(false);
  const [speedKt, setSpeedKt] = useState(9);
  const [departure, setDeparture] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;
  });

  const totalNm = useMemo(() => routeLengthNm(route), [route]);
  const distances = useMemo(() => routeWaypointDistances(route), [route]);
  const legs = useMemo(() => route.slice(1).map((wp, i) => ({ from: route[i], to: wp, course: bearingBetween(route[i], wp), distance: nmBetween(route[i], wp) })), [route]);

  const encounter = useMemo<EncounterPoint[]>(() => {
    if (!weather?.frames?.length || speedKt <= 0) return [];
    const dep = new Date(departure);
    if (!Number.isFinite(dep.getTime())) return [];
    const latestMs = Math.max(...weather.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite));
    const points = weather.frames[0]?.points || [];
    return points.map((first, index) => {
      const eta = new Date(dep.getTime() + first.distanceNm / speedKt * 3600000);
      let bestFrame = weather.frames[0];
      let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - eta.getTime());
      for (const frame of weather.frames) {
        const delta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
        if (delta < bestDelta) { bestFrame = frame; bestDelta = delta; }
      }
      const point = bestFrame.points[index] || first;
      return { ...point, eta, validAt: new Date(bestFrame.validAt), beyondHorizon: eta.getTime() > latestMs };
    });
  }, [weather, speedKt, departure]);

  const maxSea = useMemo(() => encounter.reduce<EncounterPoint | null>((best, p) => p.waveHeightFt != null && (!best || best.waveHeightFt == null || p.waveHeightFt > best.waveHeightFt) ? p : best, null), [encounter]);
  const maxWind = useMemo(() => encounter.reduce<EncounterPoint | null>((best, p) => p.windKt != null && (!best || best.windKt == null || p.windKt > best.windKt) ? p : best, null), [encounter]);

  useEffect(() => {
    try {
      const savedDeparture = window.localStorage.getItem(DEPARTURE_KEY);
      const savedSpeed = Number(window.localStorage.getItem(SPEED_KEY));
      if (savedDeparture) setDeparture(savedDeparture);
      if (Number.isFinite(savedSpeed) && savedSpeed > 0) setSpeedKt(savedSpeed);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initMap() {
      if (!mapEl.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapEl.current) return;
      if (!document.querySelector('link[data-route-sandbox-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-route-sandbox-leaflet", "true");
        document.head.appendChild(link);
      }
      const map = L.map(mapEl.current, { attributionControl: false, zoomControl: true, worldCopyJump: true }).setView([20, 0], 3);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      L.tileLayer.wms("/api/noaa-charts/wms", { layers: "0,1,2,3,4,5,6,7", format: "image/png", transparent: true, version: "1.1.1", opacity: 0.82, tileSize: 512, maxZoom: 18 } as any).addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      weatherLayerRef.current = L.layerGroup().addTo(map);
      map.on("click", (event: any) => {
        if (!(map as any).__navdashAddMode) return;
        window.dispatchEvent(new CustomEvent("navdash-route-sandbox-add", { detail: { lat: event.latlng.lat, lon: normalizeLon(event.latlng.lng) } }));
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 100);
    }
    void initMap();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (mapRef.current) (mapRef.current as any).__navdashAddMode = addMode;
  }, [addMode]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lon: number }>).detail;
      if (!detail) return;
      pushHistory();
      setRoute((current) => {
        const insertAt = selectedIndex == null ? current.length : selectedIndex + 1;
        const next = cloneRoute(current);
        next.splice(insertAt, 0, { name: `WP${String(insertAt + 1).padStart(2, "0")}`, lat: detail.lat, lon: detail.lon });
        return next.map((wp, i) => ({ ...wp, name: wp.name || `WP${String(i + 1).padStart(2, "0")}` }));
      });
      setWeather(null);
      setStatus("Waypoint added. Re-run weather when the option looks right.");
    };
    window.addEventListener("navdash-route-sandbox-add", handler);
    return () => window.removeEventListener("navdash-route-sandbox-add", handler);
  }, [selectedIndex, route]);

  useEffect(() => {
    async function drawRoute() {
      const map = mapRef.current;
      const layer = routeLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (!route.length) return;
      const display = unwrapRouteForDisplay(route);
      const latlngs = display.map((wp) => [wp.lat, wp.lon] as [number, number]);
      if (latlngs.length > 1) L.polyline(latlngs, { color: "#22d3ee", weight: 3, opacity: 0.95 }).addTo(layer);
      display.forEach((wp, index) => {
        const selected = selectedIndex === index;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:${selected ? 20 : 16}px;height:${selected ? 20 : 16}px;border-radius:50%;background:${selected ? "#f1d56b" : "#071019"};border:3px solid ${selected ? "#fff7c2" : "#f1d56b"};box-shadow:0 0 0 2px rgba(0,0,0,.35)"></div>`,
          iconSize: [selected ? 20 : 16, selected ? 20 : 16],
          iconAnchor: [selected ? 10 : 8, selected ? 10 : 8],
        });
        const marker = L.marker([wp.lat, wp.lon], { icon, draggable: true, autoPan: true }).addTo(layer);
        marker.bindTooltip(`${index + 1}. ${wp.name}`, { direction: "top" });
        marker.on("click", (event: any) => { event.originalEvent?.stopPropagation?.(); setSelectedIndex(index); setAddMode(false); });
        marker.on("dragstart", () => { pushHistory(); setSelectedIndex(index); });
        marker.on("dragend", (event: any) => {
          const pos = event.target.getLatLng();
          setRoute((current) => current.map((item, i) => i === index ? { ...item, lat: pos.lat, lon: normalizeLon(pos.lng) } : item));
          setWeather(null);
          setStatus("Waypoint moved. Re-run weather to test this geometry.");
        });
      });
      if (fitNextRef.current && latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });
        fitNextRef.current = false;
      }
    }
    void drawRoute();
  }, [route, selectedIndex]);

  useEffect(() => {
    async function drawWeather() {
      const layer = weatherLayerRef.current;
      if (!layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      encounter.forEach((point) => {
        L.circleMarker([point.lat, point.lon], { radius: 6, color: "#f8fafc", weight: 1, fillColor: point.beyondHorizon ? "#64748b" : seaColor(point.waveHeightFt), fillOpacity: 0.9 })
          .bindTooltip(`<b>${point.distanceNm.toFixed(0)} NM</b><br/>Wind ${point.windKt == null ? "--" : `${compass(point.windDirectionDeg)} ${point.windKt.toFixed(0)} kt`}<br/>Seas ${point.waveHeightFt == null ? "--" : `${point.waveHeightFt.toFixed(1)} ft`}`, { direction: "top" })
          .addTo(layer);
      });
    }
    void drawWeather();
  }, [encounter]);

  function pushHistory() {
    historyRef.current = [...historyRef.current.slice(-19), cloneRoute(route)];
  }

  function loadIntoSandbox(name: string, waypoints: Waypoint[]) {
    if (waypoints.length < 2) throw new Error("Route needs at least two usable waypoints.");
    const copy = cloneRoute(waypoints);
    setRoute(copy);
    setBaseline(cloneRoute(copy));
    setRouteName(name);
    setSelectedIndex(null);
    setWeather(null);
    historyRef.current = [];
    fitNextRef.current = true;
    setStatus(`${copy.length} waypoints copied into the sandbox. The source route is untouched.`);
  }

  async function loadCurrentRoute() {
    try {
      setStatus("Loading current NavDash route…");
      const response = await fetch("/api/route-state", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json?.hasRoute) throw new Error(json?.error || "No current shared NavDash route is loaded.");
      const waypoints: Waypoint[] = (Array.isArray(json.waypoints) ? json.waypoints : []).map((wp: any, index: number) => ({
        name: typeof wp?.name === "string" && wp.name.trim() ? wp.name.trim() : `WP${String(index + 1).padStart(2, "0")}`,
        lat: Number(wp?.lat ?? wp?.latitude),
        lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
      })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
      loadIntoSandbox(typeof json.routeName === "string" && json.routeName.trim() ? `${json.routeName.trim()} - SANDBOX` : "Current Route - SANDBOX", waypoints);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not load current route."); }
  }

  async function loadRtz(file: File) {
    try {
      const parsed = parseRtz(await file.text());
      loadIntoSandbox(`${parsed.routeName} - SANDBOX`, parsed.waypoints);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not read RTZ."); }
  }

  async function analyzeRoute() {
    if (route.length < 2) return;
    setAnalyzing(true);
    setStatus("Sampling winds and waves along the sandbox route…");
    setWeather(null);
    try {
      const windResponse = await fetch("/api/noaa-route-weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints: route }) });
      const windJson = await windResponse.json();
      if (!windResponse.ok) throw new Error(windJson?.error || "Route weather request failed.");
      let merged = windJson as WeatherResponse;
      const basePoints = merged.frames?.[0]?.points || [];
      const validTimes = merged.frames?.map((frame) => frame.validAt) || [];
      if (basePoints.length && validTimes.length) {
        try {
          const waveResponse = await fetch("/api/gfs-wave-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: basePoints.map((p) => ({ lat: p.lat, lon: p.lon, distanceNm: p.distanceNm })), validTimes }) });
          const waveJson = await waveResponse.json();
          if (waveResponse.ok) merged = mergeWave(merged, waveJson as WaveResponse);
        } catch {}
      }
      setWeather(merged);
      setStatus("Sandbox weather loaded. Move or add waypoints and analyze again to test another option.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Weather analysis failed."); }
    finally { setAnalyzing(false); }
  }

  function updateSelected(patch: Partial<Waypoint>) {
    if (selectedIndex == null) return;
    pushHistory();
    setRoute((current) => current.map((wp, i) => i === selectedIndex ? { ...wp, ...patch } : wp));
    setWeather(null);
  }

  function deleteSelected() {
    if (selectedIndex == null || route.length <= 2) return;
    pushHistory();
    setRoute((current) => current.filter((_, i) => i !== selectedIndex));
    setSelectedIndex(null);
    setWeather(null);
    setStatus("Waypoint deleted. Re-run weather when ready.");
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setRoute(cloneRoute(previous));
    setWeather(null);
    setSelectedIndex(null);
    setStatus("Last route edit undone.");
  }

  function resetSandbox() {
    if (baseline.length < 2) return;
    pushHistory();
    setRoute(cloneRoute(baseline));
    setWeather(null);
    setSelectedIndex(null);
    fitNextRef.current = true;
    setStatus("Sandbox reset to the original loaded route.");
  }

  function exportRtz() {
    if (route.length < 2) return;
    const xml = buildRtz(routeName.replace(/\s+-\s+SANDBOX$/i, ""), route);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${routeName.replace(/\s+-\s+SANDBOX$/i, "").replace(/[^a-z0-9._-]+/gi, "_") || "NavDash_Route"}.rtz`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("RTZ exported. Run the normal route safety/chart checks before navigational use.");
  }

  const selected = selectedIndex == null ? null : route[selectedIndex];

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-amber-500/25 bg-[#071019] px-3 py-2">
        <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH ROUTE LAB</div><div className="text-sm font-black">RTZ routing sandbox</div></div>
        <div className="flex gap-2"><Link href="/route-weather-lab" className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">WEATHER LAB</Link><Link href="/bridge" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">MAIN</Link></div>
      </div>

      <div className="mb-2 flex flex-wrap gap-2 border border-slate-700/50 bg-[#071019] p-2">
        <button onClick={loadCurrentRoute} className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD CURRENT ROUTE</button>
        <label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml" className="hidden" onChange={(e) => e.target.files?.[0] && void loadRtz(e.target.files[0])}/></label>
        <button disabled={route.length < 2} onClick={() => setAddMode((value) => !value)} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${addMode ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 text-slate-300"}`}>{addMode ? "CLICK MAP TO ADD WP" : "ADD WAYPOINT"}</button>
        <button disabled={!historyRef.current.length} onClick={undo} className="border border-slate-700 px-3 py-2 text-[10px] font-black text-slate-300 disabled:opacity-40">UNDO</button>
        <button disabled={baseline.length < 2} onClick={resetSandbox} className="border border-slate-700 px-3 py-2 text-[10px] font-black text-slate-300 disabled:opacity-40">RESET OPTION</button>
        <button disabled={route.length < 2 || analyzing} onClick={analyzeRoute} className="border border-emerald-400/40 bg-[#08130f] px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-40">{analyzing ? "ANALYZING…" : "TEST WEATHER"}</button>
        <button disabled={route.length < 2} onClick={exportRtz} className="border border-[#c9a227]/60 bg-[#17130a] px-3 py-2 text-[10px] font-black text-[#f1d56b] disabled:opacity-40">EXPORT RTZ</button>
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="border border-slate-700/50 bg-[#071019] p-2">
          <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] font-black text-slate-500">ROUTE</div><div className="truncate text-xs font-black text-cyan-200">{routeName}</div></div>
            <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] font-black text-slate-500">WAYPOINTS</div><div className="text-lg font-black">{route.length || "--"}</div></div>
            <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] font-black text-slate-500">DISTANCE</div><div className="text-lg font-black">{route.length ? `${totalNm.toFixed(0)} NM` : "--"}</div></div>
            <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] font-black text-slate-500">MAX SEAS</div><div className="text-lg font-black text-[#f1d56b]">{maxSea?.waveHeightFt == null ? "--" : `${maxSea.waveHeightFt.toFixed(1)} ft`}</div></div>
            <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] font-black text-slate-500">MAX WIND</div><div className="text-lg font-black text-cyan-300">{maxWind?.windKt == null ? "--" : `${compass(maxWind.windDirectionDeg)} ${maxWind.windKt.toFixed(0)} kt`}</div></div>
          </div>
          <div className="relative overflow-hidden border border-slate-800"><div ref={mapEl} style={{ width: "100%", height: "66vh", minHeight: 520, background: "#0a141d" }}/>{addMode && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 border border-[#c9a227]/70 bg-[#17130a]/95 px-3 py-2 text-[10px] font-black text-[#f1d56b]">CLICK CHART TO INSERT AFTER {selectedIndex == null ? "LAST WP" : `WP ${selectedIndex + 1}`}</div>}</div>
        </section>

        <aside className="space-y-2">
          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">VOYAGE TEST</div>
            <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[9px] font-black text-slate-500">DEPARTURE<input type="datetime-local" value={departure} onChange={(e) => { setDeparture(e.target.value); try { window.localStorage.setItem(DEPARTURE_KEY, e.target.value); } catch {} }} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm"/></label><label className="text-[9px] font-black text-slate-500">SPEED KT<input type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(e) => { const next = Math.max(1, Number(e.target.value) || 1); setSpeedKt(next); try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch {} }} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm"/></label></div>
            <div className="mt-3 text-[10px] font-bold text-slate-400">ETA duration: {route.length ? `${(totalNm / speedKt).toFixed(1)} h` : "--"}</div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">SELECTED WAYPOINT</div><span className="text-[9px] text-slate-500">drag on chart</span></div>
            {selected ? <div className="mt-2 space-y-2"><label className="block text-[9px] font-black text-slate-500">NAME<input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm"/></label><div className="grid grid-cols-2 gap-2"><label className="text-[9px] font-black text-slate-500">LAT<input type="number" step="0.000001" value={selected.lat} onChange={(e) => updateSelected({ lat: Math.max(-90, Math.min(90, Number(e.target.value) || 0)) })} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm"/></label><label className="text-[9px] font-black text-slate-500">LON<input type="number" step="0.000001" value={selected.lon} onChange={(e) => updateSelected({ lon: normalizeLon(Number(e.target.value) || 0) })} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm"/></label></div><div className="text-[10px] text-slate-400">Along route: {(distances[selectedIndex ?? 0] || 0).toFixed(1)} NM</div><button disabled={route.length <= 2} onClick={deleteSelected} className="w-full border border-red-500/40 bg-red-950/20 px-3 py-2 text-[10px] font-black text-red-200 disabled:opacity-40">DELETE WAYPOINT</button></div> : <div className="mt-2 text-[11px] text-slate-400">Click a waypoint to select it. Drag it directly on the chart, or enter exact coordinates here.</div>}
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">LEG CHECK</div>
            <div className="mt-2 max-h-[260px] overflow-y-auto"><table className="w-full text-[10px]"><thead className="text-left text-slate-500"><tr><th className="py-1">LEG</th><th>COURSE</th><th>NM</th></tr></thead><tbody>{legs.map((leg, i) => <tr key={i} className="border-t border-slate-800"><td className="py-1.5 font-bold text-slate-300">{i + 1}→{i + 2}</td><td className="font-black text-cyan-200">{leg.course.toFixed(0).padStart(3, "0")}°</td><td>{leg.distance.toFixed(1)}</td></tr>)}</tbody></table></div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">STATUS</div><div className="mt-2 text-[11px] leading-relaxed text-slate-300">{status}</div></section>
        </aside>
      </div>
    </main>
  );
}
