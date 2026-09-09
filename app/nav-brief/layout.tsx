"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };
type RouteBrief = { routeName?: string; waypoints: Waypoint[] };
type TideEvent = { time: string; valueFt: number; type: string };
type TideResult = {
  ok: boolean;
  targetTime?: string;
  station?: { id: string; name: string; lat: number; lon: number; distanceNm?: number };
  datum?: string;
  units?: string;
  trend?: string;
  previous?: TideEvent | null;
  next?: TideEvent | null;
  events?: TideEvent[];
  representativeWarning?: string | null;
  source?: string;
  error?: string;
};

type TidePair = {
  departure: TideResult | null;
  arrival: TideResult | null;
  loading: boolean;
  error: string;
};

const ROUTE_STORAGE_KEY = "navconsole-saved-route";

function toRad(value: number) { return value * Math.PI / 180; }
function distanceNm(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
function totalDistance(route: Waypoint[]) {
  return route.slice(1).reduce((sum, waypoint, index) => sum + distanceNm(route[index], waypoint), 0);
}
function normalizeRoute(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${index + 1}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || "NavDash Route"), waypoints } : null;
}
function readCurrentRoute() {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    return raw ? normalizeRoute(JSON.parse(raw)) : null;
  } catch { return null; }
}
function getAttr(node: Element, names: string[]) {
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
  let value = nums.length >= 3 ? Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600 : nums.length >= 2 ? Math.abs(nums[0]) + nums[1] / 60 : nums[0];
  if (hemi === "S" || hemi === "W" || (!hemi && nums[0] < 0)) value *= -1;
  return isLat && Math.abs(value) > 90 || !isLat && Math.abs(value) > 180 ? NaN : value;
}
function parseRtz(text: string): RouteBrief | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeName = getAttr(routeNode, ["name", "Name", "id", "ID"]) || "Loaded RTZ Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    return { id: getAttr(node, ["id", "ID"]) || `WP${index + 1}`, name: getAttr(node, ["name", "Name"]) || `Waypoint ${index + 1}`, lat, lon };
  }).filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  return waypoints.length >= 2 ? { routeName, waypoints } : null;
}
function formatEvent(event: TideEvent) {
  const date = new Date(event.time);
  const label = event.type === "H" ? "HW" : event.type === "L" ? "LW" : event.type;
  const dateText = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "2-digit" });
  const timeText = date.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${label} ${dateText} ${timeText}Z · ${event.valueFt.toFixed(1)} ft`;
}
async function fetchTide(point: Waypoint, at: Date): Promise<TideResult> {
  const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), at: at.toISOString() });
  const response = await fetch(`/api/nav-brief-tides?${params}`, { cache: "no-store" });
  const json = await response.json() as TideResult;
  if (!response.ok || !json.ok) throw new Error(json.error || `Tide lookup returned ${response.status}`);
  return json;
}

function TideCard({ title, result, target }: { title: string; result: TideResult | null; target: Date | null }) {
  if (!target) return <div className="print-sub border border-white/10 p-3"><div className="text-[12px] font-black">{title}</div><div className="mt-2 text-[11px] text-[#8294a5]">Set departure time to calculate tide conditions.</div></div>;
  if (!result?.station) return <div className="print-sub border border-white/10 p-3"><div className="text-[12px] font-black">{title}</div><div className="mt-2 text-[11px] text-[#8294a5]">NOAA tide data unavailable.</div></div>;
  return <div className="print-sub border border-white/10 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="text-[12px] font-black">{title}</div>
      <div className="font-mono text-[10px] text-[#42d3c8]">{result.trend || "UNKNOWN"}</div>
    </div>
    <div className="mt-2 text-[11px] leading-5 text-[#8294a5]">
      <b>{result.station.name}</b> · NOAA {result.station.id} · {(result.station.distanceNm ?? 0).toFixed(1)} NM from route endpoint<br/>
      Target · {target.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}Z · Datum MLLW<br/>
      {(result.events || []).map((event, index) => <span key={`${event.time}-${index}`}>{formatEvent(event)}{index < (result.events?.length || 0) - 1 ? " · " : ""}</span>)}
      {result.representativeWarning ? <><br/><b>Station caution:</b> {result.representativeWarning}</> : null}
    </div>
  </div>;
}

function NavBriefTideEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [departure, setDeparture] = useState("");
  const [speed, setSpeed] = useState(10);
  const [tides, setTides] = useState<TidePair>({ departure: null, arrival: null, loading: false, error: "" });

  useEffect(() => {
    let observer: MutationObserver | null = null;
    const ensureMount = () => {
      const consolePage = document.querySelector(".navdash-navbrief-console");
      if (!consolePage) return;
      const content = consolePage.querySelector(".print-panel .mt-3.space-y-3");
      if (!(content instanceof HTMLElement)) return;
      let target = document.getElementById("navbrief-tides-mount");
      if (!(target instanceof HTMLElement)) {
        target = document.createElement("div");
        target.id = "navbrief-tides-mount";
        const first = content.firstElementChild;
        if (first) first.insertAdjacentElement("afterend", target); else content.appendChild(target);
      }
      setMount(target);
    };
    ensureMount();
    observer = new MutationObserver(ensureMount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const refreshInputs = () => {
      const page = document.querySelector(".navdash-navbrief-console");
      const departureInput = page?.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
      const speedInput = page?.querySelector('input[type="number"]') as HTMLInputElement | null;
      setDeparture(departureInput?.value || "");
      const parsedSpeed = Number(speedInput?.value);
      setSpeed(Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 10);
    };
    const initial = readCurrentRoute();
    if (initial) setRoute(initial);
    refreshInputs();

    const handleChange = async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input) return;
      if (input.type === "datetime-local" || input.type === "number") refreshInputs();
      if (input.type === "file" && input.files?.[0] && /\.rtz$|\.xml$|\.txt$/i.test(input.files[0].name) && (input.accept || "").includes(".rtz")) {
        const parsed = parseRtz(await input.files[0].text());
        if (parsed) setRoute(parsed);
      }
    };
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button");
      if (!button || !/use current navdash route/i.test(button.textContent || "")) return;
      window.setTimeout(async () => {
        const local = readCurrentRoute();
        if (local) { setRoute(local); return; }
        try {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) {
            const remote = normalizeRoute(await response.json());
            if (remote) setRoute(remote);
          }
        } catch {}
      }, 150);
    };
    document.addEventListener("change", handleChange, true);
    document.addEventListener("input", refreshInputs, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("change", handleChange, true);
      document.removeEventListener("input", refreshInputs, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  const departureDate = useMemo(() => departure ? new Date(departure) : null, [departure]);
  const eta = useMemo(() => {
    if (!route || !departureDate || !Number.isFinite(departureDate.getTime())) return null;
    return new Date(departureDate.getTime() + totalDistance(route.waypoints) / speed * 3600000);
  }, [route, departureDate, speed]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!route || !departureDate || !eta || !Number.isFinite(departureDate.getTime())) {
        setTides({ departure: null, arrival: null, loading: false, error: "" });
        return;
      }
      setTides(current => ({ ...current, loading: true, error: "" }));
      try {
        const [dep, arr] = await Promise.all([
          fetchTide(route.waypoints[0], departureDate),
          fetchTide(route.waypoints[route.waypoints.length - 1], eta),
        ]);
        if (!cancelled) setTides({ departure: dep, arrival: arr, loading: false, error: "" });
      } catch (error) {
        if (!cancelled) setTides({ departure: null, arrival: null, loading: false, error: error instanceof Error ? error.message : "NOAA tide lookup failed." });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [route, departureDate?.getTime(), eta?.getTime()]);

  if (!mount) return null;
  return createPortal(
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {tides.loading ? <div className="col-span-full print-sub border border-white/10 p-3 text-[11px] text-[#8294a5]">Loading NOAA departure / arrival tide predictions...</div> : null}
      {tides.error ? <div className="col-span-full print-sub border border-white/10 p-3 text-[11px] text-red-300">NOAA tides: {tides.error}</div> : null}
      {!tides.loading ? <>
        <TideCard title="DEPARTURE TIDES" result={tides.departure} target={departureDate} />
        <TideCard title="ARRIVAL TIDES" result={tides.arrival} target={eta} />
      </> : null}
    </div>,
    mount,
  );
}

export default function NavBriefLayout({ children }: { children: ReactNode }) {
  return <>{children}<NavBriefTideEnhancer /></>;
}
