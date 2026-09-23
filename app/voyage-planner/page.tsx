"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CrewNoaaMap } from "../../components/CrewNoaaMap";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type PlanningRoute = { routeName: string; waypoints: Waypoint[] };
type LegPlan = { speed: number; holdHours: number };
type TimedTarget = { id: string; waypointIndex: number; arrival: string };

type SolveResult = {
  holdLegIndex: number;
  resumeTime: Date;
  remainingDistance: number;
  availableHours: number;
  requiredSpeed: number | null;
  status: "ready" | "impossible" | "none";
};

function toRad(value: number) { return value * Math.PI / 180; }
function lonDelta(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }
function distanceNm(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLat = toRad(b.lat - a.lat), dLon = toRad(lonDelta(b.lon - a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function crossesInternationalDateLine(a: Waypoint, b: Waypoint) {
  return Math.abs(b.lon - a.lon) > 180;
}

function bearingDeg(a: Waypoint, b: Waypoint) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(lonDelta(b.lon - a.lon));
  const deg = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180 / Math.PI;
  return (deg + 360) % 360;
}
function getAttr(node: Element | null, names: string[]) {
  if (!node) return null;
  for (const name of names) { const value = node.getAttribute(name); if (value) return value; }
  return null;
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
  return (isLat && Math.abs(value) > 90) || (!isLat && Math.abs(value) > 180) ? NaN : value;
}
function waypointName(node: Element, fallback: string) {
  return getAttr(node, ["name", "Name", "waypointName", "WaypointName", "id", "ID"]) || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim() || fallback;
}
function parseRtz(xmlText: string): PlanningRoute {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeInfo = doc.querySelector("routeInfo,RouteInfo");
  const routeName = getAttr(routeInfo, ["routeName", "RouteName", "name", "Name"]) || getAttr(routeNode, ["routeName", "RouteName", "name", "Name", "id", "ID"]) || routeNode.querySelector("routeName,name")?.textContent?.trim() || "Planning Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    return { id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${String(index + 1).padStart(3, "0")}`, name: waypointName(node, `Waypoint ${index + 1}`), lat, lon };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}
function unwrapRouteForMap(route: PlanningRoute): PlanningRoute {
  if (route.waypoints.length < 2) return route;
  const waypoints = route.waypoints.map((wp, index) => {
    if (index === 0) return { ...wp };
    const previousLon = index === 1 ? route.waypoints[0].lon : 0;
    return { ...wp, lon: previousLon };
  });
  for (let index = 1; index < waypoints.length; index += 1) {
    let lon = route.waypoints[index].lon;
    const previousLon = waypoints[index - 1].lon;
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    waypoints[index].lon = lon;
  }
  return { ...route, waypoints };
}

function normalizeSharedRoute(data: any): PlanningRoute | null {
  if (!data || data?.hasRoute === false || !Array.isArray(data?.waypoints)) return null;
  const waypoints = data.waypoints
    .map((wp: any, index: number) => ({
      id: typeof wp?.id === "string" && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, "0")}`,
      name: typeof wp?.name === "string" && wp.name.trim() ? wp.name.trim() : `Waypoint ${index + 1}`,
      lat: Number(wp?.lat ?? wp?.latitude),
      lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
    }))
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) return null;
  return {
    routeName: typeof data?.routeName === "string" && data.routeName.trim() ? data.routeName.trim() : "Loaded RTZ Route",
    waypoints,
  };
}

function decimalHours(value: string) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function safeSpeed(value: string, fallback = 10) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function durationText(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return "--";
  const totalMinutes = Math.round(hours * 60), h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function waypointTimeZone(wp: Pick<Waypoint, "lat" | "lon"> | null | undefined) {
  if (!wp) return { offset: 0, label: "UTC" };
  if (wp.lat >= 18 && wp.lat <= 23.5 && wp.lon >= -161 && wp.lon <= -154) return { offset: -10, label: "HST" };
  if (wp.lat >= 24 && wp.lat <= 46 && wp.lon >= 122 && wp.lon <= 146) return { offset: 9, label: "JST" };
  const offset = Math.max(-12, Math.min(14, Math.round(wp.lon / 15)));
  return { offset, label: offset === 0 ? "UTC" : `UTC${offset > 0 ? "+" : ""}${offset}` };
}
function parseWaypointLocal(value: string, wp: Pick<Waypoint, "lat" | "lon"> | null | undefined) {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const tz = waypointTimeZone(wp);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - tz.offset, Number(m[5]));
  return new Date(utc);
}
function dateTimeAtWaypoint(date: Date | null, wp: Pick<Waypoint, "lat" | "lon"> | null | undefined) {
  if (!date || !Number.isFinite(date.getTime())) return "--";
  const tz = waypointTimeZone(wp);
  const shifted = new Date(date.getTime() + tz.offset * 3600000);
  const text = shifted.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${text} ${tz.label}`;
}
function dateTimeText(date: Date | null) { return !date || !Number.isFinite(date.getTime()) ? "--" : date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function waypointLocalInputValue(date: Date, wp: Pick<Waypoint, "lat" | "lon"> | null | undefined) {
  const tz = waypointTimeZone(wp);
  return localInputValue(new Date(date.getTime() + tz.offset * 3600000));
}

export default function VoyagePlannerPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const [route, setRoute] = useState<PlanningRoute | null>(null);
  const [defaultSpeed, setDefaultSpeed] = useState("10");
  const [departure, setDeparture] = useState("");
  const [targetArrival, setTargetArrival] = useState("");
  const [targetWaypointIndex, setTargetWaypointIndex] = useState<number | null>(null);
  const [plans, setPlans] = useState<LegPlan[]>([]);
  const [planningLimit, setPlanningLimit] = useState("14");
  const [additionalTargets, setAdditionalTargets] = useState<TimedTarget[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadSharedRoute() {
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const parsed = normalizeSharedRoute(await response.json());
        if (!parsed || cancelled) return;
        const speed = safeSpeed(defaultSpeed);
        setRoute(parsed);
        setDeparture((current) => {
          if (current) return current;
          const now = new Date();
          now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
          return waypointLocalInputValue(now, parsed.waypoints[0]);
        });
        setPlans(parsed.waypoints.slice(1).map(() => ({ speed, holdHours: 0 })));
        setTargetWaypointIndex(parsed.waypoints.length - 1);
        setAdditionalTargets([]);
        setError("");
      } catch {}
    }
    void loadSharedRoute();
    return () => { cancelled = true; };
  }, []);

  const resolvedTargetWaypointIndex = route ? (targetWaypointIndex ?? route.waypoints.length - 1) : null;

  const rawLegs = useMemo(() => {
    if (!route) return [];
    return route.waypoints.slice(1).map((to, index) => {
      const from = route.waypoints[index], distance = distanceNm(from, to);
      const speed = plans[index]?.speed || safeSpeed(defaultSpeed), holdHours = plans[index]?.holdHours || 0;
      return { index, from, to, distance, bearing: bearingDeg(from, to), speed, holdHours };
    });
  }, [route, plans, defaultSpeed]);

  const timedTargets = useMemo(() => {
    if (!route || resolvedTargetWaypointIndex === null) return [];
    const items: TimedTarget[] = [
      { id: "primary", waypointIndex: resolvedTargetWaypointIndex, arrival: targetArrival },
      ...additionalTargets,
    ];
    return items
      .filter((item) => item.waypointIndex > 0 && item.waypointIndex < route.waypoints.length && item.arrival)
      .sort((a, b) => a.waypointIndex - b.waypointIndex);
  }, [route, resolvedTargetWaypointIndex, targetArrival, additionalTargets]);

  const timingPlan = useMemo(() => {
    const start = departure ? parseWaypointLocal(departure, route?.waypoints[0]) : null;
    if (!route || !start || !Number.isFinite(start.getTime())) return { timeline: [] as any[], blocks: [] as any[], error: "" };

    const targetsByIndex = new Map<number, TimedTarget>();
    for (const item of timedTargets) {
      if (targetsByIndex.has(item.waypointIndex)) return { timeline: [] as any[], blocks: [] as any[], error: "Each timed waypoint must be unique." };
      targetsByIndex.set(item.waypointIndex, item);
    }

    let previousIndex = 0;
    let previousTime = new Date(start);
    const blocks: any[] = [];
    for (const item of timedTargets) {
      const targetTime = parseWaypointLocal(item.arrival, route.waypoints[item.waypointIndex]);
      if (!targetTime || !Number.isFinite(targetTime.getTime()) || item.waypointIndex <= previousIndex) continue;
      const legs = rawLegs.slice(previousIndex, item.waypointIndex);
      const distance = legs.reduce((sum, leg) => sum + leg.distance, 0);
      const holdHours = rawLegs
        .slice(previousIndex === 0 ? 0 : previousIndex - 1, Math.max(previousIndex === 0 ? 0 : previousIndex - 1, item.waypointIndex - 1))
        .reduce((sum, leg) => sum + leg.holdHours, 0);
      const availableHours = (targetTime.getTime() - previousTime.getTime()) / 3600000 - holdHours;
      const requiredSpeed = distance > 0 && availableHours > 0 ? distance / availableHours : null;
      blocks.push({ fromIndex: previousIndex, toIndex: item.waypointIndex, targetTime, distance, holdHours, availableHours, requiredSpeed });
      previousIndex = item.waypointIndex;
      previousTime = targetTime;
    }

    let cursor = new Date(start);
    const timeline = rawLegs.map((leg) => {
      const block = blocks.find((b) => leg.index >= b.fromIndex && leg.index < b.toIndex);
      const effectiveSpeed = block?.requiredSpeed ?? leg.speed;
      const underwayHours = leg.distance / effectiveSpeed;
      const depart = new Date(cursor);
      const arrive = new Date(depart.getTime() + underwayHours * 3600000);
      const resume = new Date(arrive.getTime() + leg.holdHours * 3600000);
      cursor = resume;
      return { ...leg, speed: effectiveSpeed, underwayHours, depart, arrive, resume, solvedSpeed: block?.requiredSpeed ?? null };
    });
    const impossible = blocks.find((b) => b.requiredSpeed === null);
    return { timeline, blocks, error: impossible ? "A timed waypoint cannot be reached in the available time." : "" };
  }, [route, departure, rawLegs, timedTargets]);

  const timeline = timingPlan.timeline;
  const totalDistance = rawLegs.reduce((sum, leg) => sum + leg.distance, 0);
  const totalUnderway = timeline.reduce((sum, leg) => sum + leg.underwayHours, 0);
  const totalHold = rawLegs.reduce((sum, leg) => sum + leg.holdHours, 0);
  const finalArrival = timeline.length ? timeline[timeline.length - 1].arrive : null;
  const targetWaypoint = route && resolvedTargetWaypointIndex !== null ? route.waypoints[resolvedTargetWaypointIndex] : null;
  const targetWaypointArrival = resolvedTargetWaypointIndex !== null && resolvedTargetWaypointIndex > 0 ? timeline[resolvedTargetWaypointIndex - 1]?.arrive || null : departure ? new Date(departure) : null;
  const target = targetArrival && targetWaypoint ? parseWaypointLocal(targetArrival, targetWaypoint) : null;
  const targetDeltaHours = targetWaypointArrival && target && Number.isFinite(target.getTime()) ? (targetWaypointArrival.getTime() - target.getTime()) / 3600000 : null;
  const limit = safeSpeed(planningLimit, 14);
  const exceedsLimit = timingPlan.blocks.some((block) => block.requiredSpeed !== null && block.requiredSpeed > limit);

  async function loadRoute(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseRtz(await file.text()), speed = safeSpeed(defaultSpeed);
      setRoute(parsed);
      setPlans(parsed.waypoints.slice(1).map(() => ({ speed, holdHours: 0 })));
      setTargetWaypointIndex(parsed.waypoints.length - 1);
      setAdditionalTargets([]);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load route."); }
  }

  function applyDefaultSpeed() {
    const speed = safeSpeed(defaultSpeed);
    setDefaultSpeed(String(speed));
    setPlans((current) => current.map((plan) => ({ ...plan, speed })));
  }
  function updatePlan(index: number, patch: Partial<LegPlan>) { setPlans((current) => current.map((plan, i) => i === index ? { ...plan, ...patch } : plan)); }
  function clearPlanner() { setRoute(null); setPlans([]); setTargetArrival(""); setTargetWaypointIndex(null); setAdditionalTargets([]); setError(""); }
  function addTimedWaypoint() {
    if (!route) return;
    const used = new Set([resolvedTargetWaypointIndex, ...additionalTargets.map((item) => item.waypointIndex)]);
    const waypointIndex = route.waypoints.findIndex((_wp, index) => index > 0 && !used.has(index));
    if (waypointIndex < 1) return;
    setAdditionalTargets((current) => [...current, { id: `timed-${Date.now()}`, waypointIndex, arrival: "" }]);
  }
  function updateTimedWaypoint(id: string, patch: Partial<TimedTarget>) {
    setAdditionalTargets((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function removeTimedWaypoint(id: string) { setAdditionalTargets((current) => current.filter((item) => item.id !== id)); }

  const panel = day ? "border-slate-300 bg-white" : "border-white/15 bg-[#071019]";
  const inset = day ? "border-slate-200 bg-[#f5f7f9]" : "border-white/10 bg-[#04080c]";
  const control = day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#0b141d] text-slate-100";
  const muted = day ? "text-slate-500" : "text-slate-400";
  const mapDisplayRoute = route ? unwrapRouteForMap(route) : null;
  const mapRoute = mapDisplayRoute ? { routeName: mapDisplayRoute.routeName, waypoints: mapDisplayRoute.waypoints, activeWaypointIndex: Math.max(1, resolvedTargetWaypointIndex ?? 1) } : null;

  return (
    <main className={day ? "min-h-screen bg-[#eef2f5] text-slate-900" : "min-h-screen bg-[#04080c] text-slate-100"}>
      <div className="mx-auto max-w-[1900px] p-2 sm:p-3">
        <header className={`border p-3 ${panel}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-[10px] font-black uppercase tracking-[.18em] text-[#c9a227]">M/V MB480 · NAVDASH 1.3</div><h1 className="mt-1 text-xl font-black uppercase tracking-[.08em] sm:text-2xl">Voyage Timing Planner</h1><div className={`mt-1 text-[10px] font-bold uppercase tracking-[.12em] ${muted}`}>Active shared route · RTZ override available</div></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { window.location.href = "/bridge"; }} className={`border px-3 py-2 text-[10px] font-black uppercase ${control}`}>Main</button><label className="cursor-pointer border border-[#c9a227]/70 bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black">Load RTZ<input type="file" accept=".rtz,.xml" onChange={loadRoute} className="hidden" /></label><button type="button" onClick={clearPlanner} disabled={!route} className={`border px-3 py-2 text-[10px] font-black uppercase ${route ? "border-red-400/50 text-red-400" : "border-slate-500/20 text-slate-500"}`}>Clear</button><button type="button" onClick={toggleTheme} className={`border px-3 py-2 text-[10px] font-black uppercase ${control}`}>{nightMode ? "Day" : "Night"}</button></div>
          </div>
        </header>

        {error && <div className="mt-2 border border-red-500/50 bg-red-500/10 p-3 text-sm font-bold text-red-400">{error}</div>}

        <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1.55fr)_430px]">
          <section className={`overflow-hidden border ${panel}`}>
            <div className="flex items-center justify-between border-b border-current/10 px-3 py-2"><div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>NOAA ENC · Planning Route</div><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>{route?.routeName || "No planning route loaded"}</div></div>
            <div className="h-[470px] xl:h-[570px]"><CrewNoaaMap route={mapRoute} ship={null} nightMode={nightMode} /></div>
          </section>

          <section className={`border p-3 ${panel}`}>
            <div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>Timing Controls</div>
            <div className="mt-3 grid gap-3">
              <label className="block"><span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Departure · {waypointTimeZone(route?.waypoints[0]).label}</span><input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} className={`w-full border px-3 py-2 text-base font-mono ${control}`} /></label>
              <div className={`border-2 border-[#c9a227] p-3 ${day ? "bg-amber-50" : "bg-[#c9a227]/10"}`}><div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-[#c9a227]">Arrival Target Waypoint</div><select disabled={!route} value={resolvedTargetWaypointIndex ?? ""} onChange={(e) => setTargetWaypointIndex(Number(e.target.value))} className={`w-full border-2 border-[#c9a227] px-3 py-3 text-base font-mono font-black ${control}`}>{route ? route.waypoints.map((wp, index) => <option key={`${wp.id}-${index}`} value={index}>{index + 1} · {wp.name}</option>) : <option value="">Load route first</option>}</select></div>
              <div><div className="mb-1 flex items-center justify-between gap-2"><span className="block text-[9px] font-black uppercase tracking-[.12em] text-[#c9a227]">Target Arrival At Selected Waypoint · {waypointTimeZone(targetWaypoint).label}</span><button type="button" onClick={() => setTargetArrival("")} disabled={!targetArrival} className={`shrink-0 border px-2 py-1 text-[9px] font-black uppercase ${targetArrival ? "border-red-400/50 text-red-400" : "border-slate-500/20 text-slate-500"}`}>Clear</button></div><input type="datetime-local" value={targetArrival} onChange={(e) => setTargetArrival(e.target.value)} className={`w-full border-2 border-[#c9a227] px-3 py-3 text-base font-mono font-black ${control}`} /></div>
              <div className="grid grid-cols-[1fr_110px] gap-2"><div><span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Default Speed</span><input type="number" min="0.1" step="0.1" value={defaultSpeed} onChange={(e) => setDefaultSpeed(e.target.value)} className={`w-full border px-3 py-2 text-base font-mono ${control}`} /></div><div><span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Speed Limit</span><input type="number" min="0.1" step="0.1" value={planningLimit} onChange={(e) => setPlanningLimit(e.target.value)} className={`w-full border px-3 py-2 text-base font-mono ${control}`} /></div></div>
              <button type="button" onClick={applyDefaultSpeed} disabled={!route} className="border border-[#c9a227]/70 px-3 py-2 text-[10px] font-black uppercase text-[#c9a227]">Apply Default Speed To All Legs</button>
            </div>

            <div className="mt-3 border-t border-current/10 pt-3">
              <div className="flex items-center justify-between gap-2"><div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>Additional Timed Waypoints</div><button type="button" onClick={addTimedWaypoint} disabled={!route} className="border border-[#c9a227]/70 px-3 py-2 text-[10px] font-black uppercase text-[#c9a227]">+ Add Timed WP</button></div>
              <div className="mt-2 grid gap-2">{additionalTargets.map((item) => <div key={item.id} className={`grid min-w-0 gap-2 border p-2 ${inset}`}><select value={item.waypointIndex} onChange={(e) => updateTimedWaypoint(item.id, { waypointIndex: Number(e.target.value) })} className={`min-w-0 w-full border px-2 py-2 font-mono text-sm ${control}`}>{route?.waypoints.map((wp, index) => index > 0 ? <option key={`${wp.id}-timed`} value={index}>{index + 1} · {wp.name}</option> : null)}</select><input aria-label="Timed waypoint arrival" title={`Local time · ${waypointTimeZone(route?.waypoints[item.waypointIndex]).label}`} type="datetime-local" value={item.arrival} onChange={(e) => updateTimedWaypoint(item.id, { arrival: e.target.value })} className={`min-w-0 w-full border px-2 py-2 font-mono text-sm ${control}`} /><button type="button" onClick={() => removeTimedWaypoint(item.id)} className="w-full border border-red-400/50 px-3 py-2 text-[10px] font-black uppercase text-red-400">Remove</button></div>)}</div>
            </div>

            {timingPlan.blocks.length > 0 && (
              <div className={`mt-4 border-2 p-4 ${timingPlan.error || exceedsLimit ? "border-red-500 bg-red-500/10" : "border-emerald-500 bg-emerald-500/10"}`}>
                <div className={`text-[10px] font-black uppercase tracking-[.14em] ${timingPlan.error || exceedsLimit ? "text-red-400" : "text-emerald-500"}`}>Timed Waypoint Speed Plan</div>
                <div className="mt-3 grid gap-2">{timingPlan.blocks.map((block, index) => <div key={index} className={`border p-3 ${inset}`}><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-xs font-black uppercase">WP {block.fromIndex + 1} → WP {block.toIndex + 1}</div><div className={`font-mono text-xl font-black ${block.requiredSpeed !== null && block.requiredSpeed > limit ? "text-red-400" : "text-emerald-500"}`}>{block.requiredSpeed === null ? "IMPOSSIBLE" : `${block.requiredSpeed.toFixed(1)} KT`}</div></div><div className={`mt-1 text-[10px] font-bold uppercase ${muted}`}>{block.distance.toFixed(1)} nm · target {dateTimeAtWaypoint(block.targetTime, route?.waypoints[block.toIndex])}{block.holdHours > 0 ? ` · includes ${durationText(block.holdHours)} holding` : ""}</div></div>)}</div>
                {timingPlan.error && <div className="mt-3 text-xs font-black uppercase text-red-400">{timingPlan.error}</div>}
                {exceedsLimit && <div className="mt-3 border border-red-500/60 p-2 text-xs font-black uppercase text-red-400">One or more required speeds exceed your {limit.toFixed(1)} kt planning limit</div>}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Distance" value={route ? `${totalDistance.toFixed(1)} nm` : "--"} inset={inset} muted={muted} /><Metric label="Underway" value={route ? durationText(totalUnderway) : "--"} inset={inset} muted={muted} /><Metric label="Holding" value={route ? durationText(totalHold) : "--"} inset={inset} muted={muted} /><Metric label="Final Arrival" value={dateTimeAtWaypoint(finalArrival, route?.waypoints[route.waypoints.length - 1])} inset={inset} muted={muted} /><Metric label="Target WP" value={targetWaypoint ? `${resolvedTargetWaypointIndex! + 1} · ${targetWaypoint.name}` : "--"} inset={inset} muted={muted} /><Metric label="Target WP ETA" value={dateTimeAtWaypoint(targetWaypointArrival, targetWaypoint)} inset={inset} muted={muted} /></div>
            {targetDeltaHours !== null && <div className={`mt-2 border p-3 ${inset}`}><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Target Waypoint Arrival Difference</div><div className={`mt-1 font-mono text-lg font-black ${Math.abs(targetDeltaHours) < 0.05 ? "text-emerald-500" : targetDeltaHours > 0 ? "text-red-400" : "text-cyan-400"}`}>{Math.abs(targetDeltaHours) < 0.05 ? "ON TIME" : `${durationText(Math.abs(targetDeltaHours))} ${targetDeltaHours > 0 ? "LATE" : "EARLY"}`}</div></div>}
          </section>
        </div>

        <section className={`mt-2 border ${panel}`}>
          <div className="flex items-center justify-between border-b border-current/10 px-3 py-2"><div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>Leg Speed & Holding Plan</div><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Hold is applied after arrival at the waypoint</div></div>
          {!route ? <div className={`p-8 text-center text-sm ${muted}`}>Load an RTZ route to start planning.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse text-left"><thead><tr className={`text-[9px] font-black uppercase tracking-[.1em] ${muted}`}><th className="border-b border-current/10 px-3 py-2">Leg</th><th className="border-b border-current/10 px-3 py-2">From → To</th><th className="border-b border-current/10 px-3 py-2">Dist</th><th className="border-b border-current/10 px-3 py-2">Course</th><th className="border-b border-current/10 px-3 py-2">Speed</th><th className="border-b border-current/10 px-3 py-2">Run Time</th><th className="border-b border-current/10 px-3 py-2">Arrive</th><th className="border-b border-current/10 px-3 py-2">Hold</th><th className="border-b border-current/10 px-3 py-2">Resume</th></tr></thead><tbody>{timeline.map((row) => { const isTarget = timedTargets.some((item) => item.waypointIndex === row.index + 1); const isSolved = row.solvedSpeed !== null; const crossesIDL = crossesInternationalDateLine(row.from, row.to); return <tr key={`${row.from.id}-${row.to.id}`} className={`border-b border-current/10 last:border-b-0 ${isTarget ? (day ? "bg-amber-50" : "bg-[#c9a227]/10") : isSolved ? (day ? "bg-emerald-50" : "bg-emerald-500/10") : ""}`}><td className="px-3 py-2 font-mono text-xs font-black">{row.index + 1}</td><td className="px-3 py-2"><div className="text-sm font-black">{row.from.name} → {row.to.name}{crossesIDL && <span className="ml-2 rounded border border-cyan-400/50 px-1.5 py-0.5 text-[9px] font-black uppercase text-cyan-400">IDL Crossing</span>}{isTarget && <span className="ml-2 text-[9px] font-black uppercase text-[#c9a227]">Target</span>}{isSolved && <span className="ml-2 text-[9px] font-black uppercase text-emerald-500">Auto speed</span>}</div><div className={`mt-0.5 font-mono text-[10px] ${muted}`}>{row.from.id} → {row.to.id}</div></td><td className="px-3 py-2 font-mono text-sm font-black">{row.distance.toFixed(1)} nm</td><td className="px-3 py-2 font-mono text-sm font-black">{row.bearing.toFixed(0)}°T</td><td className="px-3 py-2">{isSolved ? <div className="w-24 border border-emerald-500/60 px-2 py-2 font-mono text-base font-black text-emerald-500">{row.speed.toFixed(1)}</div> : <input aria-label={`Speed for leg ${row.index + 1}`} type="number" min="0.1" step="0.1" value={plans[row.index]?.speed ?? row.speed} onChange={(e) => updatePlan(row.index, { speed: safeSpeed(e.target.value, row.speed) })} className={`w-24 border px-2 py-2 font-mono text-base font-black ${control}`} />}</td><td className="px-3 py-2 font-mono text-sm font-black">{durationText(row.underwayHours)}</td><td className={`px-3 py-2 font-mono text-sm font-black ${isTarget ? "text-[#c9a227]" : ""}`}>{dateTimeAtWaypoint(row.arrive, row.to)}</td><td className="px-3 py-2"><div className="flex items-center gap-1"><input aria-label={`Hold after ${row.to.name}`} type="number" min="0" step="0.25" value={plans[row.index]?.holdHours ?? 0} onChange={(e) => updatePlan(row.index, { holdHours: decimalHours(e.target.value) })} className={`w-24 border px-2 py-2 font-mono text-base font-black ${control}`} /><span className={`text-xs ${muted}`}>hr</span></div></td><td className="px-3 py-2 font-mono text-sm font-black">{row.holdHours > 0 ? dateTimeAtWaypoint(row.resume, row.to) : "—"}</td></tr>; })}</tbody></table></div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, inset, muted }: { label: string; value: string; inset: string; muted: string }) {
  return <div className={`border p-3 ${inset}`}><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>{label}</div><div className="mt-1 break-words font-mono text-base font-black">{value}</div></div>;
}
