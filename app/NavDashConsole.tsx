"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import { useBridgeTheme } from "../lib/useBridgeTheme";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const FULLSCREEN_PREF_KEY = "navconsole-fullscreen";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type OwnShip = { lat: number; lon: number; sog: number; cog: number; heading: number | null; lastSeen: number };
type Multipart = { total: number; parts: string[]; fillBits: number };

const multipartCache = new Map<string, Multipart>();

function sixBit(char: string) { let value = char.charCodeAt(0) - 48; if (value > 40) value -= 8; return value; }
function bitsFromPayload(payload: string) { return payload.split("").map((c) => sixBit(c).toString(2).padStart(6, "0")).join(""); }
function unsigned(bits: string, start: number, length: number) { return parseInt(bits.slice(start, start + length), 2); }
function signed(bits: string, start: number, length: number) { const raw = bits.slice(start, start + length); const value = parseInt(raw, 2); const sign = 2 ** (length - 1); return value >= sign ? value - 2 ** length : value; }

function getAisBits(sentence: string) {
  const parts = sentence.split(",");
  if (parts.length < 7) return null;
  const total = Number(parts[1]);
  const number = Number(parts[2]);
  const seq = parts[3] || "0";
  const channel = parts[4] || "0";
  const payload = parts[5];
  const fillBits = Number(parts[6]?.split("*")[0] || 0);
  if (!payload) return null;
  if (total <= 1) {
    let bits = bitsFromPayload(payload);
    if (fillBits > 0) bits = bits.slice(0, -fillBits);
    return bits;
  }
  const key = `${parts[0]}-${seq}-${channel}`;
  const cached = multipartCache.get(key) || { total, parts: [], fillBits: 0 };
  cached.parts[number - 1] = payload;
  cached.fillBits = fillBits;
  multipartCache.set(key, cached);
  if (cached.parts.filter(Boolean).length !== total) return null;
  multipartCache.delete(key);
  let bits = bitsFromPayload(cached.parts.join(""));
  if (cached.fillBits > 0) bits = bits.slice(0, -cached.fillBits);
  return bits;
}

function decodeOwnShip(sentence: string): OwnShip | null {
  try {
    if (!sentence.startsWith("!AIVDO")) return null;
    const bits = getAisBits(sentence);
    if (!bits || ![1, 2, 3].includes(unsigned(bits, 0, 6))) return null;
    const sog = unsigned(bits, 50, 10) / 10;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cogRaw = unsigned(bits, 116, 12);
    const headingRaw = unsigned(bits, 128, 9);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {
      lat,
      lon,
      sog: sog < 102.3 ? sog : 0,
      cog: cogRaw < 3600 ? cogRaw / 10 : 0,
      heading: headingRaw === 511 ? null : headingRaw,
      lastSeen: Date.now(),
    };
  } catch { return null; }
}

function ownShipFromParsedMessage(msg: any): OwnShip | null {
  const lat = Number(msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude);
  const lon = Number(msg?.lon ?? msg?.lng ?? msg?.longitude ?? msg?.position?.lon ?? msg?.position?.lng ?? msg?.position?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    sog: Number.isFinite(Number(msg?.sog ?? msg?.speed)) ? Number(msg?.sog ?? msg?.speed) : 0,
    cog: Number.isFinite(Number(msg?.cog ?? msg?.course)) ? Number(msg?.cog ?? msg?.course) : 0,
    heading: Number.isFinite(Number(msg?.heading ?? msg?.hdg)) ? Number(msg?.heading ?? msg?.hdg) : null,
    lastSeen: Date.now(),
  };
}

function extractNmea(msg: any) {
  const values = [msg?.line, msg?.sentence, msg?.nmea, msg?.raw, msg?.data, msg?.payload, msg];
  return values.find((value) => typeof value === "string" && value.trim().startsWith("!AIVDO"))?.trim() || "";
}

