"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";
import type { AmiRouteForecast } from "../../lib/amiRouteForecast";
import NavBriefBuilderPage from "../nav-brief/page";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteBrief = { routeName: string; waypoints: Waypoint[] };
type PassageEvent = {
  id: string;
  type: string;
  waypointId: string;
  trigger: string;
  note: string;
  createdAt: string;
};
type TideEvent = { time: string; valueFt: number; type: string };
type TideResult = {
  ok: boolean;
  station?: { id: string; name: string; lat: number; lon: number; distanceNm?: number };
  trend?: string;
  events?: TideEvent[];
  representativeWarning?: string | null;
  error?: string;
};

type TabId = "overview" | "route" | "wx" | "tides" | "hazards" | "reporting" | "events" | "review" | "brief";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const AMI_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const EVENTS_STORAGE_KEY = "navdash-passage-events-v1";
const PLAN_STORAGE_KEY = "navdash-passage-plan-v1";

const tabs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "route", label: "Route" },
  { id: "wx", label: "WX" },
  { id: "tides", label: "Tides / UKC" },
  { id: "hazards", label: "Hazards" },
  { id: "reporting", label: "Reporting" },
  { id: "events", label: "Events" },
  { id: "review", label: "Review" },
  { id: "brief", label: "Nav Brief" },
];

const EVENT_TYPES = ["Position Fixing", "Echo Sounder", "Reporting", "Pilotage", "Speed Change", "Machinery", "Abort Point", "Anchorage", "Note"];

function toRad(value: number) { return value * Math.PI / 180; }
function toDeg(value: number) { return value * 180 / Math.PI; }
function normalizeDeltaLon(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }
function distanceNm(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat), dLon = toRad(normalizeDeltaLon(b.lon - a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearing(a: Waypoint, b: Waypoint) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(normalizeDeltaLon(b.lon - a.lon));
  return (toDeg(Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon))) + 360) % 360;
}
function normalizeRoute(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${String(index + 1).padStart(3, "0")}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "NavDash Route"), waypoints } : null;
}
function readRouteLocal() {
  try { const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY); return raw ? normalizeRoute(JSON.parse(raw)) : null; } catch { return null; }
}
function readAmiLocal() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AMI_STORAGE_KEY) || "null") as AmiRouteForecast | null;
    return parsed?.version === 1 && Array.isArray(parsed.forecastPoints) ? parsed : null;
  } catch { return null; }
}
function routeDistance(route: RouteBrief | null) {
  if (!route) return 0;
  return route.waypoints.slice(1).reduce((sum, point, index) => sum + distanceNm(route.waypoints[index], point), 0);
}
function endpointZone(point?: Waypoint) {
  if (!point) return "--";
  if (point.lat >= 18 && point.lat <= 23.5 && point.lon >= -161.5 && point.lon <= -154) return "HST · UTC-10";
  if (point.lat >= 30 && point.lat <= 46 && point.lon >= 129 && point.lon <= 146) return "JST · UTC+9";
  if (point.lat >= 12 && point.lat <= 22 && point.lon >= 143 && point.lon <= 146.5) return "ChST · UTC+10";
  const offset = Math.max(-12, Math.min(14, Math.round(point.lon / 15)));
  return `Approx. UTC${offset >= 0 ? "+" : ""}${offset}`;
}
function routeCrossesIdl(route: RouteBrief | null) {
  if (!route) return false;
  return route.waypoints.slice(1).some((point, index) => Math.abs(point.lon - route.waypoints[index].lon) > 180);
}
function fmtDate(date: Date | null) {
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--";
}
function fmtTideEvent(event: TideEvent) {
  const date = new Date(event.time);
  const type = event.type === "H" ? "HIGH" : event.type === "L" ? "LOW" : event.type;
  return `${type} · ${fmtDate(date)} · ${event.valueFt.toFixed(1)} FT`;
}

