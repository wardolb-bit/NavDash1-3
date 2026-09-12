"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CrewNoaaMap } from "../../components/CrewNoaaMap";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type PlanningRoute = { routeName: string; waypoints: Waypoint[] };
type LegPlan = { speed: number; holdHours: number };

function toRad(value: number) { return value * Math.PI / 180; }
function lonDelta(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }
function distanceNm(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLat = toRad(b.lat - a.lat), dLon = toRad(lonDelta(b.lon - a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearingDeg(a: Waypoint, b: Waypoint) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(lonDelta(b.lon - a.lon));
  const deg = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180 / Math.PI;
  return (deg + 360) % 360;
}
function getAttr(node: Element | null, names: string[]) {
  if (!node) return null;
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}
function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim();
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;
  const hemi = text.match(/[NSEW]/i)?.[0]?.toUpperCase();
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;
  let value = nums.length >= 3
    ? Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600
    : nums.length >= 2
      ? Math.abs(nums[0]) + nums[1] / 60
      : nums[0];
  if (hemi === "S" || hemi === "W" || (!hemi && nums[0] < 0)) value *= -1;
  if ((isLat && Math.abs(value) > 90) || (!isLat && Math.abs(value) > 180)) return NaN;
  return value;
}
function waypointName(node: Element, fallback: string) {
  return getAttr(node, ["name", "Name", "waypointName", "WaypointName", "id", "ID"])
    || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim()
    || fallback;
}
function parseRtz(xmlText: string): PlanningRoute {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeInfo = doc.querySelector("routeInfo,RouteInfo");
  const routeName = getAttr(routeInfo, ["routeName", "RouteName", "name", "Name"])
    || getAttr(routeNode, ["routeName", "RouteName", "name", "Name", "id", "ID"])
    || routeNode.querySelector("routeName,name")?.textContent?.trim()
    || "Planning Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    return {
      id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${String(index + 1).padStart(3, "0")}`,
      name: waypointName(node, `Waypoint ${index + 1}`),
      lat,
      lon,
    };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}
function decimalHours(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function safeSpeed(value: string, fallback = 10) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function durationText(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return "--";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function dateTimeText(date: Date | null) {
  if (!date || !Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function VoyagePlannerPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const day = !nightMode;
  const [route, setRoute] = useState<PlanningRoute | null>(null);
  const [defaultSpeed, setDefaultSpeed] = useState("10");
  const [departure, setDeparture] = useState("");
  const [targetArrival, setTargetArrival] = useState("");
  const [plans, setPlans] = useState<LegPlan[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    setDeparture(localInputValue(now));
  }, []);

  const legs = useMemo(() => {
    if (!route) return [];
    return route.waypoints.slice(1).map((to, index) => {
      const from = route.waypoints[index];
      const distance = distanceNm(from, to);
      const speed = plans[index]?.speed || safeSpeed(defaultSpeed);
      const holdHours = plans[index]?.holdHours || 0;
      return { index, from, to, distance, bearing: bearingDeg(from, to), speed, holdHours, underwayHours: distance / speed };
    });
  }, [route, plans, defaultSpeed]);

  const timeline = useMemo(() => {
    const start = departure ? new Date(departure) : null;
    if (!start || !Number.isFinite(start.getTime())) return [];
    let cursor = new Date(start);
    return legs.map((leg) => {
      const depart = new Date(cursor);
      const arrive = new Date(depart.getTime() + leg.underwayHours * 3600000);
      const resume = new Date(arrive.getTime() + leg.holdHours * 3600000);
      cursor = resume;
      return { ...leg, depart, arrive, resume };
    });
  }, [legs, departure]);

  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const totalUnderway = legs.reduce((sum, leg) => sum + leg.underwayHours, 0);
  const totalHold = legs.reduce((sum, leg) => sum + leg.holdHours, 0);
  const finalArrival = timeline.length ? timeline[timeline.length - 1].arrive : null;
  const target = targetArrival ? new Date(targetArrival) : null;
  const targetDeltaHours = finalArrival && target && Number.isFinite(target.getTime()) ? (finalArrival.getTime() - target.getTime()) / 3600000 : null;

  async function loadRoute(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseRtz(await file.text());
      const speed = safeSpeed(defaultSpeed);
      setRoute(parsed);
      setPlans(parsed.waypoints.slice(1).map(() => ({ speed, holdHours: 0 })));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load route.");
    }
  }

  function applyDefaultSpeed() {
    const speed = safeSpeed(defaultSpeed);
    setDefaultSpeed(String(speed));
    setPlans((current) => current.map((plan) => ({ ...plan, speed })));
  }

  function updatePlan(index: number, patch: Partial<LegPlan>) {
    setPlans((current) => current.map((plan, i) => i === index ? { ...plan, ...patch } : plan));
  }

  function clearPlanner() {
    setRoute(null);
    setPlans([]);
    setTargetArrival("");
    setError("");
  }

  const panel = day ? "border-slate-300 bg-white" : "border-white/15 bg-[#071019]";
  const inset = day ? "border-slate-200 bg-[#f5f7f9]" : "border-white/10 bg-[#04080c]";
  const control = day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#0b141d] text-slate-100";
  const muted = day ? "text-slate-500" : "text-slate-400";
  const mapRoute = route ? { routeName: route.routeName, waypoints: route.waypoints, activeWaypointIndex: 1 } : null;

  return (
    <main className={day ? "min-h-screen bg-[#eef2f5] text-slate-900" : "min-h-screen bg-[#04080c] text-slate-100"}>
      <div className="mx-auto max-w-[1900px] p-2 sm:p-3">
        <header className={`border p-3 ${panel}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#c9a227]">M/V MB480 · NAVDASH 1.3</div>
              <h1 className="mt-1 text-xl font-black uppercase tracking-[.08em] sm:text-2xl">Voyage Timing Planner</h1>
              <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.12em] ${muted}`}>Planning route only · not shared · not cached</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { window.location.href = "/bridge"; }} className={`border px-3 py-2 text-[10px] font-black uppercase ${control}`}>Main</button>
              <label className="cursor-pointer border border-[#c9a227]/70 bg-[#c9a227] px-3 py-2 text-[10px] font-black uppercase text-black">Load RTZ<input type="file" accept=".rtz,.xml" onChange={loadRoute} className="hidden" /></label>
              <button type="button" onClick={clearPlanner} disabled={!route} className={`border px-3 py-2 text-[10px] font-black uppercase ${route ? "border-red-400/50 text-red-400" : "border-slate-500/20 text-slate-500"}`}>Clear</button>
              <button type="button" onClick={toggleTheme} className={`border px-3 py-2 text-[10px] font-black uppercase ${control}`}>{nightMode ? "Day" : "Night"}</button>
            </div>
          </div>
        </header>

        {error && <div className="mt-2 border border-red-500/50 bg-red-500/10 p-3 text-sm font-bold text-red-400">{error}</div>}

        <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1.55fr)_430px]">
          <section className={`overflow-hidden border ${panel}`}>
            <div className="flex items-center justify-between border-b border-current/10 px-3 py-2">
              <div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>NOAA ENC · Planning Route</div>
              <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>{route?.routeName || "No planning route loaded"}</div>
            </div>
            <div className="h-[470px] xl:h-[570px]">
              <CrewNoaaMap route={mapRoute} ship={null} nightMode={nightMode} />
            </div>
          </section>

          <section className={`border p-3 ${panel}`}>
            <div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>Timing Controls</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="block">
                <span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Departure</span>
                <input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} className={`w-full border px-3 py-2 text-base font-mono ${control}`} />
              </label>
              <label className="block">
                <span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Target Arrival · Optional</span>
                <input type="datetime-local" value={targetArrival} onChange={(e) => setTargetArrival(e.target.value)} className={`w-full border px-3 py-2 text-base font-mono ${control}`} />
              </label>
              <div>
                <span className={`mb-1 block text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Default Speed</span>
                <div className="flex gap-2">
                  <input type="number" min="0.1" step="0.1" value={defaultSpeed} onChange={(e) => setDefaultSpeed(e.target.value)} className={`min-w-0 flex-1 border px-3 py-2 text-base font-mono ${control}`} />
                  <button type="button" onClick={applyDefaultSpeed} disabled={!route} className="border border-[#c9a227]/70 px-3 py-2 text-[10px] font-black uppercase text-[#c9a227]">Apply All</button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="Distance" value={route ? `${totalDistance.toFixed(1)} nm` : "--"} inset={inset} muted={muted} />
              <Metric label="Underway" value={route ? durationText(totalUnderway) : "--"} inset={inset} muted={muted} />
              <Metric label="Holding" value={route ? durationText(totalHold) : "--"} inset={inset} muted={muted} />
              <Metric label="Arrival" value={dateTimeText(finalArrival)} inset={inset} muted={muted} />
            </div>

            {targetDeltaHours !== null && (
              <div className={`mt-2 border p-3 ${inset}`}>
                <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Target Arrival Difference</div>
                <div className={`mt-1 font-mono text-lg font-black ${Math.abs(targetDeltaHours) < 0.05 ? "text-emerald-500" : targetDeltaHours > 0 ? "text-red-400" : "text-cyan-400"}`}>
                  {Math.abs(targetDeltaHours) < 0.05 ? "ON TIME" : `${durationText(Math.abs(targetDeltaHours))} ${targetDeltaHours > 0 ? "LATE" : "EARLY"}`}
                </div>
              </div>
            )}
          </section>
        </div>

        <section className={`mt-2 border ${panel}`}>
          <div className="flex items-center justify-between border-b border-current/10 px-3 py-2">
            <div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>Leg Speed & Holding Plan</div>
            <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Hold is applied after arrival at the waypoint</div>
          </div>
          {!route ? (
            <div className={`p-8 text-center text-sm ${muted}`}>Load an RTZ route to start planning.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left">
                <thead>
                  <tr className={`text-[9px] font-black uppercase tracking-[.1em] ${muted}`}>
                    <th className="border-b border-current/10 px-3 py-2">Leg</th>
                    <th className="border-b border-current/10 px-3 py-2">From → To</th>
                    <th className="border-b border-current/10 px-3 py-2">Dist</th>
                    <th className="border-b border-current/10 px-3 py-2">Course</th>
                    <th className="border-b border-current/10 px-3 py-2">Speed</th>
                    <th className="border-b border-current/10 px-3 py-2">Run Time</th>
                    <th className="border-b border-current/10 px-3 py-2">Arrive</th>
                    <th className="border-b border-current/10 px-3 py-2">Hold</th>
                    <th className="border-b border-current/10 px-3 py-2">Resume</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((row) => (
                    <tr key={`${row.from.id}-${row.to.id}`} className="border-b border-current/10 last:border-b-0">
                      <td className="px-3 py-2 font-mono text-xs font-black">{row.index + 1}</td>
                      <td className="px-3 py-2"><div className="text-sm font-black">{row.from.name} → {row.to.name}</div><div className={`mt-0.5 font-mono text-[10px] ${muted}`}>{row.from.id} → {row.to.id}</div></td>
                      <td className="px-3 py-2 font-mono text-sm font-black">{row.distance.toFixed(1)} nm</td>
                      <td className="px-3 py-2 font-mono text-sm font-black">{row.bearing.toFixed(0)}°T</td>
                      <td className="px-3 py-2"><input aria-label={`Speed for leg ${row.index + 1}`} type="number" min="0.1" step="0.1" value={plans[row.index]?.speed ?? row.speed} onChange={(e) => updatePlan(row.index, { speed: safeSpeed(e.target.value, row.speed) })} className={`w-24 border px-2 py-2 font-mono text-base font-black ${control}`} /></td>
                      <td className="px-3 py-2 font-mono text-sm font-black">{durationText(row.underwayHours)}</td>
                      <td className="px-3 py-2 font-mono text-sm font-black">{dateTimeText(row.arrive)}</td>
                      <td className="px-3 py-2"><div className="flex items-center gap-1"><input aria-label={`Hold after ${row.to.name}`} type="number" min="0" step="0.25" value={plans[row.index]?.holdHours ?? 0} onChange={(e) => updatePlan(row.index, { holdHours: decimalHours(e.target.value) })} className={`w-24 border px-2 py-2 font-mono text-base font-black ${control}`} /><span className={`text-xs ${muted}`}>hr</span></div></td>
                      <td className="px-3 py-2 font-mono text-sm font-black">{row.holdHours > 0 ? dateTimeText(row.resume) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, inset, muted }: { label: string; value: string; inset: string; muted: string }) {
  return <div className={`border p-3 ${inset}`}><div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>{label}</div><div className="mt-1 break-words font-mono text-base font-black">{value}</div></div>;
}