function parseRtz(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route.");
  const routeNode = doc.querySelector("route");
  const routeName = routeNode?.getAttribute("routeName") || routeNode?.getAttribute("name") || doc.querySelector("routeInfo")?.getAttribute("routeName") || "Loaded RTZ Route";
  const waypoints = Array.from(doc.getElementsByTagName("waypoint")).map((wp, index) => {
    const pos = wp.getElementsByTagName("position")[0];
    const lat = Number(pos?.getAttribute("lat") ?? pos?.getAttribute("latitude") ?? wp.getAttribute("lat") ?? wp.getAttribute("latitude"));
    const lon = Number(pos?.getAttribute("lon") ?? pos?.getAttribute("longitude") ?? wp.getAttribute("lon") ?? wp.getAttribute("longitude"));
    return {
      id: wp.getAttribute("id") || wp.getAttribute("revision") || `WP${String(index + 1).padStart(2, "0")}`,
      name: wp.getAttribute("name") || wp.getAttribute("waypointName") || wp.querySelector("name")?.textContent?.trim() || `Waypoint ${index + 1}`,
      lat,
      lon,
    };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) throw new Error("RTZ route must contain at least two usable waypoints.");
  return { routeName, waypoints };
}

function normalizeRoute(data: any) {
  const waypoints: Waypoint[] = (Array.isArray(data?.waypoints) ? data.waypoints : []).map((wp: any, index: number) => ({
    id: typeof wp?.id === "string" && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, "0")}`,
    name: typeof wp?.name === "string" && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) return null;
  const rawIndex = Number(data?.activeWaypointIndex);
  return {
    routeName: typeof data?.routeName === "string" && data.routeName.trim() ? data.routeName : "Loaded RTZ Route",
    waypoints,
    activeWaypointIndex: Number.isFinite(rawIndex) ? Math.max(1, Math.min(waypoints.length - 1, Math.trunc(rawIndex))) : 1,
  };
}

function saveRoute(routeName: string, waypoints: Waypoint[], activeWaypointIndex: number) {
  if (waypoints.length < 2) return;
  const body = JSON.stringify({ routeName, waypoints, activeWaypointIndex, savedAt: new Date().toISOString() });
  try { localStorage.setItem(ROUTE_STORAGE_KEY, body); } catch {}
  try { sessionStorage.setItem(ROUTE_STORAGE_KEY, body); } catch {}
  fetch("/api/route-state", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
}

function clearRouteStorage() {
  try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch {}
  try { sessionStorage.removeItem(ROUTE_STORAGE_KEY); } catch {}
  fetch("/api/route-state", { method: "DELETE" }).catch(() => {});
}

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function normalize360(value: number) { return ((value % 360) + 360) % 360; }
function lonDelta(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }

function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(lonDelta(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(lonDelta(b.lon - a.lon));
  return normalize360(deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))));
}

function legMetrics(ship: OwnShip, start: Waypoint, end: Waypoint) {
  const meanLat = rad((ship.lat + start.lat + end.lat) / 3);
  const xScale = 60 * Math.max(0.01, Math.cos(meanLat));
  const vx = lonDelta(end.lon - start.lon) * xScale;
  const vy = (end.lat - start.lat) * 60;
  const wx = lonDelta(ship.lon - start.lon) * xScale;
  const wy = (ship.lat - start.lat) * 60;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) return { ratio: 0, xte: 0, side: "--" };
  const ratio = (wx * vx + wy * vy) / len2;
  const cross = vx * wy - vy * wx;
  return { ratio, xte: Math.abs(cross) / Math.sqrt(len2), side: cross > 0 ? "STBD" : cross < 0 ? "PORT" : "--" };
}

function routeDtg(ship: OwnShip | null, route: Waypoint[], activeIndex: number) {
  if (!ship || route.length < 2 || !route[activeIndex]) return null;
  let total = distanceNm(ship, route[activeIndex]);
  for (let i = activeIndex; i < route.length - 1; i += 1) total += distanceNm(route[i], route[i + 1]);
  return total;
}

function ddm(value: number, lat: boolean) {
  const hemi = lat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value), degrees = Math.floor(abs), minutes = (abs - degrees) * 60;
  return `${String(degrees).padStart(lat ? 2 : 3, "0")}° ${minutes.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

function destinationZone(position: Waypoint) {
  if (position.lat >= 18 && position.lat <= 23 && position.lon >= -161 && position.lon <= -154) return { timeZone: "Pacific/Honolulu", label: "HST" };
  if (position.lat >= 10 && position.lat <= 22 && position.lon >= 138 && position.lon <= 150) return { timeZone: "Pacific/Guam", label: "ChST" };
  return null;
}

function etaText(hours: number | null, destination: Waypoint | undefined) {
  if (hours === null || !destination || !Number.isFinite(hours)) return "--";
  const date = new Date(Date.now() + hours * 3600000);
  const zone = destinationZone(destination);
  if (zone) return `${new Intl.DateTimeFormat("en-US", { timeZone: zone.timeZone, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} ${zone.label}`;
  const offset = Math.max(-12, Math.min(14, Math.round(destination.lon / 15)));
  const local = new Date(date.getTime() + offset * 3600000);
  const sign = offset >= 0 ? "+" : "";
  return `${local.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} UTC${sign}${offset}`;
}

function mapInstance() {
  const host = document.getElementById("v12-map");
  if (!host) return null;
  const nodes = [host, ...Array.from(host.querySelectorAll<HTMLElement>("*"))];
  for (const node of nodes) if ((node as any).__navdashLeafletMap) return (node as any).__navdashLeafletMap;
  return null;
}

export default function NavDashConsole() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const routeSocketRef = useRef<WebSocket | null>(null);
  const [routeName, setRouteName] = useState("No route loaded");
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [activeIndex, setActiveIndex] = useState(1);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [aisStatus, setAisStatus] = useState("GPS CHECK");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [vectorOn, setVectorOn] = useState(true);
  const [aisOn, setAisOn] = useState(true);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      let restored: any = null;
      try { const local = localStorage.getItem(ROUTE_STORAGE_KEY); if (local) restored = normalizeRoute(JSON.parse(local)); } catch {}
      if (!restored) {
        try { const response = await fetch("/api/route-state", { cache: "no-store" }); if (response.ok) restored = normalizeRoute(await response.json()); } catch {}
      }
      if (!cancelled && restored) {
        setRouteName(restored.routeName);
        setRoute(restored.waypoints);
        setActiveIndex(restored.activeWaypointIndex);
      }
    };
    restore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());
    routeSocketRef.current = ws;
    ws.onopen = () => setAisStatus("GPS LIVE");
    ws.onerror = () => setAisStatus("GPS CHECK");
    ws.onclose = () => setAisStatus("GPS CHECK");
    ws.onmessage = (event) => {
      let msg: any = event.data;
      try { msg = JSON.parse(event.data); } catch {}
      if (msg?.type === "route-state") {
        const next = normalizeRoute(msg);
        if (next) { setRouteName(next.routeName); setRoute(next.waypoints); setActiveIndex(next.activeWaypointIndex); }
        return;
      }
      const line = extractNmea(msg);
      const decoded = line ? decodeOwnShip(line) : ownShipFromParsedMessage(msg);
      if (decoded) { setOwnShip(decoded); setAisStatus("GPS LIVE"); }
    };
    return () => { if (routeSocketRef.current === ws) routeSocketRef.current = null; ws.close(); };
  }, []);

  useEffect(() => {
    if (!ownShip || route.length < 2) return;
    setActiveIndex((current) => {
      let index = Math.max(1, Math.min(route.length - 1, current));
      while (index < route.length - 1) {
        const metrics = legMetrics(ownShip, route[index - 1], route[index]);
        if (metrics.ratio < 1.02) break;
        index += 1;
      }
      return index;
    });
  }, [ownShip?.lat, ownShip?.lon, route]);

  useEffect(() => {
    if (route.length >= 2) saveRoute(routeName, route, activeIndex);
  }, [routeName, route, activeIndex]);

  useEffect(() => {
    const host = document.getElementById("v12-map");
    if (!host) return;
    host.querySelectorAll<SVGElement>("path, circle").forEach((el) => {
      if ((el.getAttribute("stroke") || "").toLowerCase() !== "#22d3ee") return;
      const isVector = Boolean((el.getAttribute("stroke-dasharray") || "").trim());
      el.style.display = aisOn && (!isVector || vectorOn) ? "" : "none";
    });
  }, [aisOn, vectorOn, ownShip]);

  const destination = route[route.length - 1];
  const start = route[Math.max(0, activeIndex - 1)];
  const next = route[activeIndex];
  const metrics = ownShip && start && next ? legMetrics(ownShip, start, next) : null;
  const dtg = useMemo(() => routeDtg(ownShip, route, activeIndex), [ownShip, route, activeIndex]);
  const etaHours = dtg !== null && ownShip && ownShip.sog > 0.1 ? dtg / ownShip.sog : null;
  const brg = start && next ? bearing(start, next) : null;
  const legText = start && next ? `${start.id} → ${next.id}` : "--";
  const routeLoaded = route.length >= 2;

  async function loadRtz(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseRtz(await file.text());
      setRouteName(parsed.routeName || file.name.replace(/\.(rtz|xml)$/i, ""));
      setRoute(parsed.waypoints);
      setActiveIndex(1);
      const payload = { type: "route-state", routeName: parsed.routeName, waypoints: parsed.waypoints, activeWaypointIndex: 1, savedAt: new Date().toISOString() };
      if (routeSocketRef.current?.readyState === WebSocket.OPEN) routeSocketRef.current.send(JSON.stringify(payload));
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not load RTZ route."); }
  }

  function clearRoute() {
    clearRouteStorage();
    setRouteName("No route loaded");
    setRoute([]);
    setActiveIndex(1);
    if (routeSocketRef.current?.readyState === WebSocket.OPEN) routeSocketRef.current.send(JSON.stringify({ type: "route-clear" }));
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) { localStorage.setItem(FULLSCREEN_PREF_KEY, "true"); await document.documentElement.requestFullscreen(); }
      else { localStorage.setItem(FULLSCREEN_PREF_KEY, "false"); await document.exitFullscreen(); }
    } catch {}
  }

  function centerOwnShip() {
    const map = mapInstance();
    if (map && ownShip) map.panTo([ownShip.lat, ownShip.lon], { animate: true, duration: 0.5 });
  }

  function fitRoute() {
    const map = mapInstance();
    if (map && route.length >= 2) map.fitBounds(route.map((wp) => [wp.lat, wp.lon]), { padding: [40, 40], animate: false });
  }

  const control = day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#071019] text-slate-100";
  const panel = day ? "border-slate-300 bg-white" : "border-white/15 bg-[#071019]";

  return (
    <main className={day ? "min-h-screen bg-[#eef2f5] text-slate-900" : "min-h-screen bg-[#04080c] text-slate-100"}>
      <div className={`navdash-current-console ${day ? "navdash-v12-day" : "navdash-v12-night"} min-h-screen p-[6px]`}>
        <div id="bc-v2-topbar" className={`grid h-[46px] grid-cols-[260px_1fr_180px] items-center border px-3 ${day ? "border-amber-800/30 bg-white" : "border-wardGold/30 bg-[#071019]"}`}>
          <div className="bc2-brand flex items-center gap-2.5">
            <span className="bc2-logo grid h-7 w-7 place-items-center border border-wardGold text-[15px] font-black text-wardGold">N</span>
            <span className="flex flex-col leading-none"><b className="tracking-[.08em]">NAVDASH</b><small className="mt-1 text-[8px] tracking-[.14em] text-slate-500">M/V MB480 · BRIDGE CONSOLE</small></span>
          </div>
          <div className="bc2-center flex justify-center gap-2 text-[9px] font-bold tracking-[.08em]">
            <span className={`live border px-2 py-1 ${control}`}><i className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${aisStatus === "GPS LIVE" ? "bg-emerald-400" : "bg-amber-400"}`} />{aisStatus}</span>
            <span id="bc2-top-route" className={`border px-2 py-1 ${control}`}>{routeLoaded ? routeName : "NO ROUTE"}</span>
            <span id="bc2-top-leg" className={`border px-2 py-1 ${control}`}>{legText === "--" ? "LEG --" : `LEG ${legText}`}</span>
            <span id="bc2-top-dtg" className={`border px-2 py-1 ${control}`}>{dtg === null ? "DTG --" : `DTG ${dtg.toFixed(0)} NM`}</span>
          </div>
          <div className="bc2-clock text-right text-[9px] font-black tracking-[.16em] text-wardGold">NAVIGATION</div>
        </div>

        <header className={`mt-[5px] border p-1.5 ${panel}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="sr-only">NavDash bridge controls</div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <label className="inline-flex h-[30px] min-w-[108px] cursor-pointer items-center justify-center border border-wardGold/60 bg-wardGold px-2 text-[10px] font-black text-black">LOAD RTZ<input type="file" accept=".rtz,.xml" onChange={loadRtz} className="hidden" /></label>
              <button onClick={clearRoute} disabled={!routeLoaded} className={`h-[30px] min-w-[108px] border px-2 text-[10px] font-black ${routeLoaded ? "border-red-400/50 text-red-400" : "border-slate-400/20 text-slate-500"}`}>CLEAR ROUTE</button>
              <button onClick={toggleFullscreen} className={`h-[30px] min-w-[108px] border px-2 text-[10px] font-black ${control}`}>{isFullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}</button>
              <button onClick={toggleTheme} className={`h-[30px] min-w-[108px] border px-2 text-[10px] font-black ${control}`}>{day ? "BRIDGE NIGHT" : "DAY MODE"}</button>
            </div>
          </div>
        </header>

        <div className="mt-[5px] grid grid-cols-[minmax(0,1fr)_330px] gap-[5px] max-[900px]:grid-cols-1">
          <section id="v12-section-chart" className={`relative min-w-0 border ${panel}`}>
            <div id="bc-chart-tools" className={`absolute left-2 top-2 z-[1100] flex gap-1 border p-1 ${day ? "border-slate-300 bg-white/95" : "border-white/20 bg-[#04080c]/90"}`}>
              <button onClick={centerOwnShip} className={`h-7 border px-2.5 text-[9px] font-black tracking-[.08em] ${control}`}>OWN SHIP</button>
              <button onClick={fitRoute} className={`h-7 border px-2.5 text-[9px] font-black tracking-[.08em] ${control}`}>ROUTE FIT</button>
              <button onClick={() => setVectorOn((v) => !v)} className={`h-7 border px-2.5 text-[9px] font-black tracking-[.08em] ${vectorOn ? "border-wardGold/60 text-wardGold" : control}`}>VECTOR {vectorOn ? "ON" : "OFF"}</button>
              <button onClick={() => setAisOn((v) => !v)} className={`h-7 border px-2.5 text-[9px] font-black tracking-[.08em] ${aisOn ? "border-cyan-400/60 text-cyan-400" : control}`}>AIS {aisOn ? "ON" : "OFF"}</button>
            </div>
            <div id="v12-map" className="relative h-[calc(100vh-122px)] min-h-[650px] w-full overflow-hidden bg-[#0a141d] max-[900px]:min-h-[420px]" />
          </section>

          <aside className="min-w-[330px] max-[900px]:min-w-0">
            <section id="bc-v2-instruments" className={`flex min-h-[650px] h-full flex-col border ${panel}`}>
              <div className="bc2-rail-title border-b border-white/10 p-3.5"><span className="block text-[8px] font-black tracking-[.16em] text-wardGold">VOYAGE</span><b id="bc2-route" className="mt-2 block truncate text-lg font-black text-wardGold">{routeName}</b><small id="bc2-dest" className="mt-1.5 block truncate text-[11px] text-slate-400">{destination?.name || "--"}</small></div>
              <div className="bc2-pos border-b border-white/10 p-3.5"><label className="block text-[8px] font-black tracking-[.16em] text-slate-500">OWN SHIP</label><strong id="bc2-lat" className="mt-1 block whitespace-nowrap text-[23px] font-black text-cyan-400">{ownShip ? `LAT ${ddm(ownShip.lat, true)}` : "--"}</strong><strong id="bc2-lon" className="block whitespace-nowrap text-[23px] font-black text-cyan-400">{ownShip ? `LON ${ddm(ownShip.lon, false)}` : "--"}</strong></div>
              <div className="bc2-big-grid grid grid-cols-2 border-b border-white/10">
                <div className="border-b border-r border-white/10 p-3"><label>COG</label><strong id="bc2-cog">{ownShip ? `${ownShip.cog.toFixed(1)}°` : "--"}</strong></div>
                <div className="border-b border-white/10 p-3"><label>SOG</label><strong id="bc2-sog">{ownShip ? `${ownShip.sog.toFixed(1)} KT` : "--"}</strong></div>
                <div className="border-r border-white/10 p-3"><label>HDG</label><strong id="bc2-hdg">{ownShip?.heading == null ? "--" : `${ownShip.heading.toFixed(0)}°`}</strong></div>
                <div className="p-3"><label>XTE</label><strong id="bc2-xte">{metrics ? `${metrics.xte.toFixed(2)} NM ${metrics.side}` : "--"}</strong></div>
              </div>
              <div className="bc2-leg border-b border-white/10 p-3.5"><label>ACTIVE LEG</label><strong id="bc2-leg" className="block text-2xl font-black text-wardGold">{legText}</strong><small id="bc2-legname" className="hidden">{start && next ? `${start.name} → ${next.name}` : "--"}</small></div>
              <div className="bc2-small-grid grid grid-cols-2 border-b border-white/10">
                <div className="border-b border-r border-white/10 p-3"><label>DTG</label><strong id="bc2-dtg">{dtg === null ? "--" : `${dtg.toFixed(0)} NM`}</strong></div>
                <div className="border-b border-white/10 p-3"><label>ETA</label><strong id="bc2-eta">{etaText(etaHours, destination)}</strong></div>
                <div className="border-r border-white/10 p-3"><label>BRG</label><strong id="bc2-brg">{brg === null ? "--" : `${brg.toFixed(1)}°T`}</strong></div>
                <div className="p-3"><label>CORRIDOR</label><strong>2.0 NM</strong></div>
              </div>
              <div id="bc2-system-strip" className="mt-auto grid grid-cols-2 gap-px border-t border-white/10"><span id="bc2-status-ais" className="p-2 text-center text-[8px] font-black">{aisStatus === "GPS LIVE" ? "● GPS LIVE" : "◆ GPS CHECK"}</span><span id="bc2-status-route" className="p-2 text-center text-[8px] font-black">{routeLoaded ? "● ROUTE LOADED" : "◆ NO ROUTE"}</span></div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