function StatusPill({ state, label }: { state: "ready" | "attention" | "missing"; label: string }) {
  const classes = state === "ready" ? "border-emerald-500/40 text-emerald-400" : state === "attention" ? "border-amber-500/50 text-amber-300" : "border-slate-500/30 text-slate-500";
  const dot = state === "ready" ? "●" : state === "attention" ? "◆" : "○";
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[9px] font-black uppercase tracking-[.1em] ${classes}`}>{dot} {label}</span>;
}

export default function PassagePage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [ami, setAmi] = useState<AmiRouteForecast | null>(null);
  const [events, setEvents] = useState<PassageEvent[]>([]);
  const [departure, setDeparture] = useState("");
  const [speed, setSpeed] = useState("10");
  const [tides, setTides] = useState<{ departure: TideResult | null; arrival: TideResult | null; loading: boolean; error: string }>({ departure: null, arrival: null, loading: false, error: "" });
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [eventWaypoint, setEventWaypoint] = useState("");
  const [eventTrigger, setEventTrigger] = useState("At point");
  const [eventNote, setEventNote] = useState("");

  useEffect(() => {
    const refresh = () => {
      setRoute(readRouteLocal());
      setAmi(readAmiLocal());
      try { const saved = JSON.parse(window.localStorage.getItem(EVENTS_STORAGE_KEY) || "[]"); setEvents(Array.isArray(saved) ? saved : []); } catch { setEvents([]); }
      try {
        const plan = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) || "{}");
        if (typeof plan.departure === "string") setDeparture(plan.departure);
        if (typeof plan.speed === "string" || typeof plan.speed === "number") setSpeed(String(plan.speed));
      } catch {}
    };
    refresh();
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("navdash-ami-overlay-updated", onStorage as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("navdash-ami-overlay-updated", onStorage as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!route) {
      fetch("/api/route-state", { cache: "no-store" }).then(async response => {
        if (!response.ok) return;
        const parsed = normalizeRoute(await response.json());
        if (parsed) setRoute(parsed);
      }).catch(() => {});
    }
  }, [route]);

  useEffect(() => {
    if (!eventWaypoint && route?.waypoints[0]) setEventWaypoint(route.waypoints[0].id);
  }, [route, eventWaypoint]);

  useEffect(() => {
    try { window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ departure, speed })); } catch {}
  }, [departure, speed]);

  const totalNm = useMemo(() => routeDistance(route), [route]);
  const speedKt = Math.max(0.1, Number(speed) || 10);
  const departureDate = departure ? new Date(departure) : null;
  const eta = departureDate && Number.isFinite(departureDate.getTime()) && totalNm > 0 ? new Date(departureDate.getTime() + totalNm / speedKt * 3600000) : null;
  const origin = route?.waypoints[0];
  const destination = route?.waypoints[route.waypoints.length - 1];
  const reportingEvents = events.filter(event => event.type === "Reporting" || event.type === "Pilotage");
  const routeIssues = useMemo(() => {
    if (!route) return [] as string[];
    const issues: string[] = [];
    route.waypoints.slice(1).forEach((point, index) => {
      const previous = route.waypoints[index];
      const legNm = distanceNm(previous, point);
      if (legNm < 0.01) issues.push(`${previous.name} → ${point.name}: zero-length or duplicate leg`);
      if (!Number.isFinite(legNm)) issues.push(`${previous.name} → ${point.name}: invalid geometry`);
    });
    return issues;
  }, [route]);

  const strongestWind = useMemo(() => ami?.forecastPoints?.reduce((best, point) => !best || point.windSpeedKt > best.windSpeedKt ? point : best, ami.forecastPoints[0]), [ami]);
  const highestSea = useMemo(() => ami?.forecastPoints?.reduce((best, point) => !best || point.significantWaveM > best.significantWaveM ? point : best, ami.forecastPoints[0]), [ami]);

  async function calculateTides() {
    if (!origin || !destination || !departureDate || !eta) {
      setTides(current => ({ ...current, error: "Load a route and set departure time first." }));
      return;
    }
    setTides({ departure: null, arrival: null, loading: true, error: "" });
    try {
      const getOne = async (point: Waypoint, at: Date) => {
        const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), at: at.toISOString() });
        const response = await fetch(`/api/nav-brief-tides?${params}`, { cache: "no-store" });
        const json = await response.json() as TideResult;
        if (!response.ok || !json.ok) throw new Error(json.error || `Tide lookup returned ${response.status}`);
        return json;
      };
      const [departureResult, arrivalResult] = await Promise.all([getOne(origin, departureDate), getOne(destination, eta)]);
      setTides({ departure: departureResult, arrival: arrivalResult, loading: false, error: "" });
    } catch (error) {
      setTides({ departure: null, arrival: null, loading: false, error: error instanceof Error ? error.message : "Tide lookup failed." });
    }
  }

  function addEvent(event: FormEvent) {
    event.preventDefault();
    if (!route || !eventWaypoint) return;
    const next: PassageEvent = { id: crypto.randomUUID(), type: eventType, waypointId: eventWaypoint, trigger: eventTrigger.trim() || "At point", note: eventNote.trim(), createdAt: new Date().toISOString() };
    const updated = [...events, next];
    setEvents(updated);
    try { window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(updated)); } catch {}
    setEventNote("");
  }

  function removeEvent(id: string) {
    const updated = events.filter(event => event.id !== id);
    setEvents(updated);
    try { window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(updated)); } catch {}
  }

  const shell = day ? "bg-[#eef2f5] text-slate-900" : "bg-[#04080c] text-slate-100";
  const panel = day ? "border-slate-300 bg-white" : "border-white/15 bg-[#071019]";
  const sub = day ? "border-slate-200 bg-[#f7f9fb]" : "border-white/10 bg-[#0a131c]";
  const muted = day ? "text-[#52606d]" : "text-[#8294a5]";
  const control = day ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "border-white/15 bg-[#071019] text-slate-100 hover:bg-white/5";
  const input = day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#04080c] text-slate-100";
  const accent = day ? "text-[#946f00]" : "text-[#c9a227]";

  const readiness = {
    route: route ? (routeIssues.length ? "attention" : "ready") : "missing",
    wx: ami ? "ready" : "missing",
    tide: tides.departure || tides.arrival ? "ready" : "missing",
    events: events.length ? "ready" : "missing",
    reporting: reportingEvents.length ? "ready" : "missing",
  } as const;

  const TabButton = ({ id, label }: { id: TabId; label: string }) => <button onClick={() => setActiveTab(id)} className={`h-[34px] border px-3 text-[10px] font-black uppercase tracking-[.08em] ${activeTab === id ? "border-[#c9a227] bg-[#c9a227] text-black" : control}`}>{label}</button>;

  return <main className={`min-h-screen ${shell}`}>
    <style jsx global>{`
      body:has(.passage-workspace) .navdash-global-nav{display:none!important}
      .passage-workspace *{border-radius:0!important}
      .passage-navbrief-embed .navdash-navbrief-console>div>header{display:none!important}
      .passage-navbrief-embed .navdash-navbrief-console{min-height:0!important;background:transparent!important}
      .passage-navbrief-embed .navdash-navbrief-console>div{padding-left:0!important;padding-right:0!important;padding-top:0!important}
    `}</style>
    <div className="passage-workspace mx-auto min-h-screen w-full max-w-[1900px] px-3 py-3 sm:px-4 lg:px-5">
      <header className={`border ${panel}`}>
        <div className="flex min-h-[66px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className={`text-[10px] font-black uppercase tracking-[.22em] ${accent}`}>M/V MB480 · NAVDASH 1.3</div>
            <div className="mt-1 flex items-baseline gap-3"><h1 className="text-[24px] font-black tracking-tight">PASSAGE</h1><span className={`text-[11px] font-bold uppercase tracking-[.12em] ${muted}`}>Voyage Planning Workspace</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/bridge" className={`border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>Main</Link>
            <Link href="/route-lab" className={`border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>Route Lab</Link>
            <button onClick={toggleTheme} className={`border px-3 py-2 text-[11px] font-black uppercase tracking-[.08em] ${control}`}>{nightMode ? "Day Mode" : "Night Mode"}</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 border-t border-white/10 p-2">{tabs.map(tab => <TabButton key={tab.id} {...tab} />)}</div>
      </header>

      {activeTab !== "brief" && <section className="mt-2 flex flex-wrap gap-2">
        <StatusPill state={readiness.route} label="Route" />
        <StatusPill state={readiness.wx} label="WX" />
        <StatusPill state={readiness.tide} label="Tides" />
        <StatusPill state={readiness.reporting} label="Reporting" />
        <StatusPill state={readiness.events} label="Events" />
      </section>}

      {activeTab === "overview" && <section className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1.25fr_.75fr]">
        <div className={`border p-4 ${panel}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Voyage Overview</div>
          <div className="mt-2 text-[22px] font-black">{route?.routeName || "NO ROUTE LOADED"}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[["ORIGIN", origin?.name || "--"], ["DESTINATION", destination?.name || "--"], ["DISTANCE", route ? `${totalNm.toFixed(1)} NM` : "--"], ["ETA", fmtDate(eta)]].map(([key, value]) => <div key={key} className={`border p-3 ${sub}`}><div className={`text-[9px] font-black tracking-[.12em] ${muted}`}>{key}</div><div className="mt-1 text-[13px] font-black">{value}</div></div>)}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className={`text-[10px] font-black uppercase tracking-[.08em] ${muted}`}>Departure<input type="datetime-local" value={departure} onChange={event => setDeparture(event.target.value)} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case ${input}`} /></label>
            <label className={`text-[10px] font-black uppercase tracking-[.08em] ${muted}`}>Planning speed · KT<input type="number" min="1" step="0.1" value={speed} onChange={event => setSpeed(event.target.value)} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case ${input}`} /></label>
          </div>
        </div>
        <div className={`border p-4 ${panel}`}>
          <div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Time / IDL</div>
          <div className="mt-3 space-y-2 text-[11px]">
            <div className={`border p-3 ${sub}`}><b>Departure zone</b><div className={`mt-1 font-mono ${muted}`}>{endpointZone(origin)}</div></div>
            <div className={`border p-3 ${sub}`}><b>Arrival zone</b><div className={`mt-1 font-mono ${muted}`}>{endpointZone(destination)}</div></div>
            <div className={`border p-3 ${sub}`}><b>International Date Line</b><div className={`mt-1 ${routeCrossesIdl(route) ? "text-amber-300" : muted}`}>{route ? routeCrossesIdl(route) ? "ROUTE CROSSES IDL · calendar change required" : "No IDL crossing detected in route geometry" : "Load route to evaluate"}</div></div>
          </div>
        </div>
      </section>}

      {activeTab === "route" && <section className={`mt-2 border p-4 ${panel}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Route Analysis</div><h2 className="mt-1 text-[18px] font-black">{route?.routeName || "NO ROUTE"}</h2></div><Link href="/route-lab" className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black">Edit in Route Lab</Link></div>
        {!route ? <div className={`mt-3 border p-3 text-[11px] ${sub}`}>Load an RTZ on the main bridge or Route Lab first.</div> : <>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{[["WAYPOINTS", String(route.waypoints.length)], ["LEGS", String(route.waypoints.length - 1)], ["DISTANCE", `${totalNm.toFixed(1)} NM`], ["GEOMETRY", routeIssues.length ? `${routeIssues.length} REVIEW` : "PASS"]].map(([k,v]) => <div key={k} className={`border p-3 ${sub}`}><div className={`text-[9px] font-black ${muted}`}>{k}</div><div className="mt-1 font-mono text-[13px] font-black">{v}</div></div>)}</div>
          {routeIssues.length > 0 && <div className="mt-3 border border-amber-500/50 bg-amber-950/20 p-3 text-[11px] text-amber-200">{routeIssues.map(issue => <div key={issue}>◆ {issue}</div>)}</div>}
          <div className="mt-3 overflow-x-auto border border-white/10"><table className="w-full border-collapse text-[10px]"><thead><tr className={sub}><th className="border border-white/10 px-2 py-2 text-left">LEG</th><th className="border border-white/10 px-2 py-2 text-left">FROM</th><th className="border border-white/10 px-2 py-2 text-left">TO</th><th className="border border-white/10 px-2 py-2 text-right">COURSE</th><th className="border border-white/10 px-2 py-2 text-right">DIST</th></tr></thead><tbody>{route.waypoints.slice(1).map((point, index) => { const from = route.waypoints[index]; return <tr key={`${from.id}-${point.id}`}><td className="border border-white/10 px-2 py-2">{index + 1}</td><td className="border border-white/10 px-2 py-2">{from.name}</td><td className="border border-white/10 px-2 py-2">{point.name}</td><td className="border border-white/10 px-2 py-2 text-right font-mono">{String(Math.round(bearing(from, point))).padStart(3, "0")}°T</td><td className="border border-white/10 px-2 py-2 text-right font-mono">{distanceNm(from, point).toFixed(1)} NM</td></tr>; })}</tbody></table></div>
        </>}
      </section>}

      {activeTab === "wx" && <section className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1fr_.7fr]">
        <div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Route Weather</div><h2 className="mt-1 text-[18px] font-black">Forecast Coverage</h2>{ami ? <div className="mt-3 grid grid-cols-2 gap-2"><div className={`border p-3 ${sub}`}><div className={`text-[9px] font-black ${muted}`}>MAX WIND</div><div className="mt-1 text-[15px] font-black">{strongestWind?.windSpeedKt ?? "--"} KT</div></div><div className={`border p-3 ${sub}`}><div className={`text-[9px] font-black ${muted}`}>MAX SEAS</div><div className="mt-1 text-[15px] font-black">{highestSea ? `${highestSea.significantWaveM.toFixed(1)} M` : "--"}</div></div><div className={`col-span-2 border p-3 text-[11px] leading-5 ${sub}`}><b>{ami.sourceName}</b>{ami.referenceId ? ` · REF ${ami.referenceId}` : ""}<br/>{ami.warnings ? <><b>Warnings:</b> {ami.warnings}</> : "No warning text in loaded route forecast."}</div></div> : <div className={`mt-3 border p-3 text-[11px] ${sub}`}>No AMI route forecast is loaded in NavDash. The Passage status stays gray until route-weather data exists.</div>}</div>
        <div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Weather Tools</div><div className={`mt-3 text-[11px] leading-5 ${muted}`}>Use the dedicated weather console for forecast review and route-weather work. Passage reads the saved route forecast summary rather than duplicating the weather application.</div><a href="https://wx.wardlab.dev" className="mt-4 inline-flex border border-[#c9a227] bg-[#c9a227] px-4 py-2 text-[10px] font-black uppercase text-black">Open Weather</a></div>
      </section>}

      {activeTab === "tides" && <section className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1fr_.8fr]">
        <div className={`border p-4 ${panel}`}><div className="flex items-center justify-between gap-3"><div><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Tides / Currents</div><h2 className="mt-1 text-[18px] font-black">Endpoint Conditions</h2></div><button onClick={() => void calculateTides()} disabled={tides.loading} className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black disabled:opacity-40">{tides.loading ? "Calculating..." : "Calculate"}</button></div>{tides.error && <div className="mt-3 border border-red-500/50 bg-red-950/20 p-3 text-[11px] text-red-200">{tides.error}</div>}<div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{[["DEPARTURE", tides.departure], ["ARRIVAL", tides.arrival]].map(([label, result]) => { const data = result as TideResult | null; return <div key={String(label)} className={`border p-3 ${sub}`}><div className={`text-[9px] font-black ${muted}`}>{String(label)}</div>{data?.station ? <div className="mt-2 text-[11px] leading-5"><b>{data.station.name}</b> · NOAA {data.station.id}<br/><span className="font-mono">{data.trend || "UNKNOWN"}</span>{(data.events || []).slice(0,4).map((event, index) => <div key={`${event.time}-${index}`} className={muted}>{fmtTideEvent(event)}</div>)}{data.representativeWarning && <div className="mt-2 text-amber-300">◆ {data.representativeWarning}</div>}</div> : <div className={`mt-2 text-[11px] ${muted}`}>Not calculated.</div>}</div>; })}</div></div>
        <div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Dynamic UKC</div><h2 className="mt-1 text-[18px] font-black">Verification Required</h2><div className={`mt-3 border p-3 text-[11px] leading-5 ${sub}`}>NavDash can supply tide timing and route geometry here, but dynamic UKC is not automatically marked ready until vessel draft, squat method, sea-state allowance, and company minimums are explicitly configured and verified.</div><Link href="/tides" className={`mt-3 inline-flex border px-3 py-2 text-[10px] font-black uppercase ${control}`}>Open Tides</Link></div>
      </section>}

      {activeTab === "hazards" && <section className={`mt-2 border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Hazards</div><h2 className="mt-1 text-[18px] font-black">Automated Checks</h2><div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3"><div className={`border p-3 ${sub}`}><StatusPill state={route ? routeIssues.length ? "attention" : "ready" : "missing"} label="Route Geometry" /><div className={`mt-2 text-[11px] ${muted}`}>{route ? routeIssues.length ? `${routeIssues.length} geometry item(s) require review.` : "No invalid or duplicate route legs detected." : "No route loaded."}</div></div><div className={`border p-3 ${sub}`}><StatusPill state={routeCrossesIdl(route) ? "attention" : route ? "ready" : "missing"} label="IDL" /><div className={`mt-2 text-[11px] ${muted}`}>{routeCrossesIdl(route) ? "IDL crossing detected and must be carried through ETA/date handling." : route ? "No IDL crossing detected." : "No route loaded."}</div></div><div className={`border p-3 ${sub}`}><StatusPill state="missing" label="Restricted Areas" /><div className={`mt-2 text-[11px] ${muted}`}>No authoritative global restricted-area / PSSA polygon feed is connected yet, so Passage does not issue a false green check.</div></div></div></section>}

      {activeTab === "reporting" && <section className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1fr_.7fr]"><div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Reporting / Pilotage</div><h2 className="mt-1 text-[18px] font-black">Planned Calls</h2>{reportingEvents.length ? <div className="mt-3 space-y-2">{reportingEvents.map(item => { const wp = route?.waypoints.find(point => point.id === item.waypointId); return <div key={item.id} className={`border p-3 ${sub}`}><div className="flex justify-between gap-2"><b className="text-[11px]">{item.type} · {wp?.name || item.waypointId}</b><span className={`font-mono text-[10px] ${muted}`}>{item.trigger}</span></div>{item.note && <div className={`mt-1 text-[11px] ${muted}`}>{item.note}</div>}</div>; })}</div> : <div className={`mt-3 border p-3 text-[11px] ${sub}`}>No reporting or pilotage events have been entered yet.</div>}</div><div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Source Discipline</div><div className={`mt-3 text-[11px] leading-5 ${muted}`}>Passage stores reporting and pilotage events, but it does not invent VTS channels, reporting points, or pilot instructions. Those remain gray until entered from an authoritative source. Add them in the Events tab.</div><button onClick={() => setActiveTab("events")} className={`mt-3 border px-3 py-2 text-[10px] font-black uppercase ${control}`}>Add Route Event</button></div></section>}

      {activeTab === "events" && <section className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[.7fr_1.3fr]"><form onSubmit={addEvent} className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Add Route Event</div><div className="mt-3 space-y-3"><label className={`block text-[10px] font-black uppercase ${muted}`}>Type<select value={eventType} onChange={event => setEventType(event.target.value)} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case ${input}`}>{EVENT_TYPES.map(type => <option key={type}>{type}</option>)}</select></label><label className={`block text-[10px] font-black uppercase ${muted}`}>Waypoint<select value={eventWaypoint} onChange={event => setEventWaypoint(event.target.value)} disabled={!route} className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case ${input}`}>{route?.waypoints.map((wp,index) => <option key={wp.id} value={wp.id}>{index + 1}. {wp.name}</option>)}</select></label><label className={`block text-[10px] font-black uppercase ${muted}`}>Trigger<input value={eventTrigger} onChange={event => setEventTrigger(event.target.value)} placeholder="At point / 10 NM before / 30 min before" className={`mt-1 w-full border px-3 py-2 text-[11px] normal-case ${input}`} /></label><label className={`block text-[10px] font-black uppercase ${muted}`}>Note<textarea value={eventNote} onChange={event => setEventNote(event.target.value)} placeholder="VHF channel, action, fixing interval, machinery state, abort criteria..." className={`mt-1 min-h-24 w-full border p-3 text-[11px] normal-case ${input}`} /></label><button disabled={!route} className="w-full border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black disabled:opacity-40">Add Event</button></div></form><div className={`border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Bridge Events</div>{events.length ? <div className="mt-3 space-y-2">{events.map(item => { const wp = route?.waypoints.find(point => point.id === item.waypointId); return <div key={item.id} className={`border p-3 ${sub}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[11px] font-black">{item.type} · {wp?.name || item.waypointId}</div><div className={`mt-1 font-mono text-[10px] ${muted}`}>{item.trigger}</div>{item.note && <div className={`mt-2 text-[11px] ${muted}`}>{item.note}</div>}</div><button onClick={() => removeEvent(item.id)} className="border border-red-500/40 px-2 py-1 text-[9px] font-black uppercase text-red-300">Remove</button></div></div>; })}</div> : <div className={`mt-3 border p-3 text-[11px] ${sub}`}>No bridge events configured.</div>}</div></section>}

      {activeTab === "review" && <section className={`mt-2 border p-4 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${accent}`}>Passage Review</div><h2 className="mt-1 text-[18px] font-black">Automated Readiness</h2><div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{[
        [readiness.route, "Route geometry", route ? routeIssues.length ? "Review route geometry warnings." : `${route.waypoints.length} waypoints checked.` : "Load a route."],
        [readiness.wx, "Weather", ami ? `${ami.forecastPoints.length} route forecast points loaded.` : "No route forecast loaded."],
        [readiness.tide, "Tides", tides.departure || tides.arrival ? "Endpoint tide lookup completed." : "Tides have not been calculated."],
        [readiness.reporting, "Reporting / pilotage", reportingEvents.length ? `${reportingEvents.length} planned event(s).` : "No reporting or pilotage events entered."],
        [readiness.events, "Bridge events", events.length ? `${events.length} route event(s) configured.` : "No bridge events configured."],
        ["attention", "Human verification", "ECDIS transfer/check, publications, stability, UKC assumptions, regulatory submissions, and Master approval remain human verification items."],
      ].map(([state,label,detail]) => <div key={String(label)} className={`border p-3 ${sub}`}><StatusPill state={state as "ready"|"attention"|"missing"} label={String(label)} /><div className={`mt-2 text-[11px] leading-5 ${muted}`}>{String(detail)}</div></div>)}</div><button onClick={() => setActiveTab("brief")} className="mt-4 border border-[#c9a227] bg-[#c9a227] px-4 py-2 text-[10px] font-black uppercase text-black">Open Nav Brief</button></section>}

      {activeTab === "brief" && <section className="passage-navbrief-embed mt-2"><NavBriefBuilderPage /></section>}
    </div>
  </main>;
}
