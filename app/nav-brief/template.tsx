"use client";

import { ReactNode, useEffect, useRef } from "react";

type WxWaypoint = { id?: string; name?: string; lat: number; lon: number };
type WxRoute = { routeName?: string; waypoints: WxWaypoint[] };
type ForecastPoint = {
  lat?: number;
  lon?: number;
  distanceNm?: number;
  windKt?: number | null;
  windDirectionDeg?: number | null;
  gustKt?: number | null;
  waveHeightFt?: number | null;
  wavePeriodSec?: number | null;
  waveDirectionDeg?: number | null;
};
type WeatherFrame = { validAt: string; points: ForecastPoint[] };
type WardLabWeather = {
  ok?: boolean;
  source?: string;
  product?: string;
  provider?: string;
  waveOverlay?: boolean;
  frames?: WeatherFrame[];
  error?: string;
};
type WeatherPlan = { departure: Date; speedKt: number; source: string };
type RouteSample = { point: ForecastPoint; eta: Date; distanceNm: number };

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

    if (!headers.includes("ETA @ TO")) {
      const referenceHeader = headRow.querySelector("th:last-child");
      const etaHeader = document.createElement("th");
      etaHeader.textContent = "ETA @ TO";
      etaHeader.dataset.navbriefEta = "header";
      etaHeader.className = referenceHeader?.className || "border border-white/10 px-2 py-2 text-left";
      headRow.appendChild(etaHeader);
      headers = tableHeaders(table);
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

function enhancePrintTables() {
  formatWeatherPositions();
  clarifyWeatherGusts();
  simplifyAmiIssuedLine();
  addWaypointEtas();
}

function normalizeRoute(payload: any): WxRoute | null {
  const raw = Array.isArray(payload?.waypoints)
    ? payload.waypoints
    : Array.isArray(payload?.route?.waypoints)
      ? payload.route.waypoints
      : [];
  const waypoints = raw.map((wp: any, index: number) => ({
    id: String(wp?.id || `WP${index + 1}`),
    name: String(wp?.name || wp?.id || `Waypoint ${index + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: WxWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  return waypoints.length >= 2
    ? { routeName: String(payload?.routeName || payload?.name || payload?.route?.routeName || "Nav Brief Route"), waypoints }
    : null;
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
  if (isLat && Math.abs(value) > 90) return NaN;
  if (!isLat && Math.abs(value) > 180) return NaN;
  return value;
}

function parseRtz(text: string): WxRoute | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const routeNode = doc.querySelector("route,Route") || doc.documentElement;
  const routeInfo = doc.querySelector("routeInfo,RouteInfo");
  const routeName = getAttr(routeInfo, ["routeName", "RouteName", "name", "Name"])
    || getAttr(routeNode, ["routeName", "RouteName", "name", "Name", "id", "ID"])
    || "Loaded RTZ Route";
  const waypoints = Array.from(doc.querySelectorAll("waypoint,Waypoint,wp,WP")).map((node, index) => {
    const pos = node.querySelector("position,Position,pos") || node;
    const lat = parseCoordinate(getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) || getAttr(node, ["lat", "Lat", "latitude", "Latitude"]), true);
    const lon = parseCoordinate(getAttr(pos, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]) || getAttr(node, ["lon", "Lon", "longitude", "Longitude", "long", "Long"]), false);
    return {
      id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${index + 1}`,
      name: getAttr(node, ["name", "Name", "waypointName", "WaypointName"]) || node.querySelector("name,Name,waypointName,WaypointName")?.textContent?.trim() || `Waypoint ${index + 1}`,
      lat,
      lon,
    };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  return waypoints.length >= 2 ? { routeName, waypoints } : null;
}

function localNavDashRoute() {
  try {
    const raw = window.localStorage.getItem(NAV_ROUTE_STORAGE_KEY);
    return raw ? normalizeRoute(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function remoteNavDashRoute() {
  try {
    const response = await fetch("/api/route-state", { cache: "no-store" });
    return response.ok ? normalizeRoute(await response.json()) : null;
  } catch {
    return null;
  }
}

function navBriefPlan(): WeatherPlan | null {
  const page = document.querySelector(".navdash-navbrief-console");
  const departureInput = page?.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
  const speedInput = page?.querySelector('input[type="number"]') as HTMLInputElement | null;
  const departure = departureInput?.value ? new Date(departureInput.value) : null;
  const speedKt = Number(speedInput?.value);
  if (departure && Number.isFinite(departure.getTime()) && Number.isFinite(speedKt) && speedKt > 0) {
    return { departure, speedKt, source: "NAV BRIEF PLAN" };
  }
  return null;
}

async function sharedWeatherPlan(): Promise<WeatherPlan | null> {
  try {
    const response = await fetch("/api/weather-plan-state", { cache: "no-store" });
    if (!response.ok) return null;
    const json = await response.json();
    const departure = json?.departure ? new Date(json.departure) : null;
    const speedKt = Number(json?.speedKt);
    if (departure && Number.isFinite(departure.getTime()) && Number.isFinite(speedKt) && speedKt > 0) {
      return { departure, speedKt, source: "WX.WARDLAB.DEV PLAN" };
    }
  } catch {}
  return null;
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

function setWeatherMessage(message: string) {
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

function compass(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const normalized = ((Number(value) % 360) + 360) % 360;
  return points[Math.round(normalized / 22.5) % 16];
}

function windText(point: ForecastPoint) {
  const wind = Number(point.windKt);
  const gust = Number(point.gustKt);
  const dir = compass(point.windDirectionDeg);
  const hasWind = Number.isFinite(wind);
  const hasGust = Number.isFinite(gust);
  if (!hasWind && !hasGust) return "Wind --";
  const base = hasWind ? `${dir ? `${dir} ` : ""}${wind.toFixed(0)} kt` : `${gust.toFixed(0)} kt`;
  return hasGust && (!hasWind || gust > wind) ? `${base} gust ${gust.toFixed(0)} kt` : base;
}

function seaText(point: ForecastPoint) {
  const height = Number(point.waveHeightFt);
  const period = Number(point.wavePeriodSec);
  const dir = compass(point.waveDirectionDeg);
  if (!Number.isFinite(height) || height <= 0) return "Seas --";
  return `Seas ${height.toFixed(1)} ft${Number.isFinite(period) && period > 0 ? ` @ ${period.toFixed(0)} s` : ""}${dir ? ` ${dir}` : ""}`;
}

function routeZone(route: WxRoute) {
  const first = route.waypoints[0];
  if (first && first.lat >= 18 && first.lat <= 23.5 && first.lon >= -161.5 && first.lon <= -154) return { timeZone: "Pacific/Honolulu", label: "HST" };
  if (first && first.lat >= 12 && first.lat <= 22 && first.lon >= 143 && first.lon <= 146.5) return { timeZone: "Pacific/Guam", label: "ChST" };
  return null;
}

function timeText(date: Date, route: WxRoute) {
  const zone = routeZone(route);
  if (zone) {
    return `${new Intl.DateTimeFormat("en-US", { timeZone: zone.timeZone, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} ${zone.label}`;
  }
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function nearestFrame(frames: WeatherFrame[], eta: Date) {
  return frames.reduce((best, frame) => {
    const bestDelta = Math.abs(new Date(best.validAt).getTime() - eta.getTime());
    const nextDelta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
    return nextDelta < bestDelta ? frame : best;
  }, frames[0]);
}

function voyageSamples(weather: WardLabWeather, plan: WeatherPlan): RouteSample[] {
  const frames = Array.isArray(weather.frames) ? weather.frames.filter(frame => Array.isArray(frame.points) && frame.points.length) : [];
  if (!frames.length) return [];
  const reference = frames[0].points;
  return reference.map((referencePoint, index) => {
    const distanceNm = Number(referencePoint.distanceNm);
    const distance = Number.isFinite(distanceNm) ? distanceNm : 0;
    const eta = new Date(plan.departure.getTime() + (distance / plan.speedKt) * 3600000);
    const frame = nearestFrame(frames, eta);
    const point = frame.points[index] || frame.points.reduce((best, candidate) => {
      const candidateDistance = Number(candidate.distanceNm);
      const bestDistance = Number(best.distanceNm);
      const candidateDelta = Math.abs((Number.isFinite(candidateDistance) ? candidateDistance : 0) - distance);
      const bestDelta = Math.abs((Number.isFinite(bestDistance) ? bestDistance : 0) - distance);
      return candidateDelta < bestDelta ? candidate : best;
    }, frame.points[0]);
    return point ? { point, eta, distanceNm: distance } : null;
  }).filter(Boolean) as RouteSample[];
}

function renderWeatherCard(weather: WardLabWeather, route: WxRoute, plan: WeatherPlan) {
  const samples = voyageSamples(weather, plan);
  if (!samples.length) {
    setWeatherMessage("The current WardLab weather feed returned no route samples for this RTZ.");
    return;
  }

  const departure = samples[0];
  const arrival = samples[samples.length - 1];
  const maxWind = samples.reduce((best, sample) => {
    const sampleWind = Math.max(Number(sample.point.windKt) || 0, Number(sample.point.gustKt) || 0);
    const bestWind = Math.max(Number(best.point.windKt) || 0, Number(best.point.gustKt) || 0);
    return sampleWind > bestWind ? sample : best;
  }, samples[0]);
  const maxSeas = samples.reduce((best, sample) => (Number(sample.point.waveHeightFt) || 0) > (Number(best.point.waveHeightFt) || 0) ? sample : best, samples[0]);

  const card = ensureWeatherCard();
  if (!card) return;
  card.replaceChildren();

  const headingRow = document.createElement("div");
  headingRow.className = "flex flex-wrap items-baseline justify-between gap-2";
  const heading = document.createElement("div");
  heading.className = "text-[12px] font-black";
  heading.textContent = "ROUTE WEATHER";
  const source = document.createElement("div");
  source.className = "font-mono text-[9px] text-[#42d3c8]";
  source.textContent = weather.waveOverlay ? "WX.WARDLAB.DEV · NOAA + GFS WAVE" : "WX.WARDLAB.DEV · NOAA/NWS";
  headingRow.append(heading, source);

  const planLine = document.createElement("div");
  planLine.className = "mt-1 text-[9px] uppercase tracking-[.08em] text-[#8294a5]";
  planLine.textContent = `${plan.source} · ${plan.speedKt.toFixed(1)} KT · DEP ${timeText(plan.departure, route)}`;

  const detail = document.createElement("div");
  detail.className = "mt-2 grid grid-cols-1 gap-x-5 gap-y-1 text-[11px] leading-5 text-[#8294a5] md:grid-cols-2";
  const lines = [
    `Departure · ${windText(departure.point)} · ${seaText(departure.point)}`,
    `Arrival · ${windText(arrival.point)} · ${seaText(arrival.point)}`,
    `Max wind · ${windText(maxWind.point)} · ${maxWind.distanceNm.toFixed(0)} NM along route · ${timeText(maxWind.eta, route)}`,
    `Max seas · ${seaText(maxSeas.point)} · ${maxSeas.distanceNm.toFixed(0)} NM along route · ${timeText(maxSeas.eta, route)}`,
  ];
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    detail.appendChild(div);
  }
  card.append(headingRow, planLine, detail);
}

export default function NavBriefTemplate({ children }: { children: ReactNode }) {
  const routeRef = useRef<WxRoute | null>(null);
  const weatherTimerRef = useRef<number>(0);
  const requestRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const resolveRoute = async () => {
      if (routeRef.current) return routeRef.current;
      const local = localNavDashRoute();
      if (local) {
        routeRef.current = local;
        return local;
      }
      const remote = await remoteNavDashRoute();
      if (remote) routeRef.current = remote;
      return remote;
    };

    const refreshWeather = async () => {
      const requestId = ++requestRef.current;
      const route = await resolveRoute();
      if (!alive || requestId !== requestRef.current) return;
      if (!route) {
        setWeatherMessage("Load the RTZ on this Nav Brief page, or choose Use Current NavDash Route.");
        return;
      }

      const plan = navBriefPlan() || await sharedWeatherPlan();
      if (!alive || requestId !== requestRef.current) return;
      if (!plan) {
        setWeatherMessage("Set departure time and planning speed in Nav Brief or on wx.wardlab.dev.");
        return;
      }

      try {
        const response = await fetch("/api/nav-brief-route-weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ waypoints: route.waypoints }),
        });
        const weather = await response.json() as WardLabWeather;
        if (!alive || requestId !== requestRef.current) return;
        if (!response.ok || !weather.ok) throw new Error(weather.error || `Weather feed returned ${response.status}`);
        renderWeatherCard(weather, route, plan);
      } catch (error) {
        setWeatherMessage(error instanceof Error ? error.message : "Current WardLab route weather unavailable.");
      }
    };

    const scheduleWeather = (delay = 180) => {
      window.clearTimeout(weatherTimerRef.current);
      weatherTimerRef.current = window.setTimeout(() => { void refreshWeather(); }, delay);
    };

    const handleChange = async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input) return;
      if (input.type === "file" && input.files?.[0] && (input.accept || "").includes(".rtz")) {
        try {
          const parsed = parseRtz(await input.files[0].text());
          if (parsed) routeRef.current = parsed;
        } catch {}
      }
      enhancePrintTables();
      scheduleWeather(80);
    };

    const handleInput = () => {
      enhancePrintTables();
      scheduleWeather(120);
    };

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button");
      if (button && /use current navdash route/i.test(button.textContent || "")) {
        routeRef.current = null;
        window.setTimeout(() => scheduleWeather(0), 180);
        return;
      }
      scheduleWeather(220);
    };

    enhancePrintTables();
    const observer = new MutationObserver(enhancePrintTables);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", handleChange, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("click", handleClick, true);
    scheduleWeather(500);

    return () => {
      alive = false;
      observer.disconnect();
      window.clearTimeout(weatherTimerRef.current);
      document.removeEventListener("change", handleChange, true);
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return <>{children}</>;
}
