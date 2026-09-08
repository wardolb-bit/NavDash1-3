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
  const nodes = Array.from(doc.querySelectorAll("waypoint, Waypoint, wp, WP"));
  const waypoints: Waypoint[] = [];
  nodes.forEach((node, index) => {
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

function normalizeRoutePayload(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${String(index + 1).padStart(3, "0")}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  if (waypoints.length < 2) return null;
  return {
    routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "Current NavDash Route"),
    waypoints,
  };
}

function readCurrentRoute() {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    return raw ? normalizeRoutePayload(JSON.parse(raw)) : null;
  } catch { return null; }
}

function normalizeMarks(raw: any[]): UserMark[] {
  return raw.map((mark: any, index: number) => {
    if (mark?.type === "Feature" && mark?.geometry?.type === "Point" && Array.isArray(mark.geometry.coordinates)) {
      return {
        id: String(mark?.id || mark?.properties?.id || `mark-${index + 1}`),
        name: String(mark?.properties?.name || mark?.properties?.title || mark?.properties?.label || `Mark ${index + 1}`),
        lat: Number(mark.geometry.coordinates[1]),
        lon: Number(mark.geometry.coordinates[0]),
      };
    }
    return {
      id: String(mark?.id || `mark-${index + 1}`),
      name: String(mark?.name || mark?.title || mark?.label || `Mark ${index + 1}`),
      lat: Number(mark?.lat ?? mark?.latitude),
      lon: Number(mark?.lon ?? mark?.lng ?? mark?.longitude),
    };
  }).filter((mark: UserMark) => Number.isFinite(mark.lat) && Number.isFinite(mark.lon) && Math.abs(mark.lat) <= 90 && Math.abs(mark.lon) <= 180);
}

function parseUserChartText(text: string, fileName: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("User chart file is empty.");

  if (/\.(json|geojson)$/i.test(fileName) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.marks) ? parsed.marks : Array.isArray(parsed?.userMarks) ? parsed.userMarks : Array.isArray(parsed?.features) ? parsed.features : [];
    const marks = normalizeMarks(raw);
    if (!marks.length) throw new Error("No point marks were found in the user chart file.");
    return marks;
  }

  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("User chart file is empty.");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delimiter).map(value => value.trim().toLowerCase());
  const latIndex = header.findIndex(value => ["lat", "latitude"].includes(value));
  const lonIndex = header.findIndex(value => ["lon", "lng", "long", "longitude"].includes(value));
  const nameIndex = header.findIndex(value => ["name", "title", "label", "mark"].includes(value));
  if (latIndex < 0 || lonIndex < 0) throw new Error("CSV user chart needs latitude and longitude columns.");
  const marks = lines.slice(1).map((line, index) => {
    const cells = line.split(delimiter).map(value => value.trim());
    return {
      id: `mark-${index + 1}`,
      name: cells[nameIndex] || `Mark ${index + 1}`,
      lat: Number(cells[latIndex]),
      lon: Number(cells[lonIndex]),
    };
  }).filter(mark => Number.isFinite(mark.lat) && Number.isFinite(mark.lon) && Math.abs(mark.lat) <= 90 && Math.abs(mark.lon) <= 180);
  if (!marks.length) throw new Error("No valid user chart positions were found.");
  return marks;
}

function readUserMarks(): UserMark[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_CHART_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? normalizeMarks(parsed) : [];
  } catch { return []; }
}

function readAmi(): AmiRouteForecast | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY) || "null") as AmiRouteForecast | null;
    return parsed?.version === 1 && Array.isArray(parsed.forecastPoints) ? parsed : null;
  } catch { return null; }
}

function segmentRows(waypoints: Waypoint[]) {
  return waypoints.slice(1).map((to, index) => {
    const from = waypoints[index];
    return { from, to, distance: nmBetween(from, to), bearing: bearingBetween(from, to) };
  });
}

