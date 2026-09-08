"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import type { AmiForecastPoint, AmiRouteForecast } from "../../lib/amiRouteForecast";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteBrief = { routeName: string; waypoints: Waypoint[] };
type UserMark = { id: string; name: string; lat: number; lon: number };

const USER_CHART_STORAGE_KEY = "navdash-user-chart-v1";
const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";

function toRad(value: number) { return value * Math.PI / 180; }
function toDeg(value: number) { return value * 180 / Math.PI; }

function nmBetween(a: Pick<Waypoint, "lat" | "lon">, b: Pick<Waypoint, "lat" | "lon">) {
  const rNm = 3440.065;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * rNm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a: Waypoint, b: Waypoint) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const degText = isLat ? String(deg).padStart(2, "0") : String(deg).padStart(3, "0");
  return `${degText}° ${min.toFixed(3)}' ${hemi}`;
}

function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim();
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;
  const hemi = text.match(/[NSEW]/i)?.[0]?.toUpperCase();
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;
  let value = nums[0];
  if (nums.length >= 2) value = Math.abs(nums[0]) + nums[1] / 60;
  if (nums.length >= 3) value = Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600;
  if (hemi === "S" || hemi === "W") value *= -1;
  if (!hemi && nums[0] < 0) value *= -1;
  if (isLat && Math.abs(value) > 90) return NaN;
  if (!isLat && Math.abs(value) > 180) return NaN;
  return value;
}

function getAttr(node: Element, names: string[]) {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}

function findName(node: Element, fallback: string) {
  const attrName = getAttr(node, ["name", "Name", "id", "ID"]);
  if (attrName) return attrName;
  const nameNode = node.querySelector("name") || node.querySelector("Name") || node.querySelector("waypointName") || node.querySelector("WaypointName");
  return nameNode?.textContent?.trim() || fallback;
}

