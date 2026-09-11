"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RoutePlan = { routeName: string; waypoints: Waypoint[] };
type Leg = { index: number; from: Waypoint; to: Waypoint; distance: number; bearing: number };
type Finding = {
  id: string;
  category: "WEATHER" | "TIDES" | "NAVIGATION";
  severity: "INFO" | "ADVISORY" | "WARNING";
  title: string;
  detail: string;
  sourceName: string;
  sourceUrl: string;
  legIndex?: number;
  waypointId?: string;
};
type IntelligenceResponse = {
  ok: boolean;
  fetchedAt?: string;
  route?: { totalNm: number; sampleCount: number; departureTime: string; estimatedArrival: string };
  vessel?: { loaFt: number; beamFt: number; draftFt: number | null; airDraftFt: number | null };
  findings?: Finding[];
  sources?: string[];
  error?: string;
};

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const WORKBENCH_INPUTS_KEY = "navdash-route-workbench-inputs-v1";

function toRad(v: number) { return v * Math.PI / 180; }
function toDeg(v: number) { return v * 180 / Math.PI; }
function nmBetween(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const r = 3440.065;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearingBetween(a: Waypoint, b: Waypoint) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  return (toDeg(Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
  )) + 360) % 360;
}
function formatHours(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function buildLegs(route: RoutePlan | null): Leg[] {
  if (!route) return [];
  return route.waypoints.slice(1).map((to, index) => ({
    index: index + 1,
    from: route.waypoints[index],
    to,
    distance: nmBetween(route.waypoints[index], to),
    bearing: bearingBetween(route.waypoints[index], to),
  }));
}
function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim();
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;
  const hemi = text.match(/[NSEW]/i)?.[0]?.toUpperCase();
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;
  let value = nums.length >= 3 ? Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600 : nums.length >= 2 ? Math.abs(nums[0]) + nums[1] / 60 : nums[0];
  if (hemi === "S" || hemi === "W" || (!hemi && nums[0] < 0)) value *= -1;
  if ((isLat && Math.abs(value) > 90) || (!isLat && Math.abs(value) > 180)) return NaN;
  return value;
}
function getAttr(node: Element, names: string[]) {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}
function parseRtz(xmlText: string): RoutePlan {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeName = getAttr(routeNode, ["name", "Name", "id", "ID"]) || routeNode.querySelector("routeName,name")?.textContent?.trim() || "Loaded RTZ Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    const name = getAttr(node, ["name", "Name", "id", "ID"]) || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim() || `Waypoint ${index + 1}`;
    return { id: `WP${String(index + 1).padStart(2, "0")}`, name, lat, lon };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}
