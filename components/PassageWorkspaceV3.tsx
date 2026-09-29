"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../lib/useBridgeTheme";
import type { AmiRouteForecast } from "../lib/amiRouteForecast";
import NavBriefBuilderPage from "../app/nav-brief/page";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteBrief = { routeName: string; waypoints: Waypoint[] };
type LegPlan = {
  speedKt?: number;
  xtdPortNm?: number;
  xtdStbdNm?: number;
  fixMethod?: string;
  fixIntervalMin?: number;
  chartDepthFt?: number;
  tideFt?: number;
};
type UkcSettings = {
  draftFt: number;
  squatFt: number;
  seaAllowanceFt: number;
  companyAllowanceFt: number;
  minUkcFt: number;
};
type PassageEvent = {
  id: string;
  type: string;
  waypointId: string;
  triggerType: "point" | "nm-before" | "min-before";
  triggerValue: number;
  note: string;
  source: string;
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
type RouteWeatherPoint = { windKt: number | null; waveHeightFt: number | null };
type RouteWeather = {
  provider?: string;
  product?: string;
  modelRun?: string | null;
  sampleCount?: number;
  coveredSampleCount?: number;
  frames?: Array<{ validAt: string; points: RouteWeatherPoint[] }>;
  note?: string;
  error?: string;
};
type EncFinding = {
  waypointId: string;
  waypointName: string;
  kind: "hazard" | "pilot" | "reporting" | "routing" | "other";
  label: string;
  detail: string;
};
type EncScan = {
  routeKey: string;
  scannedAt: string;
  scannedPoints: number;
  eligiblePoints: number;
  findings: EncFinding[];
  error?: string;
};
type TabId = "overview" | "route" | "wx" | "tides" | "hazards" | "reporting" | "events" | "review" | "brief";
type Readiness = "ready" | "attention" | "missing";

type ThemeClasses = {
  panel: string;
  sub: string;
  muted: string;
  control: string;
  input: string;
  accent: string;
};

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const AMI_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const EVENTS_STORAGE_KEY = "navdash-passage-events-v2";
const PLAN_STORAGE_KEY = "navdash-passage-plan-v2";
const WEATHER_STORAGE_KEY = "navdash-passage-weather-v1";
const ENC_STORAGE_KEY = "navdash-passage-enc-scan-v1";

const EVENT_TYPES = ["Position Fixing", "Echo Sounder", "Reporting", "Pilotage", "Speed Change", "Machinery", "Abort Point", "Anchorage", "Note"];
const FIX_METHODS = ["", "GNSS", "Radar", "Visual", "Radar + GNSS", "Visual + Radar", "Independent / Mixed"];
const TABS: Array<{ id: TabId; label: string }> = [
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

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function deltaLon(value: number) { let n = value; while (n > 180) n -= 360; while (n < -180) n += 360; return n; }
function finite(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function distanceNm(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(deltaLon(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearingDeg(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(deltaLon(b.lon - a.lon));
  return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
}
function legKey(a: Waypoint, b: Waypoint) { return `${a.id}::${b.id}`; }
function normalizeRoute(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints: Waypoint[] = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${String(index + 1).padStart(3, "0")}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "NavDash Route"), waypoints } : null;
}
function readRouteLocal() { try { const raw = localStorage.getItem(ROUTE_STORAGE_KEY); return raw ? normalizeRoute(JSON.parse(raw)) : null; } catch { return null; } }
function readAmiLocal() { try { const value = JSON.parse(localStorage.getItem(AMI_STORAGE_KEY) || "null") as AmiRouteForecast | null; return value?.version === 1 && Array.isArray(value.forecastPoints) ? value : null; } catch { return null; } }
function routeKey(route: RouteBrief | null) { return route ? `${route.routeName}|${route.waypoints.map(wp => `${wp.id}:${wp.lat.toFixed(5)},${wp.lon.toFixed(5)}`).join("|")}` : ""; }
function formatDate(date: Date | null) { return date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--"; }
function zoneOffset(point: Waypoint) {
  if (point.lat >= 18 && point.lat <= 23.5 && point.lon >= -161.5 && point.lon <= -154) return -10;
  if (point.lat >= 30 && point.lat <= 46 && point.lon >= 129 && point.lon <= 146) return 9;
  if (point.lat >= 12 && point.lat <= 22 && point.lon >= 143 && point.lon <= 146.5) return 10;
  return Math.max(-12, Math.min(12, Math.round(point.lon / 15)));
}
function zoneLabel(point?: Waypoint) {
  if (!point) return "--";
  const offset = zoneOffset(point);
  if (point.lat >= 18 && point.lat <= 23.5 && point.lon >= -161.5 && point.lon <= -154) return "HST · UTC-10";
  if (point.lat >= 30 && point.lat <= 46 && point.lon >= 129 && point.lon <= 146) return "JST · UTC+9";
  if (point.lat >= 12 && point.lat <= 22 && point.lon >= 143 && point.lon <= 146.5) return "ChST · UTC+10";
  return `Planning zone · UTC${offset >= 0 ? "+" : ""}${offset}`;
}
function inNoaaCoverage(point: Waypoint) {
  return (point.lat >= 17 && point.lat <= 72 && point.lon >= -171 && point.lon <= -65)
    || (point.lat >= 18 && point.lat <= 23 && point.lon >= -161 && point.lon <= -154)
    || (point.lat >= 12 && point.lat <= 22 && point.lon >= 143 && point.lon <= 146.5)
    || (point.lat >= 17 && point.lat <= 20 && point.lon >= -68 && point.lon <= -64);
}
function classifyEnc(result: any) {
  const attrs = result?.attributes || {};
  const text = [result?.layerName, result?.value, attrs.OBJNAM, attrs.NOBJNM, attrs.OBJL, attrs.CATREA, attrs.INFORM].filter(Boolean).join(" · ");
  const lower = text.toLowerCase();
  let kind: EncFinding["kind"] = "other";
  if (/restricted|prohibited|danger|wreck|obstruction|shoal|foul|caution|precaution/.test(lower)) kind = "hazard";
  else if (/pilot|boarding/.test(lower)) kind = "pilot";
  else if (/report|calling|vts|radio/.test(lower)) kind = "reporting";
  else if (/traffic separation|fairway|routeing|routing|tss/.test(lower)) kind = "routing";
  return { kind, label: String(attrs.OBJNAM || attrs.NOBJNM || result?.value || result?.layerName || "ENC object"), detail: text };
}
function triggerText(event: PassageEvent) {
  if (event.triggerType === "nm-before") return `${event.triggerValue} NM BEFORE`;
  if (event.triggerType === "min-before") return `${event.triggerValue} MIN BEFORE`;
  return "AT POINT";
}

function StatusPill({ state, label }: { state: Readiness; label: string }) {
  const classes = state === "ready" ? "border-emerald-500/40 text-emerald-400" : state === "attention" ? "border-amber-500/50 text-amber-300" : "border-slate-500/30 text-slate-500";
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[9px] font-black uppercase tracking-[.1em] ${classes}`}>{state === "ready" ? "●" : state === "attention" ? "◆" : "○"} {label}</span>;
}

function MetricCards({ items, theme }: { items: Array<[string, string | number]>; theme: ThemeClasses }) {
  return <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{items.map(([label, value]) => <div key={label} className={`border p-3 ${theme.sub}`}><div className={`text-[9px] font-black ${theme.muted}`}>{label}</div><div className="mt-1 text-[13px] font-black">{value}</div></div>)}</div>;
}

function Panel({ children, theme, className = "" }: { children: ReactNode; theme: ThemeClasses; className?: string }) {
  return <section className={`border p-4 ${theme.panel} ${className}`}>{children}</section>;
}

export function PassageWorkspaceV3() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const [tab, setTab] = useState<TabId>("overview");
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [ami, setAmi] = useState<AmiRouteForecast | null>(null);
  const [departure, setDeparture] = useState("");
  const [defaultSpeed, setDefaultSpeed] = useState("10");
  const [legs, setLegs] = useState<Record<string, LegPlan>>({});
  const [ukc, setUkc] = useState<UkcSettings>({ draftFt: 0, squatFt: 0, seaAllowanceFt: 0, companyAllowanceFt: 0, minUkcFt: 0 });
  const [events, setEvents] = useState<PassageEvent[]>([]);
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [eventWaypoint, setEventWaypoint] = useState("");
  const [triggerType, setTriggerType] = useState<PassageEvent["triggerType"]>("point");
  const [triggerValue, setTriggerValue] = useState("0");
  const [eventNote, setEventNote] = useState("");
  const [eventSource, setEventSource] = useState("");
  const [tides, setTides] = useState<{ departure: TideResult | null; arrival: TideResult | null; loading: boolean; error: string }>({ departure: null, arrival: null, loading: false, error: "" });
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [enc, setEnc] = useState<EncScan | null>(null);
  const [encLoading, setEncLoading] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const nextRoute = readRouteLocal();
      setRoute(nextRoute);
      setAmi(readAmiLocal());
      try {
        const plan = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || "{}");
        if (typeof plan.departure === "string") setDeparture(plan.departure);
        if (plan.defaultSpeed != null) setDefaultSpeed(String(plan.defaultSpeed));
        if (plan.legs && typeof plan.legs === "object") setLegs(plan.legs as Record<string, LegPlan>);
        if (plan.ukc && typeof plan.ukc === "object") setUkc(current => ({ ...current, ...plan.ukc }));
      } catch {}
      try { const saved = JSON.parse(localStorage.getItem(EVENTS_STORAGE_KEY) || "[]"); setEvents(Array.isArray(saved) ? saved as PassageEvent[] : []); } catch { setEvents([]); }
      try { const saved = JSON.parse(localStorage.getItem(WEATHER_STORAGE_KEY) || "null"); setWeather(saved?.routeKey === routeKey(nextRoute) ? saved.data as RouteWeather : null); } catch { setWeather(null); }
      try { const saved = JSON.parse(localStorage.getItem(ENC_STORAGE_KEY) || "null"); setEnc(saved?.routeKey === routeKey(nextRoute) ? saved as EncScan : null); } catch { setEnc(null); }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("navdash-ami-overlay-updated", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("navdash-ami-overlay-updated", refresh as EventListener);
    };
  }, []);

  useEffect(() => {
    if (route) return;
    fetch("/api/route-state", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const parsed = normalizeRoute(await response.json());
      if (parsed) setRoute(parsed);
    }).catch(() => {});
  }, [route]);

  useEffect(() => {
    if (!eventWaypoint && route?.waypoints[0]) setEventWaypoint(route.waypoints[0].id);
  }, [route, eventWaypoint]);

  useEffect(() => {
    try { localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ departure, defaultSpeed, legs, ukc })); } catch {}
  }, [departure, defaultSpeed, legs, ukc]);

  const legRows = useMemo(() => {
    if (!route) return [];
    return route.waypoints.slice(1).map((to, index) => {
      const from = route.waypoints[index];
      const key = legKey(from, to);
      const plan = legs[key] || {};
      const distance = distanceNm(from, to);
      const speed = finite(plan.speedKt, finite(defaultSpeed, 10));
      return { from, to, key, index, plan, distance, speed, bearing: bearingDeg(from, to), hours: distance / Math.max(0.1, speed) };
    });
  }, [route, legs, defaultSpeed]);

  const origin = route?.waypoints[0];
  const destination = route ? route.waypoints[route.waypoints.length - 1] : undefined;
  const totalDistance = legRows.reduce((sum, leg) => sum + leg.distance, 0);
  const totalHours = legRows.reduce((sum, leg) => sum + leg.hours, 0);
  const departureDate = departure ? new Date(departure) : null;
  const eta = departureDate && Number.isFinite(departureDate.getTime()) ? new Date(departureDate.getTime() + totalHours * 3600000) : null;

  const cumulative = useMemo(() => {
    let hours = 0;
    return legRows.map(leg => {
      const row = { ...leg, startHours: hours };
      hours += leg.hours;
      return row;
    });
  }, [legRows]);

  const clockPlan = useMemo(() => {
    if (!route) return [] as Array<{ wp: Waypoint; from: number; to: number; delta: number; idl: boolean; at: Date | null }>;
    const rows: Array<{ wp: Waypoint; from: number; to: number; delta: number; idl: boolean; at: Date | null }> = [];
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const previous = route.waypoints[index - 1];
      const current = route.waypoints[index];
      const from = zoneOffset(previous);
      const to = zoneOffset(current);
      const idl = Math.abs(current.lon - previous.lon) > 180;
      if (from === to && !idl) continue;
      let delta = to - from;
      if (idl && Math.abs(delta) >= 20) delta = 0;
      const leg = cumulative[index - 1];
      const hours = leg ? leg.startHours + leg.hours : 0;
      rows.push({ wp: current, from, to, delta, idl, at: departureDate && Number.isFinite(departureDate.getTime()) ? new Date(departureDate.getTime() + hours * 3600000) : null });
    }
    return rows;
  }, [route, cumulative, departureDate]);

  const routeIssues = legRows.filter(leg => !Number.isFinite(leg.distance) || leg.distance < 0.01);
  const missingPlanData = legRows.filter(leg => leg.plan.speedKt == null || leg.plan.xtdPortNm == null || leg.plan.xtdStbdNm == null || !leg.plan.fixMethod || !leg.plan.fixIntervalMin);
  const ukcRows = legRows.map(leg => {
    const depth = leg.plan.chartDepthFt;
    const calculated = depth == null ? null : depth + finite(leg.plan.tideFt) - ukc.draftFt - ukc.squatFt - ukc.seaAllowanceFt - ukc.companyAllowanceFt;
    return { ...leg, ukcFt: calculated, meets: calculated == null || ukc.minUkcFt <= 0 ? null : calculated >= ukc.minUkcFt };
  });
  const ukcCalculated = ukcRows.filter(row => row.ukcFt != null);
  const ukcFailures = ukcRows.filter(row => row.meets === false);
  const reportingEvents = events.filter(event => event.type === "Reporting" || event.type === "Pilotage");
  const weatherPoints = weather?.frames?.flatMap(frame => frame.points) ?? [];
  const maxWind = weatherPoints.reduce<number | null>((max, point) => point.windKt != null && (max == null || point.windKt > max) ? point.windKt : max, null);
  const maxWave = weatherPoints.reduce<number | null>((max, point) => point.waveHeightFt != null && (max == null || point.waveHeightFt > max) ? point.waveHeightFt : max, null);
  const amiPoints = ami?.forecastPoints ?? [];
  const amiMaxWind = amiPoints.reduce<any>((max: any, point: any) => !max || point.windSpeedKt > max.windSpeedKt ? point : max, null);
  const amiMaxSea = amiPoints.reduce<any>((max: any, point: any) => !max || point.significantWaveM > max.significantWaveM ? point : max, null);

  function patchLeg(key: string, patch: Partial<LegPlan>) { setLegs(current => ({ ...current, [key]: { ...(current[key] || {}), ...patch } })); }

  async function refreshWeather() {
    if (!route) return;
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const response = await fetch("/api/noaa-route-weather", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ waypoints: route.waypoints }) });
      const json = await response.json() as RouteWeather;
      if (!response.ok || json.error) throw new Error(json.error || `Route weather ${response.status}`);
      setWeather(json);
      localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ routeKey: routeKey(route), data: json }));
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : "Route weather failed.");
    } finally {
      setWeatherLoading(false);
    }
  }

  async function calculateTides() {
    if (!origin || !destination || !departureDate || !eta) {
      setTides(current => ({ ...current, error: "Load route and set departure time first." }));
      return;
    }
    setTides({ departure: null, arrival: null, loading: true, error: "" });
    const one = async (point: Waypoint, at: Date) => {
      const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), at: at.toISOString() });
      const response = await fetch(`/api/nav-brief-tides?${params}`, { cache: "no-store" });
      const json = await response.json() as TideResult;
      if (!response.ok || !json.ok) throw new Error(json.error || `Tide lookup ${response.status}`);
      return json;
    };
    const [departureResult, arrivalResult] = await Promise.allSettled([one(origin, departureDate), one(destination, eta)]);
    const errors = [departureResult, arrivalResult].flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Unavailable"] : []);
    setTides({ departure: departureResult.status === "fulfilled" ? departureResult.value : null, arrival: arrivalResult.status === "fulfilled" ? arrivalResult.value : null, loading: false, error: errors.join(" · ") });
  }

  async function scanEnc() {
    if (!route) return;
    setEncLoading(true);
    const eligible = route.waypoints.filter(inNoaaCoverage);
    const selected = eligible.length <= 12 ? eligible : Array.from({ length: 12 }, (_, index) => eligible[Math.round(index * (eligible.length - 1) / 11)]);
    const findings: EncFinding[] = [];
    let scanned = 0;
    for (const waypoint of selected) {
      try {
        const response = await fetch(`/api/noaa-enc-identify?lat=${waypoint.lat}&lon=${waypoint.lon}&tolerance=12`, { cache: "no-store" });
        if (!response.ok) continue;
        const json = await response.json();
        scanned += 1;
        for (const result of Array.isArray(json?.results) ? json.results : []) {
          const classified = classifyEnc(result);
          if (classified.kind !== "other") findings.push({ waypointId: waypoint.id, waypointName: waypoint.name, ...classified });
        }
      } catch {}
    }
    const next: EncScan = { routeKey: routeKey(route), scannedAt: new Date().toISOString(), scannedPoints: scanned, eligiblePoints: eligible.length, findings, error: eligible.length && !scanned ? "NOAA ENC Online returned no scan results." : undefined };
    setEnc(next);
    try { localStorage.setItem(ENC_STORAGE_KEY, JSON.stringify(next)); } catch {}
    setEncLoading(false);
  }

  function addEvent(event: FormEvent) {
    event.preventDefault();
    if (!route || !eventWaypoint) return;
    const next: PassageEvent = { id: crypto.randomUUID(), type: eventType, waypointId: eventWaypoint, triggerType, triggerValue: Math.max(0, finite(triggerValue)), note: eventNote.trim(), source: eventSource.trim(), createdAt: new Date().toISOString() };
    const updated = [...events, next];
    setEvents(updated);
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(updated));
    setEventNote("");
    setEventSource("");
  }

  function removeEvent(id: string) {
    const updated = events.filter(event => event.id !== id);
    setEvents(updated);
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(updated));
  }

  function eventAt(event: PassageEvent) {
    if (!route || !departureDate) return null;
    const index = route.waypoints.findIndex(waypoint => waypoint.id === event.waypointId);
    if (index < 0) return null;
    let hours = index === 0 ? 0 : (cumulative[index - 1]?.startHours ?? 0) + (cumulative[index - 1]?.hours ?? 0);
    if (event.triggerType === "nm-before") hours -= event.triggerValue / Math.max(0.1, index === 0 ? finite(defaultSpeed, 10) : cumulative[index - 1]?.speed ?? finite(defaultSpeed, 10));
    if (event.triggerType === "min-before") hours -= event.triggerValue / 60;
    return new Date(departureDate.getTime() + Math.max(0, hours) * 3600000);
  }

  const coverage = weather?.sampleCount ? finite(weather.coveredSampleCount) / finite(weather.sampleCount) : 0;
  const readiness: Record<"route" | "wx" | "tides" | "ukc" | "hazards" | "reporting" | "events", Readiness> = {
    route: !route ? "missing" : routeIssues.length || missingPlanData.length ? "attention" : "ready",
    wx: !weather && !ami ? "missing" : weather && coverage < 0.8 ? "attention" : "ready",
    tides: tides.departure || tides.arrival ? tides.departure && tides.arrival ? "ready" : "attention" : "missing",
    ukc: ukc.draftFt <= 0 || ukc.minUkcFt <= 0 || !ukcCalculated.length ? "missing" : ukcFailures.length ? "attention" : "ready",
    hazards: enc ? "attention" : "missing",
    reporting: !reportingEvents.length ? "missing" : reportingEvents.some(event => !event.source) ? "attention" : "ready",
    events: events.length ? "ready" : "missing",
  };

  const shell = day ? "bg-[#eef2f5] text-slate-900" : "bg-[#04080c] text-slate-100";
  const theme: ThemeClasses = {
    panel: day ? "border-slate-300 bg-white" : "border-white/15 bg-[#071019]",
    sub: day ? "border-slate-200 bg-[#f7f9fb]" : "border-white/10 bg-[#0a131c]",
    muted: day ? "text-[#52606d]" : "text-[#8294a5]",
    control: day ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "border-white/15 bg-[#071019] text-slate-100 hover:bg-white/5",
    input: day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#04080c] text-slate-100",
    accent: day ? "text-[#946f00]" : "text-[#c9a227]",
  };
  const field = `mt-1 w-full border px-2 py-1.5 text-[10px] normal-case ${theme.input}`;

  return <main className={`min-h-screen ${shell}`}>
    <style jsx global>{`body:has(.passage-workspace) .navdash-global-nav{display:none!important}.passage-workspace *{border-radius:0!important}.passage-navbrief-embed .navdash-navbrief-console>div>header{display:none!important}.passage-navbrief-embed .navdash-navbrief-console{min-height:0!important;background:transparent!important}.passage-navbrief-embed .navdash-navbrief-console>div{padding:0!important}`}</style>
    <div className="passage-workspace mx-auto min-h-screen w-full max-w-[1900px] px-3 py-3 sm:px-4 lg:px-5">
      <header className={`border ${theme.panel}`}>
        <div className="flex min-h-[66px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div><div className={`text-[10px] font-black uppercase tracking-[.22em] ${theme.accent}`}>M/V MB480 · NAVDASH 1.3</div><div className="mt-1 flex items-baseline gap-3"><h1 className="text-[24px] font-black">PASSAGE</h1><span className={`text-[11px] font-bold uppercase tracking-[.12em] ${theme.muted}`}>Voyage Planning Workspace</span></div></div>
          <div className="flex gap-2"><Link href="/bridge" className={`border px-3 py-2 text-[11px] font-black uppercase ${theme.control}`}>Main</Link><Link href="/route-lab" className={`border px-3 py-2 text-[11px] font-black uppercase ${theme.control}`}>Route Lab</Link><button onClick={toggleTheme} className={`border px-3 py-2 text-[11px] font-black uppercase ${theme.control}`}>{nightMode ? "Day Mode" : "Night Mode"}</button></div>
        </div>
        <div className="flex flex-wrap gap-1 border-t border-white/10 p-2">{TABS.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`h-[34px] border px-3 text-[10px] font-black uppercase ${tab === item.id ? "border-[#c9a227] bg-[#c9a227] text-black" : theme.control}`}>{item.label}</button>)}</div>
      </header>

      {tab !== "brief" && <div className="mt-2 flex flex-wrap gap-2"><StatusPill state={readiness.route} label="Route"/><StatusPill state={readiness.wx} label="WX"/><StatusPill state={readiness.tides} label="Tides"/><StatusPill state={readiness.ukc} label="UKC"/><StatusPill state={readiness.hazards} label="Hazards"/><StatusPill state={readiness.reporting} label="Reporting"/><StatusPill state={readiness.events} label="Events"/></div>}

      {tab === "overview" && <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1.25fr_.75fr]">
        <Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Voyage Overview</div><h2 className="mt-2 text-[22px] font-black">{route?.routeName || "NO ROUTE LOADED"}</h2><MetricCards theme={theme} items={[["ORIGIN", origin?.name || "--"], ["DESTINATION", destination?.name || "--"], ["DISTANCE", route ? `${totalDistance.toFixed(1)} NM` : "--"], ["ETA", formatDate(eta)]]}/><div className="mt-3 grid grid-cols-2 gap-2"><label className={`text-[10px] font-black uppercase ${theme.muted}`}>Departure<input type="datetime-local" value={departure} onChange={e => setDeparture(e.target.value)} className={field}/></label><label className={`text-[10px] font-black uppercase ${theme.muted}`}>Default speed · KT<input type="number" min="1" step=".1" value={defaultSpeed} onChange={e => setDefaultSpeed(e.target.value)} className={field}/></label></div></Panel>
        <Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Clock / IDL Plan</div><div className="mt-2 text-[11px]"><b>{zoneLabel(origin)}</b> → <b>{zoneLabel(destination)}</b></div><div className="mt-3 space-y-1">{clockPlan.length ? clockPlan.map((item, index) => <div key={`${item.wp.id}-${index}`} className={`border p-2 text-[10px] ${theme.sub}`}><b>{item.wp.name}</b> · {item.idl ? "IDL · ADVANCE CALENDAR ONE DAY" : item.delta > 0 ? `ADVANCE ${item.delta} HR` : item.delta < 0 ? `RETARD ${Math.abs(item.delta)} HR` : "NO CLOCK CHANGE"}<div className={theme.muted}>{formatDate(item.at)} · UTC{item.from >= 0 ? "+" : ""}{item.from} → UTC{item.to >= 0 ? "+" : ""}{item.to}</div></div>) : <div className={`border p-2 text-[10px] ${theme.sub}`}>{route ? "No geographic zone transition detected." : "Load route to calculate."}</div>}</div><div className={`mt-2 text-[9px] ${theme.muted}`}>Geographic planning schedule. Bridge team verifies the actual vessel clock-change sequence.</div></Panel>
      </div>}

      {tab === "route" && <Panel theme={theme} className="mt-2">
        <div className="flex items-start justify-between"><div><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Route Analysis</div><h2 className="mt-1 text-[18px] font-black">{route?.routeName || "NO ROUTE"}</h2></div><Link href="/route-lab" className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black">Edit in Route Lab</Link></div>
        {route ? <><MetricCards theme={theme} items={[["WAYPOINTS", route.waypoints.length], ["LEGS", legRows.length], ["DISTANCE", `${totalDistance.toFixed(1)} NM`], ["PLAN DATA", `${legRows.length - missingPlanData.length}/${legRows.length} COMPLETE`]]}/><div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-[9px]"><thead><tr className={theme.sub}>{["LEG","FROM → TO","CRS","DIST","SPD","XTD P","XTD S","FIX METHOD","FIX MIN"].map(header => <th key={header} className="border border-white/10 px-2 py-2 text-left">{header}</th>)}</tr></thead><tbody>{legRows.map(leg => <tr key={leg.key}><td className="border border-white/10 px-2">{leg.index + 1}</td><td className="border border-white/10 px-2">{leg.from.name} → {leg.to.name}</td><td className="border border-white/10 px-2">{Math.round(leg.bearing).toString().padStart(3,"0")}°</td><td className="border border-white/10 px-2">{leg.distance.toFixed(1)}</td><td className="border border-white/10 p-1"><input type="number" min=".1" step=".1" value={leg.plan.speedKt ?? ""} placeholder={defaultSpeed} onChange={e => patchLeg(leg.key, { speedKt: e.target.value ? finite(e.target.value) : undefined })} className={field}/></td><td className="border border-white/10 p-1"><input type="number" min="0" step=".01" value={leg.plan.xtdPortNm ?? ""} onChange={e => patchLeg(leg.key, { xtdPortNm: e.target.value === "" ? undefined : finite(e.target.value) })} className={field}/></td><td className="border border-white/10 p-1"><input type="number" min="0" step=".01" value={leg.plan.xtdStbdNm ?? ""} onChange={e => patchLeg(leg.key, { xtdStbdNm: e.target.value === "" ? undefined : finite(e.target.value) })} className={field}/></td><td className="border border-white/10 p-1"><select value={leg.plan.fixMethod || ""} onChange={e => patchLeg(leg.key, { fixMethod: e.target.value || undefined })} className={field}>{FIX_METHODS.map(method => <option key={method} value={method}>{method || "Select"}</option>)}</select></td><td className="border border-white/10 p-1"><input type="number" min="1" value={leg.plan.fixIntervalMin ?? ""} onChange={e => patchLeg(leg.key, { fixIntervalMin: e.target.value ? finite(e.target.value) : undefined })} className={field}/></td></tr>)}</tbody></table></div>{(routeIssues.length > 0 || missingPlanData.length > 0) && <div className="mt-3 border border-amber-500/50 bg-amber-950/20 p-3 text-[10px] text-amber-200">{routeIssues.length > 0 && <div>◆ {routeIssues.length} invalid or duplicate leg(s).</div>}{missingPlanData.length > 0 && <div>◆ {missingPlanData.length} leg(s) still need explicit speed, XTD, fixing method, or fixing interval.</div>}</div>}</> : <div className={`mt-3 border p-3 text-[10px] ${theme.sub}`}>Load a route on the bridge or Route Lab first.</div>}
      </Panel>}

      {tab === "wx" && <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
        <Panel theme={theme}><div className="flex justify-between"><div><div className={`text-[9px] font-black uppercase ${theme.accent}`}>NOAA Route Weather</div><h2 className="text-[18px] font-black">Live Route Sampling</h2></div><button disabled={!route || weatherLoading} onClick={() => void refreshWeather()} className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black disabled:opacity-40">{weatherLoading ? "Loading..." : "Refresh NOAA"}</button></div>{weatherError && <div className="mt-2 text-[10px] text-red-300">{weatherError}</div>}{weather ? <><MetricCards theme={theme} items={[["COVERAGE", `${weather.coveredSampleCount || 0}/${weather.sampleCount || 0}`], ["MODEL", weather.modelRun || "CURRENT"], ["MAX WIND", maxWind == null ? "--" : `${maxWind.toFixed(0)} KT`], ["MAX WAVE", maxWave == null ? "--" : `${maxWave.toFixed(1)} FT`]]}/><div className={`mt-2 border p-3 text-[10px] ${theme.sub}`}><b>{weather.provider}</b> · {weather.product}<br/><span className={theme.muted}>{weather.note}</span></div></> : <div className={`mt-3 border p-3 text-[10px] ${theme.sub}`}>Refresh to run the existing NOAA/NCEP GFS + NWS route sampler against the current route.</div>}</Panel>
        <Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>AMI Route Forecast</div>{ami ? <><MetricCards theme={theme} items={[["POINTS", amiPoints.length], ["MAX WIND", amiMaxWind ? `${amiMaxWind.windSpeedKt} KT` : "--"], ["MAX SEAS", amiMaxSea ? `${amiMaxSea.significantWaveM.toFixed(1)} M` : "--"], ["SOURCE", ami.sourceName]]}/>{ami.warnings && <div className="mt-2 border border-amber-500/50 bg-amber-950/20 p-3 text-[10px] text-amber-200">{ami.warnings}</div>}</> : <div className={`mt-3 border p-3 text-[10px] ${theme.sub}`}>No AMI forecast loaded.</div>}<a href="https://wx.wardlab.dev" className="mt-3 inline-flex border border-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-[#c9a227]">Open Weather</a></Panel>
      </div>}

      {tab === "tides" && <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[.8fr_1.2fr]">
        <Panel theme={theme}><div className="flex justify-between"><div><div className={`text-[9px] font-black uppercase ${theme.accent}`}>NOAA Tides</div><h2 className="text-[18px] font-black">Endpoint Conditions</h2></div><button onClick={() => void calculateTides()} disabled={tides.loading} className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black">{tides.loading ? "Loading..." : "Calculate"}</button></div>{tides.error && <div className="mt-2 text-[10px] text-amber-300">{tides.error}</div>}{[["DEPARTURE", tides.departure], ["ARRIVAL", tides.arrival]].map(([label, raw]) => { const value = raw as TideResult | null; return <div key={String(label)} className={`mt-2 border p-3 text-[10px] ${theme.sub}`}><b>{String(label)}</b>{value?.station ? <><div>{value.station.name} · NOAA {value.station.id}</div>{(value.events || []).slice(0,4).map((event,index) => <div key={`${event.time}-${index}`} className={theme.muted}>{event.type === "H" ? "HIGH" : "LOW"} · {formatDate(new Date(event.time))} · {event.valueFt.toFixed(1)} FT</div>)}</> : <div className={theme.muted}>No NOAA station result.</div>}</div>; })}</Panel>
        <Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Dynamic UKC</div><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">{([['Draft ft','draftFt'],['Squat ft','squatFt'],['Sea allowance ft','seaAllowanceFt'],['Company allowance ft','companyAllowanceFt'],['Minimum UKC ft','minUkcFt']] as Array<[string,keyof UkcSettings]>).map(([label,key]) => <label key={key} className={`text-[9px] font-black uppercase ${theme.muted}`}>{label}<input type="number" min="0" step=".1" value={ukc[key]} onChange={e => setUkc(current => ({ ...current, [key]: finite(e.target.value) }))} className={field}/></label>)}</div><div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-[9px]"><thead><tr className={theme.sub}>{["LEG","CHART DEPTH FT","TIDE FT","CALC UKC FT","MIN CHECK"].map(header => <th key={header} className="border border-white/10 px-2 py-2 text-left">{header}</th>)}</tr></thead><tbody>{ukcRows.map(row => <tr key={row.key}><td className="border border-white/10 px-2">{row.index+1} · {row.from.name} → {row.to.name}</td><td className="border border-white/10 p-1"><input type="number" min="0" step=".1" value={row.plan.chartDepthFt ?? ""} onChange={e => patchLeg(row.key,{chartDepthFt:e.target.value === "" ? undefined : finite(e.target.value)})} className={field}/></td><td className="border border-white/10 p-1"><input type="number" step=".1" value={row.plan.tideFt ?? ""} onChange={e => patchLeg(row.key,{tideFt:e.target.value === "" ? undefined : finite(e.target.value)})} className={field}/></td><td className="border border-white/10 px-2">{row.ukcFt == null ? "--" : row.ukcFt.toFixed(1)}</td><td className={`border border-white/10 px-2 ${row.meets === false ? "text-red-300" : row.meets === true ? "text-emerald-400" : theme.muted}`}>{row.meets == null ? "--" : row.meets ? "PASS" : "BELOW MIN"}</td></tr>)}</tbody></table></div><div className={`mt-2 text-[9px] ${theme.muted}`}>Charted depth + tide − draft − squat − sea-state allowance − company allowance. NavDash does not invent any input.</div></Panel>
      </div>}

      {tab === "hazards" && <Panel theme={theme} className="mt-2"><div className="flex justify-between"><div><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Hazard Reconnaissance</div><h2 className="text-[18px] font-black">NOAA ENC · U.S. Coverage Only</h2></div><button disabled={!route || encLoading} onClick={() => void scanEnc()} className="border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black disabled:opacity-40">{encLoading ? "Scanning..." : "Scan NOAA ENC"}</button></div><div className={`mt-2 text-[10px] ${theme.muted}`}>Evidence gathering only. Non-U.S. waters remain unverified and this does not replace the ECDIS route check.</div>{enc && <MetricCards theme={theme} items={[["SCANNED", enc.scannedPoints], ["NOAA WPTS", enc.eligiblePoints], ["FINDINGS", enc.findings.length], ["STATUS", "PARTIAL / REVIEW"]]}/>} {enc?.findings.map((finding,index) => <div key={`${finding.waypointId}-${index}`} className={`mt-2 border p-2 text-[10px] ${theme.sub}`}><b>{finding.kind.toUpperCase()} · {finding.waypointName}</b> · {finding.label}<div className={theme.muted}>{finding.detail}</div></div>)}</Panel>}

      {tab === "reporting" && <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2"><Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Reporting / Pilotage Plan</div>{reportingEvents.length ? reportingEvents.map(event => { const waypoint = route?.waypoints.find(item => item.id === event.waypointId); return <div key={event.id} className={`mt-2 border p-3 text-[10px] ${theme.sub}`}><b>{event.type} · {waypoint?.name || event.waypointId}</b><div>{triggerText(event)} · {formatDate(eventAt(event))}</div>{event.note && <div className={theme.muted}>{event.note}</div>}<div className={event.source ? "text-emerald-400" : "text-amber-300"}>{event.source ? `SOURCE · ${event.source}` : "SOURCE REQUIRED BEFORE READY"}</div></div>; }) : <div className={`mt-3 border p-3 text-[10px] ${theme.sub}`}>No reporting/pilotage events configured.</div>}</Panel><Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>ENC Suggestions</div>{enc?.findings.filter(finding => ["pilot","reporting","routing"].includes(finding.kind)).map((finding,index) => <div key={index} className={`mt-2 border p-2 text-[10px] ${theme.sub}`}><b>{finding.kind.toUpperCase()} · {finding.label}</b><div>{finding.waypointName}</div></div>)}<div className={`mt-2 text-[10px] ${theme.muted}`}>VHF channels and local instructions are never inferred. Enter them only from an authoritative source.</div><button onClick={() => setTab("events")} className={`mt-3 border px-3 py-2 text-[10px] font-black uppercase ${theme.control}`}>Add Event</button></Panel></div>}

      {tab === "events" && <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[.7fr_1.3fr]"><form onSubmit={addEvent} className={`border p-4 ${theme.panel}`}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Add Route Event</div><label className={`mt-2 block text-[9px] font-black uppercase ${theme.muted}`}>Type<select value={eventType} onChange={e => setEventType(e.target.value)} className={field}>{EVENT_TYPES.map(type => <option key={type}>{type}</option>)}</select></label><label className={`mt-2 block text-[9px] font-black uppercase ${theme.muted}`}>Waypoint<select value={eventWaypoint} onChange={e => setEventWaypoint(e.target.value)} className={field}>{route?.waypoints.map((waypoint,index) => <option key={waypoint.id} value={waypoint.id}>{index+1}. {waypoint.name}</option>)}</select></label><div className="mt-2 grid grid-cols-2 gap-2"><label className={`block text-[9px] font-black uppercase ${theme.muted}`}>Trigger<select value={triggerType} onChange={e => setTriggerType(e.target.value as PassageEvent["triggerType"])} className={field}><option value="point">At point</option><option value="nm-before">NM before</option><option value="min-before">Minutes before</option></select></label><label className={`block text-[9px] font-black uppercase ${theme.muted}`}>Value<input type="number" min="0" step=".1" disabled={triggerType === "point"} value={triggerValue} onChange={e => setTriggerValue(e.target.value)} className={field}/></label></div><label className={`mt-2 block text-[9px] font-black uppercase ${theme.muted}`}>Action / note<textarea value={eventNote} onChange={e => setEventNote(e.target.value)} className={`${field} min-h-20`}/></label><label className={`mt-2 block text-[9px] font-black uppercase ${theme.muted}`}>Source / reference<input value={eventSource} onChange={e => setEventSource(e.target.value)} placeholder="Coast Pilot, port guide, VTS instruction, vessel procedure..." className={field}/></label><button disabled={!route} className="mt-3 w-full border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black disabled:opacity-40">Add Event</button></form><Panel theme={theme}><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Bridge Event Timeline</div>{events.length ? events.map(event => { const waypoint = route?.waypoints.find(item => item.id === event.waypointId); return <div key={event.id} className={`mt-2 border p-3 ${theme.sub}`}><div className="flex justify-between gap-2"><div><b>{event.type} · {waypoint?.name || event.waypointId}</b><div>{triggerText(event)} · {formatDate(eventAt(event))}</div>{event.note && <div className={theme.muted}>{event.note}</div>}{event.source && <div className="text-emerald-400">SOURCE · {event.source}</div>}</div><button onClick={() => removeEvent(event.id)} className="border border-red-500/40 px-2 py-1 text-[9px] text-red-300">Remove</button></div></div>; }) : <div className={`mt-3 border p-3 text-[10px] ${theme.sub}`}>No bridge events configured.</div>}</Panel></div>}

      {tab === "review" && <Panel theme={theme} className="mt-2"><div className={`text-[9px] font-black uppercase ${theme.accent}`}>Passage Review</div><h2 className="mt-1 text-[18px] font-black">Evidence-Backed Readiness</h2><div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">{([
        [readiness.route,"Route",!route?"No route loaded.":routeIssues.length?`${routeIssues.length} geometry issue(s).`:missingPlanData.length?`${missingPlanData.length} leg(s) incomplete.`:"Route plan data complete."],
        [readiness.wx,"Weather",weather?`NOAA ${weather.coveredSampleCount || 0}/${weather.sampleCount || 0} samples${ami?" + AMI":""}.`:ami?"AMI loaded; NOAA not refreshed.":"No route-weather evidence."],
        [readiness.tides,"Tides",tides.departure&&tides.arrival?"Both NOAA endpoint lookups complete.":tides.departure||tides.arrival?"One endpoint has NOAA coverage.":"No lookup completed."],
        [readiness.ukc,"UKC",ukcFailures.length?`${ukcFailures.length} leg(s) below minimum.`:`${ukcCalculated.length} calculated leg(s).`],
        [readiness.hazards,"Hazards",enc?`NOAA ENC reconnaissance at ${enc.scannedPoints} point(s); global review still requires ECDIS/publications.`:"No ENC reconnaissance."],
        [readiness.reporting,"Reporting",reportingEvents.some(event=>!event.source)?"One or more events lack a source/reference.":`${reportingEvents.length} sourced event(s).`],
        [readiness.events,"Bridge Events",`${events.length} event(s) scheduled.`],
        ["attention" as Readiness,"Human Verification","ECDIS transfer/check, publications, stability, regulatory submissions, cargo/vessel readiness, and Master approval remain human actions."],
      ] as Array<[Readiness,string,string]>).map(([state,label,detail]) => <div key={label} className={`border p-3 ${theme.sub}`}><StatusPill state={state} label={label}/><div className={`mt-2 text-[10px] ${theme.muted}`}>{detail}</div></div>)}</div><button onClick={() => setTab("brief")} className="mt-4 border border-[#c9a227] bg-[#c9a227] px-4 py-2 text-[10px] font-black uppercase text-black">Open Nav Brief</button></Panel>}

      {tab === "brief" && <section className="passage-navbrief-embed mt-2"><NavBriefBuilderPage/></section>}
    </div>
  </main>;
}
