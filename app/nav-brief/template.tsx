"use client";

import { ReactNode, useEffect } from "react";

type WxWaypoint = { id?: string; name?: string; lat: number; lon: number };
type WxRoute = { routeName?: string; waypoints: WxWaypoint[] };
type WxRow = {
  valid?: string;
  windKt?: number | null;
  windDir?: number | null;
  gustKt?: number | null;
  seasFt?: number | null;
  swellPeriod?: number | null;
  forecast?: string;
};
type WxObservation = { waypoint: WxWaypoint; eta: Date; row: WxRow; sourcePoint?: string };

const WX_ROUTE_CACHE_KEY = "navdash-wx-routing-route";
const WX_GRIB_CACHE_KEY = "navdash-wx-routing-grib";
const WX_SOURCE_KEY = "navdash-wx-routing-source";
const NAV_ROUTE_STORAGE_KEY = "navconsole-saved-route";

function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(isLat ? 2 : 3, "0")}° ${min.toFixed(3)}' ${hemi}`;
}

function formatEta(date: Date) {
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function printTables() {
  return Array.from(document.querySelectorAll<HTMLTableElement>(".print-panel table"));
}

function tableHeaders(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("thead th")).map(cell => (cell.textContent || "").trim().toUpperCase());
}

function formatWeatherPositions() {
  for (const table of printTables()) {
    const headers = tableHeaders(table);
    const positionIndex = headers.indexOf("POSITION");
    if (positionIndex < 0 || !headers.includes("WIND") || !headers.includes("SEAS")) continue;

    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      const cell = cells[positionIndex];
      if (!cell) continue;
      const match = (cell.textContent || "").trim().match(/^(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?$/);
      if (!match) continue;
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const formatted = `${formatCoord(lat, true)} / ${formatCoord(lon, false)}`;
      if (cell.textContent !== formatted) cell.textContent = formatted;
    }
  }
}

function clarifyWeatherGusts() {
  for (const table of printTables()) {
    const headers = tableHeaders(table);
    const windIndex = headers.indexOf("WIND");
    if (windIndex < 0 || !headers.includes("SEAS") || !headers.includes("POSITION")) continue;

    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      const cell = cells[windIndex];
      if (!cell) continue;
      const current = (cell.textContent || "").trim();
      const clarified = current.replace(/\sG\s+(\d+(?:\.\d+)?)/i, " Gusts $1");
      if (clarified !== current) cell.textContent = clarified;
    }
  }
}

function simplifyAmiIssuedLine() {
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".print-sub"));
  for (const panel of panels) {
    const heading = Array.from(panel.querySelectorAll("div")).find(div => (div.textContent || "").trim().toUpperCase() === "WEATHER INFORMATION");
    if (!heading) continue;
    const detail = heading.nextElementSibling;
    if (!(detail instanceof HTMLElement)) continue;

    const nodes = Array.from(detail.childNodes);
    const firstBreakIndex = nodes.findIndex(node => node.nodeName === "BR");
    const leadNodes = firstBreakIndex >= 0 ? nodes.slice(0, firstBreakIndex) : nodes;
    const leadText = leadNodes.map(node => node.textContent || "").join("").trim();
    const match = leadText.match(/ISSUED\s+(.+)$/i);
    if (!match) continue;

    const simplified = `AMI Weather Issued: ${match[1].trim()}`;
    if (leadText === simplified) continue;

    for (const node of leadNodes) node.remove();
    detail.insertBefore(document.createTextNode(simplified), detail.firstChild);
  }
}