function normalizeRoutePayload(payload: any): RoutePlan | null {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: `WP${String(index + 1).padStart(2, "0")}`,
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  if (waypoints.length < 2) return null;
  return { routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "Current NavDash Route"), waypoints };
}
function defaultDepartureLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function VoyageWorkbenchPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const dayMode = !nightMode;
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [routeSource, setRouteSource] = useState("NO ROUTE LOADED");
  const [routeError, setRouteError] = useState("");
  const [plannedSpeed, setPlannedSpeed] = useState("10");
  const [draftFt, setDraftFt] = useState("");
  const [airDraftFt, setAirDraftFt] = useState("");
  const [departureTime, setDepartureTime] = useState(defaultDepartureLocal());
  const [activeLeg, setActiveLeg] = useState(1);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligenceResponse | null>(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [intelError, setIntelError] = useState("");
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);

  const legs = useMemo(() => buildLegs(route), [route]);
  const totalDistance = useMemo(() => legs.reduce((sum, leg) => sum + leg.distance, 0), [legs]);
  const speed = Math.max(0.1, Number(plannedSpeed) || 10);
  const passageHours = totalDistance / speed;
  const readyForIntel = Boolean(route && Number(draftFt) > 0 && Number(airDraftFt) > 0 && departureTime);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(WORKBENCH_INPUTS_KEY) || "{}");
      if (saved.plannedSpeed) setPlannedSpeed(String(saved.plannedSpeed));
      if (saved.draftFt) setDraftFt(String(saved.draftFt));
      if (saved.airDraftFt) setAirDraftFt(String(saved.airDraftFt));
      if (saved.departureTime) setDepartureTime(String(saved.departureTime));
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(WORKBENCH_INPUTS_KEY, JSON.stringify({ plannedSpeed, draftFt, airDraftFt, departureTime })); } catch {}
  }, [plannedSpeed, draftFt, airDraftFt, departureTime]);

  const applyRoute = (next: RoutePlan, source: string) => {
    setRoute(next);
    setRouteSource(source);
    setRouteError("");
    setActiveLeg(1);
    setFindings([]);
    setIntelligence(null);
  };

  const loadCurrentRoute = async () => {
    setRouteError("");
    try {
      const localRaw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
      const local = localRaw ? normalizeRoutePayload(JSON.parse(localRaw)) : null;
      if (local) return applyRoute(local, "CURRENT NAVDASH ROUTE");
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route service returned ${response.status}.`);
      const shared = normalizeRoutePayload(await response.json());
      if (!shared) throw new Error("No current shared route is available.");
      applyRoute(shared, "SHARED ROUTE");
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Could not load the current NavDash route.");
    }
  };

  const onRtz = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { applyRoute(parseRtz(await file.text()), file.name.toUpperCase()); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Could not read route file."); }
    finally { event.target.value = ""; }
  };

  const runIntelligence = async () => {
    if (!route || !readyForIntel) return;
    setLoadingIntel(true);
    setIntelError("");
    try {
      const response = await fetch("/api/route-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: route.waypoints,
          plannedSpeed: speed,
          draftFt: Number(draftFt),
          airDraftFt: Number(airDraftFt),
          departureTime: new Date(departureTime).toISOString(),
        }),
      });
      const data: IntelligenceResponse = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `Route intelligence returned ${response.status}.`);
      setIntelligence(data);
      setFindings(Array.isArray(data.findings) ? data.findings : []);
    } catch (error) {
      setIntelError(error instanceof Error ? error.message : "Automatic route intelligence failed.");
    } finally {
      setLoadingIntel(false);
    }
  };

  useEffect(() => { void loadCurrentRoute(); }, []);
  useEffect(() => {
    if (!readyForIntel) return;
    const timer = window.setTimeout(() => { void runIntelligence(); }, 700);
    return () => window.clearTimeout(timer);
  }, [route, plannedSpeed, draftFt, airDraftFt, departureTime]);

  useEffect(() => {
    let cancelled = false;
    const renderMap = async () => {
      if (!mapNodeRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapNodeRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(mapNodeRef.current, { zoomControl: true, attributionControl: true }).setView([20.5, -157.5], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(mapRef.current);
      }
      if (routeLayerRef.current) { try { routeLayerRef.current.remove(); } catch {} routeLayerRef.current = null; }
      if (!route || route.waypoints.length < 2) return;
      const group = L.layerGroup().addTo(mapRef.current);
      routeLayerRef.current = group;
      const latLngs = route.waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]);
      L.polyline(latLngs, { weight: 3 }).addTo(group);
      if (activeLeg > 0 && route.waypoints[activeLeg]) {
        L.polyline([[route.waypoints[activeLeg - 1].lat, route.waypoints[activeLeg - 1].lon], [route.waypoints[activeLeg].lat, route.waypoints[activeLeg].lon]], { weight: 6, opacity: 0.75 }).addTo(group);
      }
      route.waypoints.forEach((wp, index) => {
        L.circleMarker([wp.lat, wp.lon], { radius: index === 0 || index === route.waypoints.length - 1 ? 6 : 4, weight: 2, fillOpacity: 1 })
          .bindTooltip(`${wp.id} · ${wp.name}`, { direction: "top" }).addTo(group);
      });
      if (!mapRef.current.__workbenchFitted) {
        mapRef.current.fitBounds(L.latLngBounds(latLngs).pad(0.15));
        mapRef.current.__workbenchFitted = true;
      }
      window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };
    void renderMap();
    return () => { cancelled = true; };
  }, [route, activeLeg]);

  useEffect(() => () => {
    if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; }
  }, []);

  const shell = dayMode ? "bg-[#edf1f4] text-[#17212b]" : "bg-[#04080c] text-[#dbe6ee]";
  const panel = dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-[#08111a]";
  const sub = dayMode ? "border-slate-300 bg-[#f5f7f9]" : "border-white/10 bg-[#050a0f]";
  const muted = dayMode ? "text-slate-600" : "text-[#8193a4]";
  const button = dayMode ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-100" : "border-white/15 bg-[#101820] text-[#dbe6ee] hover:bg-[#17242e]";
  const accent = dayMode ? "text-[#7a5418]" : "text-[#d8a43b]";
  const cyan = dayMode ? "text-[#17677e]" : "text-[#67d7f2]";

  return (
    <main className={`min-h-screen ${shell}`}>
      <div className="mx-auto max-w-[1800px] p-3 md:p-5">
        <header className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${panel}`}>
          <div>
            <div className={`text-[11px] font-semibold tracking-[0.26em] ${accent}`}>NAVDASH · VOYAGE PLANNING</div>
            <h1 className="mt-1 text-xl font-semibold tracking-wide md:text-2xl">VOYAGE WORKBENCH</h1>
            <div className={`mt-1 text-xs ${muted}`}>Load route → enter voyage particulars → official-source intelligence runs automatically</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold tracking-wide">
            <Link href="/bridge" className={`rounded-lg border px-3 py-2 ${button}`}>MAIN</Link>
            <button onClick={toggleTheme} className={`rounded-lg border px-3 py-2 ${button}`}>{dayMode ? "BRIDGE NIGHT" : "DAY MODE"}</button>
            <button onClick={loadCurrentRoute} className={`rounded-lg border px-3 py-2 ${button}`}>CURRENT ROUTE</button>
            <label className={`cursor-pointer rounded-lg border px-3 py-2 ${button}`}>LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml,application/xml" className="hidden" onChange={onRtz} /></label>
          </div>
        </header>

        {routeError ? <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2 text-sm text-red-300">{routeError}</div> : null}

        <section className={`mb-3 rounded-xl border p-3 ${panel}`}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div><div className={`text-[10px] tracking-[0.18em] ${muted}`}>VESSEL</div><div className="mt-1 text-sm font-semibold">MB480 · 265 × 60 ft</div></div>
            <label><div className={`text-[10px] tracking-[0.18em] ${muted}`}>DRAFT · FT</div><input value={draftFt} onChange={(e) => setDraftFt(e.target.value)} inputMode="decimal" placeholder="Required" className={`mt-1 w-full rounded border px-2 py-2 text-sm ${sub}`} /></label>
            <label><div className={`text-[10px] tracking-[0.18em] ${muted}`}>AIR DRAFT · FT</div><input value={airDraftFt} onChange={(e) => setAirDraftFt(e.target.value)} inputMode="decimal" placeholder="Required" className={`mt-1 w-full rounded border px-2 py-2 text-sm ${sub}`} /></label>
            <label><div className={`text-[10px] tracking-[0.18em] ${muted}`}>PLANNED SPEED · KT</div><input value={plannedSpeed} onChange={(e) => setPlannedSpeed(e.target.value)} inputMode="decimal" className={`mt-1 w-full rounded border px-2 py-2 text-sm ${sub}`} /></label>
            <label className="sm:col-span-2"><div className={`text-[10px] tracking-[0.18em] ${muted}`}>PLANNED DEPARTURE · LOCAL DEVICE TIME</div><input type="datetime-local" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className={`mt-1 w-full rounded border px-2 py-2 text-sm ${sub}`} /></label>
          </div>
          <div className={`mt-2 text-xs ${readyForIntel ? cyan : muted}`}>{readyForIntel ? (loadingIntel ? "SCANNING OFFICIAL SOURCES…" : "AUTOMATIC ROUTE INTELLIGENCE ACTIVE") : "Enter draft and air draft to start automatic analysis."}</div>
        </section>

        <section className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className={`rounded-xl border p-3 ${panel}`}><div className={`text-[10px] tracking-[0.18em] ${muted}`}>ROUTE</div><div className="mt-1 truncate text-sm font-semibold">{route?.routeName || "NO ROUTE"}</div><div className={`mt-1 truncate text-xs ${muted}`}>{routeSource}</div></div>
          <div className={`rounded-xl border p-3 ${panel}`}><div className={`text-[10px] tracking-[0.18em] ${muted}`}>DISTANCE</div><div className={`mt-1 text-2xl font-semibold ${cyan}`}>{route ? totalDistance.toFixed(1) : "--"}<span className="ml-1 text-xs">NM</span></div></div>
          <div className={`rounded-xl border p-3 ${panel}`}><div className={`text-[10px] tracking-[0.18em] ${muted}`}>WAYPOINTS / LEGS</div><div className="mt-1 text-2xl font-semibold">{route ? `${route.waypoints.length} / ${legs.length}` : "--"}</div></div>
          <div className={`rounded-xl border p-3 ${panel}`}><div className={`text-[10px] tracking-[0.18em] ${muted}`}>PASSAGE @ {speed.toFixed(1)} KT</div><div className="mt-1 text-2xl font-semibold">{route ? formatHours(passageHours) : "--"}</div></div>
        </section>

        <section className="grid gap-3 xl:grid-cols-[1.25fr_.75fr]">
          <div className={`overflow-hidden rounded-xl border ${panel}`}>
            <div className="border-b border-white/10 px-4 py-3"><div className={`text-[10px] tracking-[0.18em] ${muted}`}>ROUTE DISPLAY</div><div className="text-sm font-semibold">Planning chart</div></div>
            <div ref={mapNodeRef} className="h-[500px] w-full bg-[#071018]" />
          </div>

          <aside className={`rounded-xl border p-3 ${panel}`}>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div><div className={`text-[10px] tracking-[0.18em] ${muted}`}>ROUTE INTELLIGENCE</div><div className="text-sm font-semibold">Automatic official-source findings</div></div>
              <button disabled={!readyForIntel || loadingIntel} onClick={() => void runIntelligence()} className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${button} disabled:opacity-40`}>REFRESH</button>
            </div>
            {intelError ? <div className="mb-2 rounded border border-red-500/40 p-2 text-xs text-red-300">{intelError}</div> : null}
            {!readyForIntel ? <div className={`rounded-lg border p-4 text-sm ${sub} ${muted}`}>Load the route and enter draft, air draft and departure time. The workbench will start searching automatically.</div> : null}
            {readyForIntel && loadingIntel ? <div className={`rounded-lg border p-4 text-sm ${sub}`}>Querying NOAA / NWS and NOAA CO-OPS along the route…</div> : null}
            {readyForIntel && !loadingIntel && findings.length === 0 && !intelError ? <div className={`rounded-lg border p-4 text-sm ${sub}`}>No active route-specific weather alerts found. Forecast and tide products will appear here when available.</div> : null}
            <div className="space-y-2">
              {findings.map((finding) => (
                <button key={finding.id} onClick={() => finding.legIndex ? setActiveLeg(finding.legIndex) : undefined} className={`block w-full rounded-lg border p-3 text-left ${sub}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-semibold tracking-[0.16em] ${finding.category === "WEATHER" ? cyan : accent}`}>{finding.category}</span>
                    <span className={`text-[10px] font-semibold ${finding.severity === "WARNING" ? "text-red-400" : finding.severity === "ADVISORY" ? "text-amber-400" : muted}`}>{finding.severity}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold">{finding.title}</div>
                  <div className={`mt-1 text-xs leading-5 ${muted}`}>{finding.detail}</div>
                  <a href={finding.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`mt-2 inline-block text-[10px] font-semibold ${cyan}`}>{finding.sourceName} ↗</a>
                </button>
              ))}
            </div>
            {intelligence?.fetchedAt ? <div className={`mt-3 text-[10px] ${muted}`}>UPDATED {new Date(intelligence.fetchedAt).toLocaleString()} · {intelligence.route?.sampleCount || 0} ROUTE SAMPLE POINTS</div> : null}
          </aside>
        </section>

        <section className={`mt-3 rounded-xl border ${panel}`}>
          <div className="border-b border-white/10 px-4 py-3"><div className={`text-[10px] tracking-[0.18em] ${muted}`}>LEG REVIEW</div><div className="text-sm font-semibold">Route geometry and timing</div></div>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className={`sticky top-0 ${dayMode ? "bg-slate-100" : "bg-[#0b141c]"}`}><tr className={muted}><th className="px-3 py-2">LEG</th><th className="px-3 py-2">FROM</th><th className="px-3 py-2">TO</th><th className="px-3 py-2 text-right">COURSE</th><th className="px-3 py-2 text-right">DIST</th><th className="px-3 py-2 text-right">TIME</th></tr></thead>
              <tbody>{legs.map((leg) => <tr key={leg.index} onClick={() => setActiveLeg(leg.index)} className={`cursor-pointer border-t ${dayMode ? "border-slate-200" : "border-white/5"} ${activeLeg === leg.index ? (dayMode ? "bg-amber-50" : "bg-[#1a1510]") : ""}`}><td className={`px-3 py-2 font-semibold ${accent}`}>{String(leg.index).padStart(2, "0")}</td><td className="px-3 py-2">{leg.from.name}</td><td className="px-3 py-2">{leg.to.name}</td><td className="px-3 py-2 text-right">{leg.bearing.toFixed(0)}°T</td><td className="px-3 py-2 text-right">{leg.distance.toFixed(1)} NM</td><td className="px-3 py-2 text-right">{formatHours(leg.distance / speed)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <div className={`mt-3 text-center text-[10px] tracking-[0.16em] ${muted}`}>VOYAGE WORKBENCH v0.2 · ISOLATED FROM LIVE NAVDASH · OFFICIAL-SOURCE AUTOMATION</div>
      </div>
    </main>
  );
}
