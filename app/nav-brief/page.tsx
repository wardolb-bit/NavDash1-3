"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";
import type { AmiForecastPoint, AmiRouteForecast } from "../../lib/amiRouteForecast";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteBrief = { routeName: string; waypoints: Waypoint[] };
type UserMark = { id: string; name: string; lat: number; lon: number };

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const USER_CHART_STORAGE_KEY = "navdash-user-chart-v1";
const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";

function toRad(v: number) { return v * Math.PI / 180; }
function toDeg(v: number) { return v * 180 / Math.PI; }
function nmBetween(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const r = 3440.065;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearingBetween(a: Waypoint, b: Waypoint) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  return (toDeg(Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon))) + 360) % 360;
}
function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value), deg = Math.floor(abs), min = (abs - deg) * 60;
  return `${String(deg).padStart(isLat ? 2 : 3, "0")}° ${min.toFixed(3)}' ${hemi}`;
}
function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim(), decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;
  const hemi = text.match(/[NSEW]/i)?.[0]?.toUpperCase();
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;
  let value = nums.length >= 3 ? Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600 : nums.length >= 2 ? Math.abs(nums[0]) + nums[1] / 60 : nums[0];
  if (hemi === "S" || hemi === "W" || (!hemi && nums[0] < 0)) value *= -1;
  return isLat && Math.abs(value) > 90 || !isLat && Math.abs(value) > 180 ? NaN : value;
}
function getAttr(node: Element, names: string[]) { for (const name of names) { const value = node.getAttribute(name); if (value) return value; } return null; }
function findName(node: Element, fallback: string) {
  return getAttr(node, ["name", "Name", "id", "ID"]) || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim() || fallback;
}
function parseRtz(xmlText: string): RouteBrief {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeName = getAttr(routeNode, ["name", "Name", "id", "ID"]) || routeNode.querySelector("routeName,name")?.textContent?.trim() || "Loaded RTZ Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    return { id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${String(index + 1).padStart(3, "0")}`, name: findName(node, `Waypoint ${index + 1}`), lat, lon };
  }).filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}