function addWaypointEtas() {
  const page = document.querySelector(".navdash-navbrief-console");
  if (!page) return;

  const departureInput = page.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
  const speedInput = page.querySelector('input[type="number"]') as HTMLInputElement | null;
  const departure = departureInput?.value ? new Date(departureInput.value) : null;
  const speed = Number(speedInput?.value);
  const hasTiming = Boolean(departure && Number.isFinite(departure.getTime()) && Number.isFinite(speed) && speed > 0);

  for (const table of printTables()) {
    let headers = tableHeaders(table);
    if (!headers.includes("LEG") || !headers.includes("FROM") || !headers.includes("TO") || !headers.includes("DIST")) continue;

    const headRow = table.querySelector("thead tr");
    if (!headRow) continue;

    let etaIndex = headers.indexOf("ETA @ TO");
    if (etaIndex < 0) {
      const referenceHeader = headRow.querySelector("th:last-child");
      const etaHeader = document.createElement("th");
      etaHeader.textContent = "ETA @ TO";
      etaHeader.dataset.navbriefEta = "header";
      etaHeader.className = referenceHeader?.className || "border border-white/10 px-2 py-2 text-left";
      headRow.appendChild(etaHeader);
      headers = tableHeaders(table);
      etaIndex = headers.indexOf("ETA @ TO");
    }

    const distIndex = headers.indexOf("DIST");
    let cumulativeNm = 0;

    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td"));
      const distanceText = cells[distIndex]?.textContent || "";
      const distance = Number(distanceText.match(/-?\d+(?:\.\d+)?/)?.[0]);
      if (Number.isFinite(distance)) cumulativeNm += distance;

      let etaCell = row.querySelector<HTMLTableCellElement>('td[data-navbrief-eta="cell"]');
      if (!etaCell) {
        const referenceCell = cells[cells.length - 1];
        etaCell = document.createElement("td");
        etaCell.dataset.navbriefEta = "cell";
        etaCell.className = referenceCell?.className || "border border-white/10 px-2 py-2";
        etaCell.classList.remove("text-right");
        etaCell.classList.add("text-left", "font-mono");
        row.appendChild(etaCell);
      }

      const text = hasTiming && departure
        ? formatEta(new Date(departure.getTime() + cumulativeNm / speed * 3600000))
        : "--";
      if (etaCell.textContent !== text) etaCell.textContent = text;
    }
  }
}