function parseRtz(xmlText: string): RouteBrief {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RTZ/XML route file.");
  const routeNode = doc.querySelector("route") || doc.querySelector("Route") || doc.documentElement;
  const routeName = getAttr(routeNode, ["name", "Name", "id", "ID"]) || routeNode.querySelector("routeName")?.textContent?.trim() || routeNode.querySelector("name")?.textContent?.trim() || "Loaded RTZ Route";
  const possibleWpNodes = Array.from(doc.querySelectorAll("waypoint, Waypoint, wp, WP"));
  const waypoints: Waypoint[] = [];
  possibleWpNodes.forEach((node, index) => {
    const pos = node.querySelector("position") || node.querySelector("Position") || node.querySelector("pos") || node;
    const latRaw = getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]);
    const lonRaw = getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]);
    const lat = parseCoordinate(latRaw, true);
    const lon = parseCoordinate(lonRaw, false);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      waypoints.push({
        id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${String(index + 1).padStart(3, "0")}`,
        name: findName(node, `Waypoint ${index + 1}`),
        lat,
        lon,
      });
    }
  });
  if (waypoints.length < 2) throw new Error("Route needs at least two valid waypoints.");
  return { routeName, waypoints };
}

function segmentRows(waypoints: Waypoint[]) {
  return waypoints.slice(1).map((to, index) => {
    const from = waypoints[index];
    return { from, to, distance: nmBetween(from, to), bearing: bearingBetween(from, to) };
  });
}

function totalDistance(waypoints: Waypoint[]) {
  return segmentRows(waypoints).reduce((sum, leg) => sum + leg.distance, 0);
}

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDateTime(date: Date | null) {
  if (!date || !Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatUtc(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("en-US", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + "Z";
}

function readUserMarks(): UserMark[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_CHART_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((mark: any, index: number) => ({
      id: typeof mark?.id === "string" ? mark.id : `mark-${index + 1}`,
      name: typeof mark?.name === "string" ? mark.name : `Mark ${index + 1}`,
      lat: Number(mark?.lat), lon: Number(mark?.lon),
    })).filter((mark: UserMark) => Number.isFinite(mark.lat) && Number.isFinite(mark.lon));
  } catch { return []; }
}

function readAmi(): AmiRouteForecast | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY) || "null") as AmiRouteForecast | null;
    return parsed?.version === 1 && Array.isArray(parsed.forecastPoints) ? parsed : null;
  } catch { return null; }
}

function closestRouteDistance(mark: UserMark, route: Waypoint[]) {
  if (!route.length) return Number.POSITIVE_INFINITY;
  return route.reduce((best, wp) => Math.min(best, nmBetween(mark, wp)), Number.POSITIVE_INFINITY);
}

function maxBy(points: AmiForecastPoint[], getter: (point: AmiForecastPoint) => number) {
  return points.reduce<AmiForecastPoint | null>((best, point) => !best || getter(point) > getter(best) ? point : best, null);
}

export default function NavBriefBuilderPage() {
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [routeError, setRouteError] = useState("");
  const [plannedSpeed, setPlannedSpeed] = useState("10");
  const [departure, setDeparture] = useState("");
  const [userMarks, setUserMarks] = useState<UserMark[]>([]);
  const [ami, setAmi] = useState<AmiRouteForecast | null>(null);
  const [opsNotes, setOpsNotes] = useState("");
  const [portNotes, setPortNotes] = useState("");
  const [briefGenerated, setBriefGenerated] = useState(false);

  const legs = useMemo(() => route ? segmentRows(route.waypoints) : [], [route]);
  const distanceNm = useMemo(() => route ? totalDistance(route.waypoints) : 0, [route]);
  const speed = safeNumber(plannedSpeed, 10);
  const voyageHours = distanceNm / speed;
  const departureDate = departure ? new Date(departure) : null;
  const eta = departureDate ? new Date(departureDate.getTime() + voyageHours * 3600000) : null;
  const origin = route?.waypoints[0];
  const destination = route?.waypoints[route.waypoints.length - 1];
  const relevantMarks = useMemo(() => route ? userMarks.map(mark => ({ ...mark, routeDistance: closestRouteDistance(mark, route.waypoints) })).sort((a, b) => a.routeDistance - b.routeDistance) : [], [route, userMarks]);
  const strongestWind = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.windSpeedKt) : null, [ami]);
  const strongestGust = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.gustKt) : null, [ami]);
  const highestSea = useMemo(() => ami ? maxBy(ami.forecastPoints, point => point.significantWaveM) : null, [ami]);

  async function loadSharedRoute(silent = false) {
    if (!silent) setRouteError("");
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route state API returned ${response.status}`);
      const data = await response.json();
      const waypoints = Array.isArray(data?.waypoints) ? data.waypoints.map((wp: any, index: number) => ({
        id: String(wp.id || `WP${String(index + 1).padStart(3, "0")}`),
        name: String(wp.name || wp.id || `Waypoint ${index + 1}`),
        lat: Number(wp.lat), lon: Number(wp.lon),
      })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon)) : [];
      if (waypoints.length < 2) throw new Error("No shared route is loaded on the server.");
      setRoute({ routeName: String(data.routeName || "Shared NavDash Route"), waypoints });
    } catch (error) {
      if (!silent) setRouteError(error instanceof Error ? error.message : "Could not load shared route.");
    }
  }

  function refreshLiveInputs() {
    setUserMarks(readUserMarks());
    setAmi(readAmi());
    void loadSharedRoute(true);
  }

  useEffect(() => {
    refreshLiveInputs();
    const refresh = () => { setUserMarks(readUserMarks()); setAmi(readAmi()); };
    window.addEventListener("storage", refresh);
    window.addEventListener("navdash-ami-overlay-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("navdash-ami-overlay-updated", refresh);
    };
  }, []);

  async function loadRtz(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRouteError("");
    setBriefGenerated(false);
    try { setRoute(parseRtz(await file.text())); }
    catch (error) {
      setRoute(null);
      setRouteError(error instanceof Error ? error.message : "Unable to load route.");
    }
  }

  const statusCards = [
    { label: "RTZ / Route", ok: Boolean(route), detail: route ? `${route.waypoints.length} waypoints` : "Not loaded" },
    { label: "User Layer", ok: userMarks.length > 0, detail: `${userMarks.length} marks` },
    { label: "AMI Weather", ok: Boolean(ami), detail: ami ? `${ami.forecastPoints.length} forecast points` : "Not loaded" },
  ];

  return (
    <main className="min-h-screen bg-[#07111f] px-4 py-5 text-slate-100 print:bg-white print:text-black">
      <style jsx global>{`
        @media print {
          .no-print { display:none !important; }
          .print-card { border:1px solid #999 !important; background:white !important; color:black !important; box-shadow:none !important; }
          body { background:white !important; }
        }
      `}</style>

      <div className="mx-auto max-w-7xl space-y-5">
        <header className="no-print rounded-3xl border border-cyan-300/20 bg-slate-950/60 p-5 shadow-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-200">NavDash 1.3</div>
              <h1 className="mt-2 text-3xl font-black text-white">Nav Brief</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Route, user-layer intelligence, and AMI route weather in one bridge-ready brief.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={refreshLiveInputs} className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100">Refresh Live Inputs</button>
              <Link href="/" className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white">NavDash</Link>
              <button type="button" onClick={() => window.print()} className="rounded-2xl border border-[#c9a227]/40 bg-[#c9a227] px-4 py-3 text-sm font-black text-black">Print / Save PDF</button>
            </div>
          </div>
        </header>

        <section className="no-print grid gap-3 md:grid-cols-3">
          {statusCards.map(card => (
            <div key={card.label} className={`rounded-2xl border p-4 ${card.ok ? "border-emerald-400/25 bg-emerald-400/10" : "border-white/10 bg-slate-950/50"}`}>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{card.label}</div>
              <div className={`mt-2 text-lg font-black ${card.ok ? "text-emerald-200" : "text-slate-300"}`}>{card.ok ? "READY" : "STANDBY"}</div>
              <div className="mt-1 text-sm text-slate-400">{card.detail}</div>
            </div>
          ))}
        </section>

        <section className="no-print grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">Route</h2>
            <p className="mt-1 text-sm text-slate-400">Uses the current shared NavDash route automatically, or load an RTZ manually.</p>
            <input type="file" accept=".rtz,.xml,.txt" onChange={loadRtz} className="mt-4 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-slate-200" />
            <button type="button" onClick={() => loadSharedRoute(false)} className="mt-3 w-full rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100">Use Shared NavDash Route</button>
            {routeError && <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">{routeError}</div>}
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">Planning</h2>
            <label className="mt-4 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Departure date/time
              <input type="datetime-local" value={departure} onChange={event => setDeparture(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm normal-case tracking-normal text-white" />
            </label>
            <label className="mt-3 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Planning speed, kt
              <input type="number" min="1" step="0.1" value={plannedSpeed} onChange={event => setPlannedSpeed(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm normal-case tracking-normal text-white" />
            </label>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">Generate</h2>
            <p className="mt-1 text-sm text-slate-400">Build the bridge brief from whatever inputs are currently available.</p>
            <button type="button" disabled={!route} onClick={() => setBriefGenerated(true)} className="mt-5 w-full rounded-2xl border border-[#c9a227]/40 bg-[#c9a227] px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40">Generate Nav Brief</button>
          </div>
        </section>

        <section className="no-print grid gap-4 lg:grid-cols-2">
          <label className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Bridge Team / Watch Notes</div>
            <textarea value={opsNotes} onChange={event => setOpsNotes(event.target.value)} placeholder="Traffic, machinery limitations, visibility triggers, master's standing instructions, watch items..." className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white" />
          </label>
          <label className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Arrival / Port / Pilotage Notes</div>
            <textarea value={portNotes} onChange={event => setPortNotes(event.target.value)} placeholder="Pilot station, reporting, berth, local hazards, arrival restrictions..." className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white" />
          </label>
        </section>

        <section className="print-card rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <div className="border-b border-white/10 pb-4 print:border-black/20">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-200 print:text-black">NavDash Navigation Brief</div>
            <h2 className="mt-2 text-3xl font-black text-white print:text-black">{route?.routeName || "No route loaded"}</h2>
            <p className="mt-2 text-sm text-slate-300 print:text-black">Generated: {formatDateTime(new Date())}</p>
          </div>

          {!route ? (
            <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-950/30 p-4 text-amber-100 print:border-black print:bg-white print:text-black">Load an RTZ or shared NavDash route to generate the brief.</div>
          ) : (
            <div className="mt-5 space-y-7">
              <div>
                <h3 className="text-xl font-black">Voyage Overview</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className="print-card rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs font-black uppercase text-slate-400 print:text-black">Departure</div><div className="mt-2 font-black">{origin?.name}</div></div>
                  <div className="print-card rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs font-black uppercase text-slate-400 print:text-black">Destination</div><div className="mt-2 font-black">{destination?.name}</div></div>
                  <div className="print-card rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs font-black uppercase text-slate-400 print:text-black">Distance / Speed</div><div className="mt-2 font-black">{distanceNm.toFixed(1)} NM / {speed.toFixed(1)} kt</div></div>
                  <div className="print-card rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs font-black uppercase text-slate-400 print:text-black">ETA</div><div className="mt-2 font-black">{formatDateTime(eta)}</div></div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Weather Routing Strategy</h3>
                <div className="print-card mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6">
                  {ami ? <>
                    <div><b>AMI:</b> {ami.sourceName}{ami.referenceId ? ` · Ref ${ami.referenceId}` : ""} · issued {formatUtc(ami.issuedAt)}</div>
                    {ami.warnings && <div className="mt-2"><b>Warnings:</b> {ami.warnings}</div>}
                    {ami.synopticDiscussion && <div className="mt-2"><b>Synoptic:</b> {ami.synopticDiscussion}</div>}
                    <div className="mt-2">
                      {strongestWind ? `Strongest forecast wind ${strongestWind.windSpeedKt} kt near ${formatCoord(strongestWind.lat, true)} / ${formatCoord(strongestWind.lon, false)} at ${formatUtc(strongestWind.validAt)}. ` : ""}
                      {strongestGust ? `Peak gust ${strongestGust.gustKt} kt. ` : ""}
                      {highestSea ? `Highest significant seas ${highestSea.significantWaveM.toFixed(1)} m at ${formatUtc(highestSea.validAt)}.` : ""}
                    </div>
                    {ami.cyclone && <div className="mt-2"><b>Tropical system:</b> {ami.cyclone.summary}</div>}
                  </> : "No AMI route forecast is currently loaded on the NavDash map."}
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Routing Decision Points</h3>
                <div className="print-card mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6">
                  {relevantMarks.length ? relevantMarks.map(mark => <div key={mark.id}>• <b>{mark.name}</b> · {formatCoord(mark.lat, true)} / {formatCoord(mark.lon, false)} · nearest route waypoint {mark.routeDistance.toFixed(1)} NM</div>) : "No user-layer marks are currently saved."}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div><h3 className="text-xl font-black">Bridge Team Intent</h3><div className="print-card mt-3 min-h-24 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6">{opsNotes.trim() || "Maintain the planned RTZ track, continuously compare actual conditions against AMI guidance, and reassess route execution when observed conditions materially differ from forecast."}</div></div>
                <div><h3 className="text-xl font-black">Navigation</h3><div className="print-card mt-3 min-h-24 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6">{portNotes.trim() || `Route contains ${route.waypoints.length} waypoints and ${legs.length} legs. Confirm charted hazards, reporting requirements, pilotage, and arrival restrictions against current official publications before execution.`}</div></div>
              </div>

              {ami && (
                <div>
                  <h3 className="text-xl font-black">AMI Weather Along Route</h3>
                  <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 print:border-black">
                    <table className="w-full border-collapse text-xs">
                      <thead className="bg-white/10 print:bg-white"><tr><th className="border border-white/10 px-2 py-2 text-left print:border-black">Valid</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Position</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Wind</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Seas</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Conditions</th></tr></thead>
                      <tbody>{ami.forecastPoints.map((point, index) => <tr key={`${point.validAt}-${index}`}><td className="border border-white/10 px-2 py-2 print:border-black">{formatUtc(point.validAt)}</td><td className="border border-white/10 px-2 py-2 font-mono print:border-black">{point.lat.toFixed(2)}°, {point.lon.toFixed(2)}°</td><td className="border border-white/10 px-2 py-2 print:border-black">{String(point.windDirectionDeg).padStart(3, "0")}° / {point.windSpeedKt} kt G {point.gustKt}</td><td className="border border-white/10 px-2 py-2 print:border-black">{point.significantWaveM.toFixed(1)} m @ {point.significantWavePeriodSec}s</td><td className="border border-white/10 px-2 py-2 print:border-black">{point.conditions}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xl font-black">Route Legs</h3>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 print:border-black">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-white/10 print:bg-white"><tr><th className="border border-white/10 px-3 py-2 text-left print:border-black">Leg</th><th className="border border-white/10 px-3 py-2 text-left print:border-black">From</th><th className="border border-white/10 px-3 py-2 text-left print:border-black">To</th><th className="border border-white/10 px-3 py-2 text-right print:border-black">Course</th><th className="border border-white/10 px-3 py-2 text-right print:border-black">Distance</th></tr></thead>
                    <tbody>{legs.map((leg, index) => <tr key={`${leg.from.id}-${leg.to.id}-${index}`}><td className="border border-white/10 px-3 py-2 print:border-black">{index + 1}</td><td className="border border-white/10 px-3 py-2 print:border-black">{leg.from.name}</td><td className="border border-white/10 px-3 py-2 print:border-black">{leg.to.name}</td><td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">{String(Math.round(leg.bearing)).padStart(3, "0")}°</td><td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">{leg.distance.toFixed(1)} NM</td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <div className="print-card rounded-2xl border-2 border-[#c9a227]/60 bg-[#c9a227]/10 p-4 text-center text-sm font-black print:border-black print:bg-white">ROUTING PRINCIPLE: Preserve safe navigation first. Use the RTZ as the planned track, the user layer as bridge-team context, and AMI weather as forecast guidance. Reassess whenever actual conditions, traffic, navigation hazards, or official information invalidate the plan.</div>

              {!briefGenerated && <div className="no-print rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-4 text-sm text-cyan-100">Preview updates live. Click <b>Generate Nav Brief</b> when the inputs are ready, then print or save to PDF.</div>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