function normalizeRoutePayload(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({ id: String(wp?.id || `WP${String(index + 1).padStart(3, "0")}`), name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`), lat: Number(wp?.lat ?? wp?.latitude), lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude) })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return waypoints.length < 2 ? null : { routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "Current NavDash Route"), waypoints };
}
function readCurrentRoute() { try { const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY); return raw ? normalizeRoutePayload(JSON.parse(raw)) : null; } catch { return null; } }
function normalizeMarks(raw: any[]): UserMark[] {
  return raw.map((mark: any, index) => mark?.type === "Feature" && mark?.geometry?.type === "Point" && Array.isArray(mark.geometry.coordinates)
    ? { id: String(mark?.id || mark?.properties?.id || `mark-${index + 1}`), name: String(mark?.properties?.name || mark?.properties?.title || mark?.properties?.label || `Mark ${index + 1}`), lat: Number(mark.geometry.coordinates[1]), lon: Number(mark.geometry.coordinates[0]) }
    : { id: String(mark?.id || `mark-${index + 1}`), name: String(mark?.name || mark?.title || mark?.label || `Mark ${index + 1}`), lat: Number(mark?.lat ?? mark?.latitude), lon: Number(mark?.lon ?? mark?.lng ?? mark?.longitude) })
    .filter((mark: UserMark) => Number.isFinite(mark.lat) && Number.isFinite(mark.lon) && Math.abs(mark.lat) <= 90 && Math.abs(mark.lon) <= 180);
}
function parseUserChartText(text: string, fileName: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("User chart file is empty.");
  if (/\.xml$/i.test(fileName) || trimmed.startsWith("<?xml") || trimmed.startsWith("<userchart")) {
    const doc = new DOMParser().parseFromString(trimmed, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Could not parse user chart XML.");
    const labels = Array.from(doc.querySelectorAll("userchart labels label, labels label, label"));
    const marks = labels.map((label, index) => {
      const vertex = label.querySelector("position vertex, vertex");
      const lat = Number(vertex?.getAttribute("latitude"));
      const lon = Number(vertex?.getAttribute("longitude"));
      const name = label.getAttribute("name") || label.querySelector("attribute")?.getAttribute("labelText") || `Mark ${index + 1}`;
      return { id: `mark-${index + 1}`, name, lat, lon };
    }).filter(mark => Number.isFinite(mark.lat) && Number.isFinite(mark.lon) && Math.abs(mark.lat) <= 90 && Math.abs(mark.lon) <= 180);
    if (!marks.length) throw new Error("No point labels were found in the user chart XML.");
    return marks;
  }
  if (/\.(json|geojson)$/i.test(fileName) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.marks) ? parsed.marks : Array.isArray(parsed?.userMarks) ? parsed.userMarks : Array.isArray(parsed?.features) ? parsed.features : [];
    const marks = normalizeMarks(raw);
    if (!marks.length) throw new Error("No point marks were found in the user chart file.");
    return marks;
  }
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean), delimiter = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delimiter).map(v => v.trim().toLowerCase());
  const latIndex = header.findIndex(v => ["lat", "latitude"].includes(v)), lonIndex = header.findIndex(v => ["lon", "lng", "long", "longitude"].includes(v)), nameIndex = header.findIndex(v => ["name", "title", "label", "mark"].includes(v));
  if (latIndex < 0 || lonIndex < 0) throw new Error("CSV user chart needs latitude and longitude columns.");
  const marks = lines.slice(1).map((line, index) => { const cells = line.split(delimiter).map(v => v.trim()); return { id: `mark-${index + 1}`, name: cells[nameIndex] || `Mark ${index + 1}`, lat: Number(cells[latIndex]), lon: Number(cells[lonIndex]) }; }).filter(mark => Number.isFinite(mark.lat) && Number.isFinite(mark.lon));
  if (!marks.length) throw new Error("No valid user chart positions were found.");
  return marks;
}
function readUserMarks() { try { const parsed = JSON.parse(window.localStorage.getItem(USER_CHART_STORAGE_KEY) || "[]"); return Array.isArray(parsed) ? normalizeMarks(parsed) : []; } catch { return []; } }
function readAmi(): AmiRouteForecast | null { try { const parsed = JSON.parse(window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY) || "null") as AmiRouteForecast | null; return parsed?.version === 1 && Array.isArray(parsed.forecastPoints) ? parsed : null; } catch { return null; } }
function segmentRows(waypoints: Waypoint[]) { return waypoints.slice(1).map((to, index) => ({ from: waypoints[index], to, distance: nmBetween(waypoints[index], to), bearing: bearingBetween(waypoints[index], to) })); }
function totalDistance(waypoints: Waypoint[]) { return segmentRows(waypoints).reduce((sum, leg) => sum + leg.distance, 0); }
function safeNumber(value: string, fallback: number) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function formatDateTime(date: Date | null) { return !date || !Number.isFinite(date.getTime()) ? "--" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatUtc(value: string) { const date = new Date(value); return !Number.isFinite(date.getTime()) ? value : date.toLocaleString("en-US", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + "Z"; }
function closestRouteDistance(mark: UserMark, route: Waypoint[]) { return route.reduce((best, wp) => Math.min(best, nmBetween(mark, wp)), Number.POSITIVE_INFINITY); }
function maxBy(points: AmiForecastPoint[], getter: (p: AmiForecastPoint) => number) { return points.reduce<AmiForecastPoint | null>((best, point) => !best || getter(point) > getter(best) ? point : best, null); }

export default function NavBriefBuilderPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const dayMode = !nightMode;
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [routeSource, setRouteSource] = useState("");
  const [routeError, setRouteError] = useState("");
  const [plannedSpeed, setPlannedSpeed] = useState("10");
  const [departure, setDeparture] = useState("");
  const [userMarks, setUserMarks] = useState<UserMark[]>([]);
  const [userChartFile, setUserChartFile] = useState("");
  const [userChartError, setUserChartError] = useState("");
  const [ami, setAmi] = useState<AmiRouteForecast | null>(null);
  const [opsNotes, setOpsNotes] = useState("");
  const [portNotes, setPortNotes] = useState("");

  const legs = useMemo(() => route ? segmentRows(route.waypoints) : [], [route]);
  const distanceNm = useMemo(() => route ? totalDistance(route.waypoints) : 0, [route]);
  const speed = safeNumber(plannedSpeed, 10), departureDate = departure ? new Date(departure) : null;
  const eta = departureDate ? new Date(departureDate.getTime() + distanceNm / speed * 3600000) : null;
  const origin = route?.waypoints[0], destination = route?.waypoints[route.waypoints.length - 1];
  const relevantMarks = useMemo(() => route ? userMarks.map(mark => ({ ...mark, routeDistance: closestRouteDistance(mark, route.waypoints) })).sort((a, b) => a.routeDistance - b.routeDistance) : [], [route, userMarks]);
  const strongestWind = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.windSpeedKt) : null, [ami]);
  const strongestGust = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.gustKt) : null, [ami]);
  const highestSea = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.significantWaveM) : null, [ami]);

  const shell = dayMode ? "bg-[#eef2f5] text-[#17212b]" : "bg-[#05090e] text-[#dbe5ee]";
  const panel = dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-[#08111a]";
  const sub = dayMode ? "border-slate-300 bg-[#f5f7f9]" : "border-white/10 bg-[#050a0f]";
  const muted = dayMode ? "text-slate-600" : "text-[#8294a5]";
  const control = dayMode ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-100" : "border-white/15 bg-[#101820] text-[#dbe5ee] hover:bg-[#182631]";
  const input = dayMode ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#050a0f] text-[#dbe5ee]";
  const accent = dayMode ? "text-slate-700" : "text-[#42d3c8]";

  async function loadCurrentNavDashRoute(silent = false) {
    if (!silent) setRouteError("");
    const local = readCurrentRoute();
    if (local) { setRoute(local); setRouteSource("CURRENT NAVDASH ROUTE · LOCAL"); return; }
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route state API returned ${response.status}`);
      const serverRoute = normalizeRoutePayload(await response.json());
      if (!serverRoute) throw new Error("No current NavDash route was found.");
      setRoute(serverRoute); setRouteSource("ROUTE-STATE API FALLBACK");
    } catch (error) { if (!silent) setRouteError(error instanceof Error ? error.message : "Could not load current NavDash route."); }
  }
  useEffect(() => {
    const refresh = () => { const current = readCurrentRoute(); if (current) { setRoute(current); setRouteSource("CURRENT NAVDASH ROUTE · LOCAL"); } setUserMarks(readUserMarks()); setAmi(readAmi()); };
    refresh(); window.addEventListener("storage", refresh); window.addEventListener("navdash-ami-overlay-updated", refresh); window.addEventListener("navdash-user-chart-updated", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("navdash-ami-overlay-updated", refresh); window.removeEventListener("navdash-user-chart-updated", refresh); };
  }, []);
  async function loadRtz(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setRouteError(""); try { setRoute(parseRtz(await file.text())); setRouteSource(`RTZ · ${file.name}`); } catch (e) { setRouteError(e instanceof Error ? e.message : "Unable to load route."); } }
  async function loadUserChart(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setUserChartError(""); try { const marks = parseUserChartText(await file.text(), file.name); setUserMarks(marks); setUserChartFile(file.name); window.localStorage.setItem(USER_CHART_STORAGE_KEY, JSON.stringify(marks)); window.dispatchEvent(new CustomEvent("navdash-user-chart-updated")); } catch (e) { setUserChartError(e instanceof Error ? e.message : "Unable to load user chart."); } }
  function refreshInputs() { const current = readCurrentRoute(); if (current) { setRoute(current); setRouteSource("CURRENT NAVDASH ROUTE · LOCAL"); } setUserMarks(readUserMarks()); setAmi(readAmi()); }

  const status = [
    { label: "ROUTE", value: route ? "READY" : "STANDBY", detail: route ? `${route.waypoints.length} WPTS` : "NO ROUTE" },
    { label: "USER CHART", value: userMarks.length ? "READY" : "STANDBY", detail: userMarks.length ? `${userMarks.length} MARKS` : "NO LAYER" },
    { label: "AMI WX", value: ami ? "READY" : "STANDBY", detail: ami ? `${ami.forecastPoints.length} POINTS` : "NO FORECAST" },
  ];

  return <main className={`navdash-navbrief-console min-h-screen ${shell}`}>
    <style jsx global>{`
      body:has(.navdash-navbrief-console) .navdash-global-nav{display:none!important}
      .navdash-navbrief-console *{border-radius:0!important}
      .navdash-navbrief-console button,.navdash-navbrief-console input,.navdash-navbrief-console textarea{box-shadow:none!important}
      @media print{body:has(.navdash-navbrief-console) .navdash-global-nav,.no-print{display:none!important}.navdash-navbrief-console{background:#fff!important;color:#000!important}.print-panel,.print-panel *{color:#000!important}.print-panel{background:#fff!important;border-color:#777!important}.print-sub{background:#fff!important;border-color:#aaa!important}}
    `}</style>

    <div className="mx-auto min-h-screen w-full max-w-[1800px] px-3 py-3 sm:px-4 lg:px-5">
      <header className={`no-print border ${panel}`}>
        <div className="flex min-h-[66px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className={`text-[10px] font-black uppercase tracking-[.22em] ${accent}`}>M/V MB480 · NAVDASH 1.3</div>
            <div className="mt-1 flex items-baseline gap-3"><h1 className="text-[24px] font-black tracking-tight">NAV BRIEF</h1><span className={`text-[11px] font-bold uppercase tracking-[.12em] ${muted}`}>Voyage Planning Console</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={refreshInputs} className={`border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>Refresh Inputs</button>
            <button onClick={toggleTheme} className={`border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>{nightMode ? "Day Mode" : "Night Mode"}</button>
            <button onClick={() => window.print()} className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] text-black hover:bg-[#d6b63b]">Print / PDF</button>
          </div>
        </div>
      </header>

      <section className="no-print mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        {status.map(item => <div key={item.label} className={`border px-3 py-2 ${sub}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${muted}`}>{item.label}</div>
          <div className="mt-1 flex items-center justify-between"><span className={`text-[14px] font-black ${item.value === "READY" ? accent : muted}`}>{item.value}</span><span className={`font-mono text-[10px] ${muted}`}>{item.detail}</span></div>
        </div>)}
      </section>

      <section className="no-print mt-2 grid grid-cols-1 gap-2 xl:grid-cols-3">
        <div className={`border p-3 ${panel}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>01 · Route</div>
          <h2 className="mt-1 text-[15px] font-black">RTZ / CURRENT ROUTE</h2>
          <p className={`mt-1 text-[11px] leading-5 ${muted}`}>Load an RTZ manually or pull the route already loaded on this NavDash device.</p>
          <input type="file" accept=".rtz,.xml,.txt" onChange={loadRtz} className={`mt-3 w-full border px-3 py-2 text-[11px] ${input}`} />
          <button onClick={() => void loadCurrentNavDashRoute(false)} className={`mt-2 w-full border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>Use Current NavDash Route</button>
          <div className={`mt-2 min-h-[16px] font-mono text-[10px] ${muted}`}>{routeSource || "NO ROUTE SOURCE"}</div>
          {routeError && <div className="mt-2 border border-red-500/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">{routeError}</div>}
        </div>

        <div className={`border p-3 ${panel}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>02 · User Chart</div>
          <h2 className="mt-1 text-[15px] font-black">USER LAYER</h2>
          <p className={`mt-1 text-[11px] leading-5 ${muted}`}>Navtor user-chart XML, JSON / GeoJSON, or CSV point marks. Imported marks are saved to the same user layer used by the main map.</p>
          <input type="file" accept=".xml,.json,.geojson,.csv,.txt" onChange={loadUserChart} className={`mt-3 w-full border px-3 py-2 text-[11px] ${input}`} />
          <div className={`mt-2 font-mono text-[10px] ${muted}`}>{userChartFile ? `FILE · ${userChartFile}` : userMarks.length ? `SAVED LAYER · ${userMarks.length} MARKS` : "NO USER CHART"}</div>
          {userChartError && <div className="mt-2 border border-red-500/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">{userChartError}</div>}
        </div>

        <div className={`border p-3 ${panel}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>03 · Planning</div>
          <h2 className="mt-1 text-[15px] font-black">VOYAGE INPUTS</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className={`text-[10px] font-black uppercase tracking-[.08em] ${muted}`}>Departure
              <input type="datetime-local" value={departure} onChange={e => setDeparture(e.target.value)} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case tracking-normal ${input}`} />
            </label>
            <label className={`text-[10px] font-black uppercase tracking-[.08em] ${muted}`}>Planning Speed · KT
              <input type="number" min="1" step="0.1" value={plannedSpeed} onChange={e => setPlannedSpeed(e.target.value)} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case tracking-normal ${input}`} />
            </label>
          </div>
          <div className={`mt-2 font-mono text-[10px] ${muted}`}>{ami ? `AMI · ${ami.sourceName}` : "AMI OVERLAY · NOT LOADED"}</div>
        </div>
      </section>

      <section className="no-print mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <label className={`border p-3 ${panel}`}><span className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Bridge Team / Watch Notes</span><textarea value={opsNotes} onChange={e => setOpsNotes(e.target.value)} className={`mt-2 min-h-24 w-full resize-y border p-3 text-[11px] leading-5 ${input}`} placeholder="Traffic, machinery limitations, visibility triggers, master's standing instructions, watch items..." /></label>
        <label className={`border p-3 ${panel}`}><span className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Arrival / Port / Pilotage Notes</span><textarea value={portNotes} onChange={e => setPortNotes(e.target.value)} className={`mt-2 min-h-24 w-full resize-y border p-3 text-[11px] leading-5 ${input}`} placeholder="Pilot station, reporting, berth, local hazards, arrival restrictions..." /></label>
      </section>

      <section className={`print-panel mt-2 border p-4 ${panel}`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
          <div><div className={`text-[9px] font-black uppercase tracking-[.2em] ${accent}`}>Navigation Brief</div><h2 className="mt-1 text-[20px] font-black">{route?.routeName || "NO ROUTE LOADED"}</h2></div>
          <div className={`font-mono text-[10px] ${muted}`}>GENERATED · {formatDateTime(new Date())}</div>
        </div>

        {!route ? <div className={`print-sub mt-3 border p-3 text-[11px] ${sub}`}>Load an RTZ or use the current NavDash route to build the brief.</div> : <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[['DEPARTURE', origin?.name || '--'], ['DESTINATION', destination?.name || '--'], ['DIST / SPEED', `${distanceNm.toFixed(1)} NM · ${speed.toFixed(1)} KT`], ['ETA', formatDateTime(eta)]].map(([k,v]) => <div key={k} className={`print-sub border p-2 ${sub}`}><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>{k}</div><div className="mt-1 text-[12px] font-black">{v}</div></div>)}
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            <div className={`print-sub border p-3 ${sub}`}><div className="text-[12px] font-black">WEATHER ROUTING STRATEGY</div><div className={`mt-2 text-[11px] leading-5 ${muted}`}>{ami ? <>{ami.sourceName}{ami.referenceId ? ` · REF ${ami.referenceId}` : ""} · ISSUED {formatUtc(ami.issuedAt)}{ami.warnings ? <><br/><b>Warnings:</b> {ami.warnings}</> : null}{ami.synopticDiscussion ? <><br/><b>Synoptic:</b> {ami.synopticDiscussion}</> : null}<br/>{strongestWind ? `Max wind ${strongestWind.windSpeedKt} kt at ${formatUtc(strongestWind.validAt)}. ` : ""}{strongestGust ? `Peak gust ${strongestGust.gustKt} kt. ` : ""}{highestSea ? `Max significant seas ${highestSea.significantWaveM.toFixed(1)} m at ${formatUtc(highestSea.validAt)}.` : ""}{ami.cyclone ? <><br/><b>Tropical:</b> {ami.cyclone.summary}</> : null}</> : "No AMI route forecast loaded."}</div></div>
            <div className={`print-sub border p-3 ${sub}`}><div className="text-[12px] font-black">ROUTING DECISION POINTS</div><div className={`mt-2 text-[11px] leading-5 ${muted}`}>{relevantMarks.length ? relevantMarks.map(mark => <div key={mark.id}>• <b>{mark.name}</b> · {formatCoord(mark.lat, true)} / {formatCoord(mark.lon, false)} · {mark.routeDistance.toFixed(1)} NM to nearest route waypoint</div>) : "No user-layer marks loaded."}</div></div>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className={`print-sub border p-3 ${sub}`}><div className="text-[12px] font-black">BRIDGE TEAM INTENT</div><div className={`mt-2 whitespace-pre-wrap text-[11px] leading-5 ${muted}`}>{opsNotes.trim() || "Maintain the planned RTZ track, compare actual conditions against AMI guidance, and reassess route execution when observed conditions materially differ from forecast."}</div></div>
            <div className={`print-sub border p-3 ${sub}`}><div className="text-[12px] font-black">NAVIGATION</div><div className={`mt-2 whitespace-pre-wrap text-[11px] leading-5 ${muted}`}>{portNotes.trim() || `Route contains ${route.waypoints.length} waypoints and ${legs.length} legs. Confirm charted hazards, reporting requirements, pilotage, and arrival restrictions against current official publications before execution.`}</div></div>
          </div>

          {ami && <div className="overflow-x-auto border border-white/10"><table className="w-full border-collapse text-[10px]"><thead><tr className={sub}><th className="border border-white/10 px-2 py-2 text-left">VALID</th><th className="border border-white/10 px-2 py-2 text-left">POSITION</th><th className="border border-white/10 px-2 py-2 text-left">WIND</th><th className="border border-white/10 px-2 py-2 text-left">SEAS</th><th className="border border-white/10 px-2 py-2 text-left">CONDITIONS</th></tr></thead><tbody>{ami.forecastPoints.map((p,i) => <tr key={`${p.validAt}-${i}`}><td className="border border-white/10 px-2 py-2">{formatUtc(p.validAt)}</td><td className="border border-white/10 px-2 py-2 font-mono">{p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°</td><td className="border border-white/10 px-2 py-2">{String(p.windDirectionDeg).padStart(3,"0")}° / {p.windSpeedKt} KT G {p.gustKt}</td><td className="border border-white/10 px-2 py-2">{p.significantWaveM.toFixed(1)} M @ {p.significantWavePeriodSec} S</td><td className="border border-white/10 px-2 py-2">{p.conditions}</td></tr>)}</tbody></table></div>}

          <div className="overflow-x-auto border border-white/10"><table className="w-full border-collapse text-[10px]"><thead><tr className={sub}><th className="border border-white/10 px-2 py-2 text-left">LEG</th><th className="border border-white/10 px-2 py-2 text-left">FROM</th><th className="border border-white/10 px-2 py-2 text-left">TO</th><th className="border border-white/10 px-2 py-2 text-right">COURSE</th><th className="border border-white/10 px-2 py-2 text-right">DIST</th></tr></thead><tbody>{legs.map((leg,index) => <tr key={`${leg.from.id}-${leg.to.id}-${index}`}><td className="border border-white/10 px-2 py-2">{index+1}</td><td className="border border-white/10 px-2 py-2">{leg.from.name}</td><td className="border border-white/10 px-2 py-2">{leg.to.name}</td><td className="border border-white/10 px-2 py-2 text-right font-mono">{String(Math.round(leg.bearing)).padStart(3,"0")}°</td><td className="border border-white/10 px-2 py-2 text-right font-mono">{leg.distance.toFixed(1)} NM</td></tr>)}</tbody></table></div>

          <div className="border border-[#c9a227] px-3 py-2 text-center text-[10px] font-black uppercase tracking-[.08em]">Routing principle · Safe navigation first. RTZ is planned track. User chart is bridge-team context. AMI is forecast guidance. Reassess when actual conditions, traffic, hazards, or official information invalidate the plan.</div>
        </div>}
      </section>
    </div>
  </main>;
}