function readJson(storage: Storage, key: string) {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function normalizeWxRoute(payload: any): WxRoute | null {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : Array.isArray(payload?.route?.waypoints) ? payload.route.waypoints : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${index + 1}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: WxWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  return waypoints.length >= 2 ? { routeName: String(payload?.routeName || payload?.name || "NavDash Route"), waypoints } : null;
}

function currentWxRoute() {
  return normalizeWxRoute(readJson(window.sessionStorage, WX_ROUTE_CACHE_KEY))
    || normalizeWxRoute(readJson(window.localStorage, NAV_ROUTE_STORAGE_KEY));
}

function toRad(value: number) { return value * Math.PI / 180; }
function routeDistanceNm(a: WxWaypoint, b: WxWaypoint) {
  const r = 3440.065;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon), lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
function totalRouteDistance(route: WxRoute) {
  return route.waypoints.slice(1).reduce((sum, waypoint, index) => sum + routeDistanceNm(route.waypoints[index], waypoint), 0);
}
function nearestByPosition<T extends { lat: number; lon: number }>(items: T[], point: WxWaypoint) {
  if (!items.length) return null;
  return items.reduce((best, item) => routeDistanceNm(item, point) < routeDistanceNm(best, point) ? item : best, items[0]);
}
function parseWxTime(value?: string) {
  if (!value) return null;
  const normalized = /UTC$/i.test(value) ? value.replace(/\s+UTC$/i, "Z").replace(" ", "T") : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}
function nearestTimelineRow(rows: WxRow[], eta: Date) {
  const valid = rows.filter(row => parseWxTime(row.valid));
  if (!valid.length) return rows[0] || null;
  return valid.reduce((best, row) => {
    const rowTime = parseWxTime(row.valid)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bestTime = parseWxTime(best.valid)?.getTime() ?? Number.POSITIVE_INFINITY;
    return Math.abs(rowTime - eta.getTime()) < Math.abs(bestTime - eta.getTime()) ? row : best;
  }, valid[0]);
}
function compass(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((value % 360) + 360) % 360) / 45) % 8];
}
function windText(row?: WxRow | null) {
  if (!row) return "--";
  const wind = Number(row.windKt);
  const gust = Number(row.gustKt);
  const direction = compass(row.windDir);
  if (!Number.isFinite(wind) && !Number.isFinite(gust)) return "--";
  const base = Number.isFinite(wind) ? `${direction ? `${direction} ` : ""}${Math.round(wind)} kt` : `${Math.round(gust)} kt`;
  return Number.isFinite(gust) && gust > wind ? `${base} G ${Math.round(gust)}` : base;
}
function seaText(row?: WxRow | null) {
  const seas = Number(row?.seasFt);
  if (!Number.isFinite(seas) || seas <= 0) return "--";
  const period = Number(row?.swellPeriod);
  return `${seas.toFixed(1)} ft${Number.isFinite(period) && period > 0 ? ` @ ${period.toFixed(0)} s` : ""}`;
}
function localWxTime(date: Date) {
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function gribObservations(route: WxRoute, summary: any, departure: Date, speed: number): WxObservation[] {
  const points = Array.isArray(summary?.routeForecast?.routePoints) ? summary.routeForecast.routePoints : [];
  if (!points.length) return [];
  let cumulative = 0;
  return route.waypoints.map((waypoint, index) => {
    if (index > 0) cumulative += routeDistanceNm(route.waypoints[index - 1], waypoint);
    const eta = new Date(departure.getTime() + cumulative / speed * 3600000);
    const point = nearestByPosition(points, waypoint) as any;
    const row = point ? nearestTimelineRow(Array.isArray(point.timeline) ? point.timeline : [], eta) : null;
    return row ? { waypoint, eta, row, sourcePoint: point?.name || point?.id || "" } : null;
  }).filter(Boolean) as WxObservation[];
}

function noaaObservations(route: WxRoute, data: any, departure: Date, speed: number): WxObservation[] {
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  if (!frames.length) return [];
  let cumulative = 0;
  return route.waypoints.map((waypoint, index) => {
    if (index > 0) cumulative += routeDistanceNm(route.waypoints[index - 1], waypoint);
    const eta = new Date(departure.getTime() + cumulative / speed * 3600000);
    const frame = frames.reduce((best: any, candidate: any) => {
      const bestTime = new Date(best?.validAt || 0).getTime();
      const nextTime = new Date(candidate?.validAt || 0).getTime();
      return Math.abs(nextTime - eta.getTime()) < Math.abs(bestTime - eta.getTime()) ? candidate : best;
    }, frames[0]);
    const points = Array.isArray(frame?.points) ? frame.points : [];
    const point = nearestByPosition(points.map((p: any) => ({ ...p, lon: Number(p.lon), lat: Number(p.lat) })), waypoint) as any;
    if (!point) return null;
    const row: WxRow = {
      valid: frame?.validAt,
      windKt: Number.isFinite(Number(point.windKt)) ? Number(point.windKt) : null,
      windDir: Number.isFinite(Number(point.windDirectionDeg)) ? Number(point.windDirectionDeg) : null,
      gustKt: Number.isFinite(Number(point.gustKt)) ? Number(point.gustKt) : null,
      seasFt: Number.isFinite(Number(point.waveHeightFt)) && Number(point.waveHeightFt) > 0 ? Number(point.waveHeightFt) : null,
      swellPeriod: Number.isFinite(Number(point.wavePeriodSec)) ? Number(point.wavePeriodSec) : null,
      forecast: point.source || data?.product || "NOAA / NWS",
    };
    return { waypoint, eta, row, sourcePoint: point.source || "NOAA sample" };
  }).filter(Boolean) as WxObservation[];
}

function ensureWeatherCard() {
  const content = document.querySelector(".navdash-navbrief-console .print-panel .mt-3.space-y-3");
  if (!(content instanceof HTMLElement)) return null;
  let card = document.getElementById("navbrief-route-weather");
  if (!(card instanceof HTMLElement)) {
    card = document.createElement("div");
    card.id = "navbrief-route-weather";
    card.className = "print-sub print-avoid border border-white/10 p-3";
    const tideMount = document.getElementById("navbrief-tides-mount");
    if (tideMount?.parentElement === content) tideMount.insertAdjacentElement("afterend", card);
    else content.insertBefore(card, content.children[1] || null);
  }
  return card;
}

function setWeatherCardMessage(message: string) {
  const card = ensureWeatherCard();
  if (!card) return;
  card.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "text-[12px] font-black";
  heading.textContent = "ROUTE WEATHER";
  const detail = document.createElement("div");
  detail.className = "mt-2 text-[11px] leading-5 text-[#8294a5]";
  detail.textContent = message;
  card.append(heading, detail);
}

function renderWeatherCard(source: string, observations: WxObservation[]) {
  const card = ensureWeatherCard();
  if (!card || !observations.length) return;
  const departure = observations[0];
  const arrival = observations[observations.length - 1];
  const maxWind = observations.reduce((best, item) => Math.max(item.row.windKt || 0, item.row.gustKt || 0) > Math.max(best.row.windKt || 0, best.row.gustKt || 0) ? item : best, observations[0]);
  const maxSeas = observations.reduce((best, item) => (item.row.seasFt || 0) > (best.row.seasFt || 0) ? item : best, observations[0]);

  card.replaceChildren();
  const headingRow = document.createElement("div");
  headingRow.className = "flex flex-wrap items-baseline justify-between gap-2";
  const heading = document.createElement("div"); heading.className = "text-[12px] font-black"; heading.textContent = "ROUTE WEATHER";
  const sourceLabel = document.createElement("div"); sourceLabel.className = "font-mono text-[9px] text-[#42d3c8]"; sourceLabel.textContent = source;
  headingRow.append(heading, sourceLabel);

  const detail = document.createElement("div"); detail.className = "mt-2 grid grid-cols-1 gap-x-5 gap-y-1 text-[11px] leading-5 text-[#8294a5] md:grid-cols-2";
  const lines = [
    `Departure · ${windText(departure.row)} · Seas ${seaText(departure.row)}`,
    `Arrival · ${windText(arrival.row)} · Seas ${seaText(arrival.row)}`,
    `Max wind · ${windText(maxWind.row)} near ${maxWind.waypoint.name || maxWind.waypoint.id || "route"} · ${localWxTime(maxWind.eta)}`,
    `Max seas · ${seaText(maxSeas.row)} near ${maxSeas.waypoint.name || maxSeas.waypoint.id || "route"} · ${localWxTime(maxSeas.eta)}`,
  ];
  for (const line of lines) { const div = document.createElement("div"); div.textContent = line; detail.appendChild(div); }
  card.append(headingRow, detail);
}

async function refreshRouteWeather() {
  const page = document.querySelector(".navdash-navbrief-console");
  if (!page) return;
  const route = currentWxRoute();
  const departureInput = page.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
  const speedInput = page.querySelector('input[type="number"]') as HTMLInputElement | null;
  const departure = departureInput?.value ? new Date(departureInput.value) : null;
  const speed = Number(speedInput?.value);
  if (!route) { setWeatherCardMessage("Load the NavDash route or open WX Routing with the route loaded."); return; }
  if (!departure || !Number.isFinite(departure.getTime()) || !Number.isFinite(speed) || speed <= 0) { setWeatherCardMessage("Set departure time and planning speed to match weather to the voyage timeline."); return; }

  const sourceMode = window.localStorage.getItem(WX_SOURCE_KEY) === "noaa" ? "noaa" : "grib";
  try {
    if (sourceMode === "noaa") {
      const response = await fetch("/api/noaa-route-weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints: route.waypoints }), cache: "no-store" });
      if (!response.ok) throw new Error(`NOAA route weather returned ${response.status}`);
      const data = await response.json();
      const observations = noaaObservations(route, data, departure, speed);
      if (!observations.length) throw new Error("No NOAA route samples matched this voyage.");
      renderWeatherCard(String(data?.product || "NOAA / NWS ROUTE WEATHER"), observations);
      return;
    }

    let summary = readJson(window.sessionStorage, WX_GRIB_CACHE_KEY);
    if (!summary?.routeForecast?.routePoints?.length) {
      const response = await fetch("/api/grib-summary", { cache: "no-store" });
      if (!response.ok) throw new Error(`Weather summary returned ${response.status}`);
      summary = await response.json();
    }
    const observations = gribObservations(route, summary, departure, speed);
    if (!observations.length) throw new Error("Open WX Routing once to populate route weather for this route.");
    renderWeatherCard(String(summary?.sourceNotes || summary?.fileName || "WX ROUTING"), observations);
  } catch (error) {
    setWeatherCardMessage(error instanceof Error ? error.message : "Route weather unavailable.");
  }
}

function enhancePrintTables() {
  formatWeatherPositions();
  clarifyWeatherGusts();
  simplifyAmiIssuedLine();
  addWaypointEtas();
}

export default function NavBriefTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    enhancePrintTables();
    void refreshRouteWeather();
    const observer = new MutationObserver(enhancePrintTables);
    observer.observe(document.body, { childList: true, subtree: true });

    let weatherTimer = 0;
    const refresh = () => {
      enhancePrintTables();
      window.clearTimeout(weatherTimer);
      weatherTimer = window.setTimeout(() => { void refreshRouteWeather(); }, 120);
    };
    const refreshAfterClick = () => {
      window.clearTimeout(weatherTimer);
      weatherTimer = window.setTimeout(() => { enhancePrintTables(); void refreshRouteWeather(); }, 220);
    };
    document.addEventListener("input", refresh, true);
    document.addEventListener("change", refresh, true);
    document.addEventListener("click", refreshAfterClick, true);

    return () => {
      observer.disconnect();
      window.clearTimeout(weatherTimer);
      document.removeEventListener("input", refresh, true);
      document.removeEventListener("change", refresh, true);
      document.removeEventListener("click", refreshAfterClick, true);
    };
  }, []);

  return <>{children}</>;
}