function totalDistance(waypoints: Waypoint[]) { return segmentRows(waypoints).reduce((sum, leg) => sum + leg.distance, 0); }
function safeNumber(value: string, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function formatDateTime(date: Date | null) { return !date || !Number.isFinite(date.getTime()) ? "--" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatUtc(value: string) { const date = new Date(value); return !Number.isFinite(date.getTime()) ? value : date.toLocaleString("en-US", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + "Z"; }
function closestRouteDistance(mark: UserMark, route: Waypoint[]) { return route.reduce((best, wp) => Math.min(best, nmBetween(mark, wp)), Number.POSITIVE_INFINITY); }
function maxBy(points: AmiForecastPoint[], getter: (point: AmiForecastPoint) => number) { return points.reduce<AmiForecastPoint | null>((best, point) => !best || getter(point) > getter(best) ? point : best, null); }

export default function NavBriefBuilderPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
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

  const pageClass = nightMode ? "min-h-screen bg-slate-950 text-slate-100" : "min-h-screen bg-slate-100 text-slate-950";
  const headerClass = nightMode ? "mb-4 rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl" : "mb-4 rounded-[2rem] border border-slate-300 bg-white p-5 shadow-sm";
  const panelClass = nightMode ? "rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5" : "rounded-2xl border border-slate-300 bg-white p-5";
  const innerCardClass = nightMode ? "rounded-xl border border-slate-700/70 bg-slate-950/50 p-4" : "rounded-xl border border-slate-300 bg-slate-50 p-4";
  const inputClass = nightMode ? "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-2xl text-slate-100 outline-none focus:border-cyan-400" : "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-2xl text-slate-950 outline-none focus:border-slate-600";
  const muted = nightMode ? "text-slate-400" : "text-slate-600";
  const label = nightMode ? "text-cyan-300/80" : "text-slate-500";
  const primaryButton = nightMode ? "inline-flex min-h-12 items-center justify-center rounded-2xl bg-cyan-300 px-5 py-3 text-2xl font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-40" : "inline-flex min-h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-2xl font-black text-white hover:bg-slate-700 disabled:opacity-40";
  const secondaryButton = nightMode ? "inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 px-5 py-3 text-2xl font-black text-slate-100 hover:bg-white/15" : "inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-300 bg-slate-100 px-5 py-3 text-2xl font-black text-slate-950 hover:bg-white";

  async function loadCurrentNavDashRoute(silent = false) {
    if (!silent) setRouteError("");
    const local = readCurrentRoute();
    if (local) {
      setRoute(local);
      setRouteSource("Current NavDash route from this browser");
      return;
    }
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route state API returned ${response.status}`);
      const serverRoute = normalizeRoutePayload(await response.json());
      if (!serverRoute) throw new Error("No current NavDash route was found in this browser or on the route-state API.");
      setRoute(serverRoute);
      setRouteSource("NavDash route-state API fallback");
    } catch (error) {
      if (!silent) setRouteError(error instanceof Error ? error.message : "Could not load current NavDash route.");
    }
  }

  useEffect(() => {
    const currentRoute = readCurrentRoute();
    if (currentRoute) {
      setRoute(currentRoute);
      setRouteSource("Current NavDash route from this browser");
    }
    setUserMarks(readUserMarks());
    setAmi(readAmi());
    const refresh = () => {
      const nextRoute = readCurrentRoute();
      if (nextRoute) { setRoute(nextRoute); setRouteSource("Current NavDash route from this browser"); }
      setUserMarks(readUserMarks());
      setAmi(readAmi());
    };
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
    try {
      const parsed = parseRtz(await file.text());
      setRoute(parsed);
      setRouteSource(`RTZ upload: ${file.name}`);
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Unable to load route.");
    }
  }

  async function loadUserChart(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUserChartError("");
    try {
      const marks = parseUserChartText(await file.text(), file.name);
      setUserMarks(marks);
      setUserChartFile(file.name);
      window.localStorage.setItem(USER_CHART_STORAGE_KEY, JSON.stringify(marks));
      window.dispatchEvent(new CustomEvent("navdash-user-chart-updated", { detail: marks }));
    } catch (error) {
      setUserChartError(error instanceof Error ? error.message : "Unable to load user chart.");
    }
  }

  function refreshInputs() {
    const currentRoute = readCurrentRoute();
    if (currentRoute) { setRoute(currentRoute); setRouteSource("Current NavDash route from this browser"); }
    setUserMarks(readUserMarks());
    setAmi(readAmi());
  }

  return (
    <main className={`${pageClass} navbrief-page`}>
      <style jsx global>{`
        @media print {
          .navdash-global-nav, .no-print { display: none !important; }
          .navbrief-page { background: white !important; color: black !important; }
          .navbrief-print, .navbrief-print * { color: black !important; }
          .navbrief-print { background: white !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
          .print-card { border: 1px solid #888 !important; background: white !important; box-shadow: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-3 py-3 sm:px-4 lg:px-5">
        <header className={`${headerClass} no-print`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className={`text-2xl font-bold uppercase tracking-[0.18em] ${label}`}>NavDash Navigation</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Nav Brief</h1>
              <p className={`mt-2 max-w-4xl text-2xl ${muted}`}>Build the bridge brief from the current RTZ route, user chart and AMI route weather.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={refreshInputs} className={secondaryButton}>Refresh Inputs</button>
              <button type="button" onClick={toggleTheme} className={secondaryButton}>{nightMode ? "Day Mode" : "Night Mode"}</button>
              <button type="button" onClick={() => window.print()} className={primaryButton}>Print / PDF</button>
            </div>
          </div>
        </header>

        <section className="no-print grid gap-3 md:grid-cols-3">
          {[
            ["RTZ / Route", Boolean(route), route ? `${route.waypoints.length} waypoints` : "Not loaded"],
            ["User Chart", userMarks.length > 0, userMarks.length ? `${userMarks.length} marks` : "Not loaded"],
            ["AMI Weather", Boolean(ami), ami ? `${ami.forecastPoints.length} forecast points` : "Not loaded"],
          ].map(([name, ready, detail]) => (
            <div key={String(name)} className={innerCardClass}>
              <p className={`text-2xl font-bold uppercase tracking-[0.18em] ${label}`}>{String(name)}</p>
              <div className={`mt-2 text-2xl font-black ${ready ? (nightMode ? "text-emerald-300" : "text-emerald-700") : muted}`}>{ready ? "READY" : "STANDBY"}</div>
              <div className={`mt-1 text-2xl ${muted}`}>{String(detail)}</div>
            </div>
          ))}
        </section>

        <section className="no-print mt-4 grid gap-4 xl:grid-cols-3">
          <div className={panelClass}>
            <p className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>Route</p>
            <h2 className="mt-2 text-2xl font-semibold">RTZ / Current NavDash Route</h2>
            <p className={`mt-2 text-2xl ${muted}`}>The current-route button now reads the same browser route object used by the NavDash map.</p>
            <input type="file" accept=".rtz,.xml,.txt" onChange={loadRtz} className={inputClass} />
            <button type="button" onClick={() => void loadCurrentNavDashRoute(false)} className={`${secondaryButton} mt-3 w-full`}>Use Current NavDash Route</button>
            {routeSource && <div className={`mt-3 text-2xl ${muted}`}>{routeSource}</div>}
            {routeError && <div className="mt-3 rounded-xl border border-red-400/50 bg-red-950/30 p-3 text-2xl text-red-100">{routeError}</div>}
          </div>

          <div className={panelClass}>
            <p className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>User Chart</p>
            <h2 className="mt-2 text-2xl font-semibold">Upload User Layer</h2>
            <p className={`mt-2 text-2xl ${muted}`}>Loads point marks from NavDash JSON/GeoJSON or a CSV with name, latitude and longitude columns. The imported marks are saved to the same user-layer storage used by the map.</p>
            <input type="file" accept=".json,.geojson,.csv,.txt" onChange={loadUserChart} className={inputClass} />
            <div className={`mt-3 text-2xl ${muted}`}>{userChartFile ? `Loaded: ${userChartFile}` : userMarks.length ? `Using ${userMarks.length} saved NavDash marks` : "No user chart loaded"}</div>
            {userChartError && <div className="mt-3 rounded-xl border border-red-400/50 bg-red-950/30 p-3 text-2xl text-red-100">{userChartError}</div>}
          </div>

          <div className={panelClass}>
            <p className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>Planning</p>
            <h2 className="mt-2 text-2xl font-semibold">Voyage Inputs</h2>
            <label className={`mt-4 block text-2xl font-bold ${muted}`}>Departure date/time
              <input type="datetime-local" value={departure} onChange={event => setDeparture(event.target.value)} className={inputClass} />
            </label>
            <label className={`mt-3 block text-2xl font-bold ${muted}`}>Planning speed, kt
              <input type="number" min="1" step="0.1" value={plannedSpeed} onChange={event => setPlannedSpeed(event.target.value)} className={inputClass} />
            </label>
            <div className={`mt-4 text-2xl ${muted}`}>{ami ? `AMI loaded: ${ami.sourceName}` : "AMI weather is pulled from the current NavDash AMI overlay."}</div>
          </div>
        </section>

        <section className="no-print mt-4 grid gap-4 lg:grid-cols-2">
          <label className={panelClass}>
            <div className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>Bridge Team / Watch Notes</div>
            <textarea value={opsNotes} onChange={event => setOpsNotes(event.target.value)} placeholder="Traffic, machinery limitations, visibility triggers, master's standing instructions, watch items..." className={`${inputClass} min-h-36`} />
          </label>
          <label className={panelClass}>
            <div className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>Arrival / Port / Pilotage Notes</div>
            <textarea value={portNotes} onChange={event => setPortNotes(event.target.value)} placeholder="Pilot station, reporting, berth, local hazards, arrival restrictions..." className={`${inputClass} min-h-36`} />
          </label>
        </section>

        <section className={`${panelClass} navbrief-print mt-4`}>
          <div className="border-b border-white/10 pb-4 print:border-black/20">
            <div className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>NavDash Navigation Brief</div>
            <h2 className="mt-2 text-4xl font-black">{route?.routeName || "No route loaded"}</h2>
            <p className={`mt-2 text-2xl ${muted}`}>Generated: {formatDateTime(new Date())}</p>
          </div>

          {!route ? (
            <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-950/30 p-4 text-2xl">Load an RTZ or use the current NavDash route to build the brief.</div>
          ) : (
            <div className="mt-5 space-y-7">
              <div>
                <h3 className="text-2xl font-black">Voyage Overview</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className={`${innerCardClass} print-card`}><div className={`text-2xl font-bold uppercase ${muted}`}>Departure</div><div className="mt-2 text-2xl font-black">{origin?.name}</div></div>
                  <div className={`${innerCardClass} print-card`}><div className={`text-2xl font-bold uppercase ${muted}`}>Destination</div><div className="mt-2 text-2xl font-black">{destination?.name}</div></div>
                  <div className={`${innerCardClass} print-card`}><div className={`text-2xl font-bold uppercase ${muted}`}>Distance / Speed</div><div className="mt-2 text-2xl font-black">{distanceNm.toFixed(1)} NM / {speed.toFixed(1)} kt</div></div>
                  <div className={`${innerCardClass} print-card`}><div className={`text-2xl font-bold uppercase ${muted}`}>ETA</div><div className="mt-2 text-2xl font-black">{formatDateTime(eta)}</div></div>
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-black">Weather Routing Strategy</h3>
                <div className={`${innerCardClass} print-card mt-3 text-2xl leading-relaxed`}>
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
                  </> : "No AMI route forecast is currently loaded."}
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-black">Routing Decision Points</h3>
                <div className={`${innerCardClass} print-card mt-3 text-2xl leading-relaxed`}>
                  {relevantMarks.length ? relevantMarks.map(mark => <div key={mark.id}>• <b>{mark.name}</b> · {formatCoord(mark.lat, true)} / {formatCoord(mark.lon, false)} · nearest route waypoint {mark.routeDistance.toFixed(1)} NM</div>) : "No user-chart marks are loaded."}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div><h3 className="text-2xl font-black">Bridge Team Intent</h3><div className={`${innerCardClass} print-card mt-3 min-h-24 whitespace-pre-wrap text-2xl leading-relaxed`}>{opsNotes.trim() || "Maintain the planned RTZ track, continuously compare actual conditions against AMI guidance, and reassess route execution when observed conditions materially differ from forecast."}</div></div>
                <div><h3 className="text-2xl font-black">Navigation</h3><div className={`${innerCardClass} print-card mt-3 min-h-24 whitespace-pre-wrap text-2xl leading-relaxed`}>{portNotes.trim() || `Route contains ${route.waypoints.length} waypoints and ${legs.length} legs. Confirm charted hazards, reporting requirements, pilotage and arrival restrictions against current official publications before execution.`}</div></div>
              </div>

              {ami && <div>
                <h3 className="text-2xl font-black">AMI Weather Along Route</h3>
                <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 print:border-black">
                  <table className="w-full border-collapse text-lg">
                    <thead><tr><th className="border border-white/10 px-2 py-2 text-left print:border-black">Valid</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Position</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Wind</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Seas</th><th className="border border-white/10 px-2 py-2 text-left print:border-black">Conditions</th></tr></thead>
                    <tbody>{ami.forecastPoints.map((point, index) => <tr key={`${point.validAt}-${index}`}><td className="border border-white/10 px-2 py-2 print:border-black">{formatUtc(point.validAt)}</td><td className="border border-white/10 px-2 py-2 font-mono print:border-black">{point.lat.toFixed(2)}°, {point.lon.toFixed(2)}°</td><td className="border border-white/10 px-2 py-2 print:border-black">{String(point.windDirectionDeg).padStart(3, "0")}° / {point.windSpeedKt} kt G {point.gustKt}</td><td className="border border-white/10 px-2 py-2 print:border-black">{point.significantWaveM.toFixed(1)} m @ {point.significantWavePeriodSec}s</td><td className="border border-white/10 px-2 py-2 print:border-black">{point.conditions}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>}

              <div>
                <h3 className="text-2xl font-black">Route Legs</h3>
                <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 print:border-black">
                  <table className="w-full border-collapse text-lg">
                    <thead><tr><th className="border border-white/10 px-3 py-2 text-left print:border-black">Leg</th><th className="border border-white/10 px-3 py-2 text-left print:border-black">From</th><th className="border border-white/10 px-3 py-2 text-left print:border-black">To</th><th className="border border-white/10 px-3 py-2 text-right print:border-black">Course</th><th className="border border-white/10 px-3 py-2 text-right print:border-black">Distance</th></tr></thead>
                    <tbody>{legs.map((leg, index) => <tr key={`${leg.from.id}-${leg.to.id}-${index}`}><td className="border border-white/10 px-3 py-2 print:border-black">{index + 1}</td><td className="border border-white/10 px-3 py-2 print:border-black">{leg.from.name}</td><td className="border border-white/10 px-3 py-2 print:border-black">{leg.to.name}</td><td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">{String(Math.round(leg.bearing)).padStart(3, "0")}°</td><td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">{leg.distance.toFixed(1)} NM</td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <div className="print-card rounded-xl border-2 border-[#c9a227]/60 bg-[#c9a227]/10 p-4 text-center text-2xl font-black">ROUTING PRINCIPLE: Preserve safe navigation first. Use the RTZ as the planned track, the user chart as bridge-team context, and AMI weather as forecast guidance. Reassess whenever actual conditions, traffic, navigation hazards or official information invalidate the plan.</div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
