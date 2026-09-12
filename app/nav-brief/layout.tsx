"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AmiForecastPoint, AmiRouteForecast } from "../../lib/amiRouteForecast";

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
type TidePair = { departure: TideResult | null; arrival: TideResult | null; loading: boolean; error: string };
type LocalZone = { iana?: string; offsetHours?: number };

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";

function toRad(value: number) { return value * Math.PI / 180; }
function distanceNm(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon), lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
function totalDistance(route: Waypoint[]) { return route.slice(1).reduce((sum, waypoint, index) => sum + distanceNm(route[index], waypoint), 0); }
function normalizeRoute(payload: any): RouteBrief | null {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${index + 1}`), name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude), lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || "NavDash Route"), waypoints } : null;
}
function readCurrentRoute() {
  try { const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY); return raw ? normalizeRoute(JSON.parse(raw)) : null; } catch { return null; }
}
function readAmi() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY) || "null") as AmiRouteForecast | null;
    return parsed?.version === 1 && Array.isArray(parsed.forecastPoints) ? parsed : null;
  } catch { return null; }
}
function getAttr(node: Element, names: string[]) { for (const name of names) { const value = node.getAttribute(name); if (value) return value; } return null; }
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

function zoneForPosition(lat: number, lon: number): LocalZone {
  if (lat >= 18 && lat <= 23.5 && lon >= -161.5 && lon <= -154) return { iana: "Pacific/Honolulu" };
  if (lat >= 12 && lat <= 22 && lon >= 143 && lon <= 146.5) return { iana: "Pacific/Guam" };
  if (lat >= 17 && lat <= 20 && lon >= -68 && lon <= -64) return { iana: "America/Puerto_Rico" };
  if (lat >= 50 && lat <= 72 && lon >= -170 && lon <= -130) return { iana: "America/Anchorage" };
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon < -114) return { iana: "America/Los_Angeles" };
  if (lat >= 24 && lat <= 50 && lon >= -114 && lon < -100) return { iana: "America/Denver" };
  if (lat >= 24 && lat <= 50 && lon >= -100 && lon < -84) return { iana: "America/Chicago" };
  if (lat >= 24 && lat <= 50 && lon >= -84 && lon <= -66) return { iana: "America/New_York" };
  return { offsetHours: Math.max(-12, Math.min(14, Math.round(lon / 15))) };
}
function zoneLabel(date: Date, zone: LocalZone) {
  if (zone.iana) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone.iana, timeZoneName: "short" }).formatToParts(date);
    return parts.find(part => part.type === "timeZoneName")?.value || zone.iana;
  }
  const offset = zone.offsetHours || 0;
  return offset === 0 ? "UTC" : `UTC${offset > 0 ? "+" : ""}${offset}`;
}
function formatLocal(date: Date | null, point: Pick<Waypoint, "lat" | "lon"> | null | undefined, includeYear = false) {
  if (!date || !point || !Number.isFinite(date.getTime())) return "--";
  const zone = zoneForPosition(point.lat, point.lon);
  if (zone.iana) {
    const text = date.toLocaleString("en-US", { timeZone: zone.iana, ...(includeYear ? { year: "numeric" as const } : {}), month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${text} ${zoneLabel(date, zone)}`;
  }
  const adjusted = new Date(date.getTime() + (zone.offsetHours || 0) * 3600000);
  const text = adjusted.toLocaleString("en-US", { timeZone: "UTC", ...(includeYear ? { year: "numeric" as const } : {}), month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${text} ${zoneLabel(date, zone)}`;
}
function formatLocalValue(value: string, point: Pick<Waypoint, "lat" | "lon">) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatLocal(date, point) : value;
}
function oldUtc(value: string) {
  const date = new Date(value);
  return !Number.isFinite(date.getTime()) ? value : date.toLocaleString("en-US", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + "Z";
}
function maxBy(points: AmiForecastPoint[], getter: (p: AmiForecastPoint) => number) { return points.reduce<AmiForecastPoint | null>((best, point) => !best || getter(point) > getter(best) ? point : best, null); }
function replaceText(root: Element, from: string, to: string) {
  if (!from || from === to) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to);
}

async function fetchTide(point: Waypoint, at: Date): Promise<TideResult> {
  const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), at: at.toISOString() });
  const response = await fetch(`/api/nav-brief-tides?${params}`, { cache: "no-store" });
  const json = await response.json() as TideResult;
  if (!response.ok || !json.ok) throw new Error(json.error || `Tide lookup returned ${response.status}`);
  return json;
}
function formatEvent(event: TideEvent, point: Pick<Waypoint, "lat" | "lon">) {
  const label = event.type === "H" ? "High Tide" : event.type === "L" ? "Low Tide" : event.type;
  return `${label} · ${formatLocalValue(event.time, point)} · ${event.valueFt.toFixed(1)} ft`;
}
function TideCard({ title, result, target }: { title: string; result: TideResult | null; target: Date | null }) {
  if (!target) return <div className="print-sub print-avoid border border-white/10 p-3"><div className="text-[12px] font-black">{title}</div><div className="mt-2 text-[11px] text-[#8294a5]">Set departure time to calculate tide conditions.</div></div>;
  if (!result?.station) return <div className="print-sub print-avoid border border-white/10 p-3"><div className="text-[12px] font-black">{title}</div><div className="mt-2 text-[11px] text-[#8294a5]">NOAA tide data unavailable.</div></div>;
  const point = result.station;
  return <div className="print-sub print-avoid border border-white/10 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-[12px] font-black">{title}</div><div className="font-mono text-[10px] text-[#42d3c8]">{result.trend || "UNKNOWN"}</div></div>
    <div className="mt-2 text-[11px] leading-5 text-[#8294a5]">
      <b>{result.station.name}</b> · NOAA {result.station.id} · {(result.station.distanceNm ?? 0).toFixed(1)} NM from route endpoint<br/>
      Target · {formatLocal(target, point)} · Datum MLLW
      <div className="mt-1 space-y-[1px]">{(result.events || []).map((event, index) => <div key={`${event.time}-${index}`}>{formatEvent(event, point)}</div>)}</div>
      {result.representativeWarning ? <><div className="mt-1"><b>Station caution:</b> {result.representativeWarning}</div></> : null}
    </div>
  </div>;
}

function NavBriefEnhancer() {
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
        target = document.createElement("div"); target.id = "navbrief-tides-mount";
        const first = content.firstElementChild; if (first) first.insertAdjacentElement("afterend", target); else content.appendChild(target);
      }
      setMount(target);
    };
    ensureMount(); observer = new MutationObserver(ensureMount); observer.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const refreshInputs = () => {
      const page = document.querySelector(".navdash-navbrief-console");
      const departureInput = page?.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
      const speedInput = page?.querySelector('input[type="number"]') as HTMLInputElement | null;
      setDeparture(departureInput?.value || "");
      const parsedSpeed = Number(speedInput?.value); setSpeed(Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 10);
    };
    const initial = readCurrentRoute(); if (initial) setRoute(initial); refreshInputs();
    const handleChange = async (event: Event) => {
      const input = event.target as HTMLInputElement | null; if (!input) return;
      if (input.type === "datetime-local" || input.type === "number") refreshInputs();
      if (input.type === "file" && input.files?.[0] && /\.rtz$|\.xml$|\.txt$/i.test(input.files[0].name) && (input.accept || "").includes(".rtz")) {
        const parsed = parseRtz(await input.files[0].text()); if (parsed) setRoute(parsed);
      }
    };
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button"); if (!button || !/use current navdash route/i.test(button.textContent || "")) return;
      window.setTimeout(async () => {
        const local = readCurrentRoute(); if (local) { setRoute(local); return; }
        try { const response = await fetch("/api/route-state", { cache: "no-store" }); if (response.ok) { const remote = normalizeRoute(await response.json()); if (remote) setRoute(remote); } } catch {}
      }, 150);
    };
    document.addEventListener("change", handleChange, true); document.addEventListener("input", refreshInputs, true); document.addEventListener("click", handleClick, true);
    return () => { document.removeEventListener("change", handleChange, true); document.removeEventListener("input", refreshInputs, true); document.removeEventListener("click", handleClick, true); };
  }, []);

  const departureDate = useMemo(() => departure ? new Date(departure) : null, [departure]);
  const eta = useMemo(() => route && departureDate && Number.isFinite(departureDate.getTime()) ? new Date(departureDate.getTime() + totalDistance(route.waypoints) / speed * 3600000) : null, [route, departureDate, speed]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!route || !departureDate || !eta || !Number.isFinite(departureDate.getTime())) { setTides({ departure: null, arrival: null, loading: false, error: "" }); return; }
      setTides(current => ({ ...current, loading: true, error: "" }));
      try {
        const [dep, arr] = await Promise.all([fetchTide(route.waypoints[0], departureDate), fetchTide(route.waypoints[route.waypoints.length - 1], eta)]);
        if (!cancelled) setTides({ departure: dep, arrival: arr, loading: false, error: "" });
      } catch (error) { if (!cancelled) setTides({ departure: null, arrival: null, loading: false, error: error instanceof Error ? error.message : "NOAA tide lookup failed." }); }
    }
    void load(); return () => { cancelled = true; };
  }, [route, departureDate?.getTime(), eta?.getTime()]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const panel = document.querySelector(".navdash-navbrief-console .print-panel");
      if (!panel || !route) return;
      const origin = route.waypoints[0], destination = route.waypoints[route.waypoints.length - 1];
      const cards = Array.from(panel.querySelectorAll(".print-sub"));
      for (const card of cards) {
        const label = card.firstElementChild?.textContent?.trim().toUpperCase();
        const value = card.children[1] as HTMLElement | undefined;
        if (label === "DEPARTURE" && value && departureDate) value.textContent = `${origin.name || "DEPARTURE"} · ${formatLocal(departureDate, origin)}`;
        if (label === "ETA" && value && eta) value.textContent = formatLocal(eta, destination, true);
      }
      const ami = readAmi();
      if (ami) {
        replaceText(panel, oldUtc(ami.issuedAt), formatLocalValue(ami.issuedAt, origin));
        const strongestWind = maxBy(ami.forecastPoints, p => p.windSpeedKt);
        const highestSea = maxBy(ami.forecastPoints, p => p.significantWaveM);
        if (strongestWind) replaceText(panel, oldUtc(strongestWind.validAt), formatLocalValue(strongestWind.validAt, strongestWind));
        if (highestSea) replaceText(panel, oldUtc(highestSea.validAt), formatLocalValue(highestSea.validAt, highestSea));
        const rows = Array.from(panel.querySelectorAll("table tbody tr"));
        const weatherRows = rows.slice(0, ami.forecastPoints.length);
        weatherRows.forEach((row, index) => {
          const point = ami.forecastPoints[index]; const cell = row.children[0] as HTMLElement | undefined;
          if (point && cell) cell.textContent = formatLocalValue(point.validAt, point);
        });
      }
      const departureLabel = document.querySelector('.navdash-navbrief-console label input[type="datetime-local"]')?.parentElement;
      if (departureLabel && origin) {
        const zone = zoneForPosition(origin.lat, origin.lon);
        const labelText = `Departure · local ${zone.iana ? zoneLabel(departureDate || new Date(), zone) : zoneLabel(new Date(), zone)}`;
        for (const node of Array.from(departureLabel.childNodes)) if (node.nodeType === Node.TEXT_NODE && /departure/i.test(node.nodeValue || "")) node.nodeValue = labelText;
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [route, departureDate?.getTime(), eta?.getTime(), tides.loading]);

  if (!mount) return null;
  return createPortal(<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
    {tides.loading ? <div className="col-span-full print-sub border border-white/10 p-3 text-[11px] text-[#8294a5]">Loading NOAA departure / arrival tide predictions...</div> : null}
    {tides.error ? <div className="col-span-full print-sub border border-white/10 p-3 text-[11px] text-red-300">NOAA tides: {tides.error}</div> : null}
    {!tides.loading ? <><TideCard title="DEPARTURE TIDES" result={tides.departure} target={departureDate} /><TideCard title="ARRIVAL TIDES" result={tides.arrival} target={eta} /></> : null}
  </div>, mount);
}

export default function NavBriefLayout({ children }: { children: ReactNode }) { return <>{children}<NavBriefEnhancer /></>; }
