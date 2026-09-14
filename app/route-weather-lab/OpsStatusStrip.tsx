"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

type OwnShip = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  updatedAt: number;
};

type RouteWaypoint = { name?: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: RouteWaypoint[] } | null;
type TimeBasis = "ship" | "utc";
type EtaBasis = "plan" | "live";
type WeatherMeta = {
  generatedAt: number | null;
  loadedAt: number | null;
  frames: string[];
  product: string;
};

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload.split("").map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}

function decodeOwnShip(line: string): OwnShip | null {
  try {
    if (!/^[$!]AIVDO/.test(line)) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;
    const sogRaw = unsigned(bits, 50, 10);
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cogRaw = unsigned(bits, 116, 12);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {
      lat,
      lon,
      sog: sogRaw >= 1023 ? null : sogRaw / 10,
      cog: cogRaw >= 3600 ? null : cogRaw / 10,
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function nmBetween(a: RouteWaypoint, b: RouteWaypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeLength(route: RouteWaypoint[]) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += nmBetween(route[i - 1], route[i]);
  return total;
}

function progressAlongRoute(route: RouteWaypoint[], own: OwnShip) {
  if (route.length < 2) return null;
  let cumulative = 0;
  let best = { crossNm: Number.POSITIVE_INFINITY, alongNm: 0 };

  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    const meanLat = ((a.lat + b.lat + own.lat) / 3) * Math.PI / 180;
    const scaleX = Math.max(0.05, Math.cos(meanLat)) * 60;
    const ax = a.lon * scaleX;
    const ay = a.lat * 60;
    const bx = b.lon * scaleX;
    const by = b.lat * 60;
    const px = own.lon * scaleX;
    const py = own.lat * 60;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
    const qx = ax + t * vx;
    const qy = ay + t * vy;
    const crossNm = Math.hypot(px - qx, py - qy);
    const legNm = nmBetween(a, b);
    if (crossNm < best.crossNm) best = { crossNm, alongNm: cumulative + legNm * t };
    cumulative += legNm;
  }

  return best;
}

function formatBasisDate(date: Date, basis: TimeBasis) {
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(basis === "utc" ? { timeZone: "UTC" } : {}),
  }).format(date) + (basis === "utc" ? "Z" : "");
}

function fmtInputLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseDisplayedDate(value: string) {
  const match = value.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months.indexOf(match[1]);
  if (month < 0) return null;
  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month, Number(match[2]), Number(match[3]), Number(match[4]), 0, 0);
  if (date.getTime() - now.getTime() > 183 * 86400000) date = new Date(year - 1, month, Number(match[2]), Number(match[3]), Number(match[4]), 0, 0);
  if (now.getTime() - date.getTime() > 183 * 86400000) date = new Date(year + 1, month, Number(match[2]), Number(match[3]), Number(match[4]), 0, 0);
  return date;
}

function readText(el: Element | null) {
  return el?.textContent?.trim() || "--";
}

function panel(label: string, value: string, tone: "plan" | "actual" | "neutral" = "neutral", sub = "") {
  const valueColor = tone === "plan" ? "#f1d56b" : tone === "actual" ? "#67e8f9" : "#e2e8f0";
  const border = tone === "plan" ? "rgba(241,213,107,.26)" : tone === "actual" ? "rgba(103,232,249,.27)" : "rgba(71,85,105,.55)";
  return `<div style="min-width:0;border:1px solid ${border};background:#050a0f;padding:7px 9px;box-sizing:border-box">
    <div style="font-size:8px;font-weight:900;letter-spacing:.13em;color:#64748b;white-space:nowrap">${label}</div>
    <div style="margin-top:3px;font-size:13px;font-weight:900;color:${valueColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value}</div>
    ${sub ? `<div style="margin-top:2px;font-size:8px;font-weight:700;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>` : ""}
  </div>`;
}

function button(label: string, action: string, active = false, disabled = false) {
  return `<button type="button" data-rw-action="${action}" ${disabled ? "disabled" : ""} style="border:1px solid ${active ? "#c9a227" : "#334155"};background:${active ? "#17130a" : "#050a0f"};color:${active ? "#f1d56b" : disabled ? "#475569" : "#cbd5e1"};padding:6px 9px;font-size:8px;font-weight:900;letter-spacing:.09em;cursor:${disabled ? "not-allowed" : "pointer"};white-space:nowrap">${label}</button>`;
}

function ageLabel(timestamp: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) return "--";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h${rem}m` : `${hours}h`;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function OpsStatusStrip() {
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let updateTimer = 0;
    let routeTimer = 0;
    let ownShip: OwnShip | null = null;
    let routeState: RouteState = null;
    let host: HTMLDivElement | null = null;
    let hiddenSummary: HTMLElement | null = null;
    let timeBasis: TimeBasis = "ship";
    let etaBasis: EtaBasis = "plan";
    let planDeparture = "";
    let planSpeed = 9;
    let applyingOverride = false;
    let speedSamples: Array<{ at: number; sog: number }> = [];
    let lastProgress: { alongNm: number; totalNm: number; crossNm: number } | null = null;
    let windMeta: WeatherMeta = { generatedAt: null, loadedAt: null, frames: [], product: "WIND" };
    let waveMeta: WeatherMeta = { generatedAt: null, loadedAt: null, frames: [], product: "WAVES" };
    const originalFetch = window.fetch.bind(window);

    const captureWeather = (url: string, response: Response) => {
      if (!url.includes("/api/noaa-route-weather") && !url.includes("/api/gfs-wave-route")) return;
      response.clone().json().then((json) => {
        const generated = json?.generatedAt ? new Date(json.generatedAt).getTime() : null;
        const frames = Array.isArray(json?.frames) ? json.frames.map((frame: any) => String(frame?.validAt || "")).filter(Boolean) : [];
        const meta: WeatherMeta = {
          generatedAt: Number.isFinite(generated) ? generated : null,
          loadedAt: Date.now(),
          frames,
          product: String(json?.product || (url.includes("gfs-wave") ? "WAVES" : "WIND")),
        };
        if (url.includes("gfs-wave")) waveMeta = meta;
        else windMeta = meta;
      }).catch(() => {});
    };

    const patchedFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      captureWeather(url, response);
      return response;
    };
    window.fetch = patchedFetch;

    const ensureHost = () => {
      if (host?.isConnected) return host;
      const mainSection = document.querySelector("main > div.grid > section");
      if (!mainSection) return null;
      const candidate = Array.from(mainSection.children).find((node) => {
        if (!(node instanceof HTMLElement)) return false;
        return node.classList.contains("grid") && node.classList.contains("grid-cols-2") && node.querySelectorAll(":scope > div").length === 4;
      }) as HTMLElement | undefined;
      if (!candidate) return null;
      hiddenSummary = candidate;
      hiddenSummary.style.display = "none";
      host = document.createElement("div");
      host.dataset.routeWeatherOpsStrip = "1";
      host.style.marginBottom = "8px";
      candidate.parentElement?.insertBefore(host, candidate);
      return host;
    };

    const loadRoute = async () => {
      try {
        const response = await originalFetch("/api/route-state", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok || !json?.hasRoute || !Array.isArray(json?.waypoints)) return;
        routeState = {
          routeName: String(json.routeName || "Current NavDash Route"),
          waypoints: json.waypoints.map((wp: any) => ({ name: wp?.name, lat: Number(wp?.lat), lon: Number(wp?.lon) }))
            .filter((wp: RouteWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon)),
        };
      } catch {}
    };

    const getControls = () => {
      const aside = document.querySelector("aside");
      const departureInput = aside?.querySelector<HTMLInputElement>('section:first-child input[type="datetime-local"]') || null;
      const speedInput = aside?.querySelector<HTMLInputElement>('section:first-child input[type="number"]') || null;
      return { aside, departureInput, speedInput };
    };

    const smoothedSog = () => {
      const cutoff = Date.now() - 30 * 60000;
      speedSamples = speedSamples.filter((sample) => sample.at >= cutoff);
      if (!speedSamples.length) return ownShip?.sog ?? null;
      return speedSamples.reduce((sum, sample) => sum + sample.sog, 0) / speedSamples.length;
    };

    const restorePlan = () => {
      const { departureInput, speedInput } = getControls();
      applyingOverride = true;
      if (departureInput && planDeparture) setReactInputValue(departureInput, planDeparture);
      if (speedInput && Number.isFinite(planSpeed)) setReactInputValue(speedInput, planSpeed.toFixed(1));
      if (departureInput) departureInput.disabled = false;
      if (speedInput) speedInput.disabled = false;
      applyingOverride = false;
    };

    const applyLiveEta = () => {
      const { departureInput, speedInput } = getControls();
      const fresh = ownShip && Date.now() - ownShip.updatedAt <= 120000;
      const avg = smoothedSog();
      if (!fresh || !ownShip || !lastProgress || avg == null || avg < 0.5 || !departureInput || !speedInput) {
        if (etaBasis === "live") {
          etaBasis = "plan";
          restorePlan();
        }
        return;
      }
      const effectiveDeparture = new Date(Date.now() - (lastProgress.alongNm / avg) * 3600000);
      const depValue = fmtInputLocal(effectiveDeparture);
      const speedValue = avg.toFixed(1);
      applyingOverride = true;
      if (departureInput.value !== depValue) setReactInputValue(departureInput, depValue);
      if (speedInput.value !== speedValue) setReactInputValue(speedInput, speedValue);
      departureInput.disabled = true;
      speedInput.disabled = true;
      departureInput.title = "LIVE ETA basis active. Planned departure is retained in the top strip.";
      speedInput.title = "LIVE ETA basis active using 30-minute average SOG.";
      applyingOverride = false;
    };

    const nearestForecastIndex = () => {
      const frames = windMeta.frames.length ? windMeta.frames : waveMeta.frames;
      if (!frames.length) return 0;
      const now = Date.now();
      let bestIndex = 0;
      let bestDelta = Number.POSITIVE_INFINITY;
      frames.forEach((value, index) => {
        const t = new Date(value).getTime();
        const delta = Math.abs(t - now);
        if (Number.isFinite(t) && delta < bestDelta) {
          bestDelta = delta;
          bestIndex = index;
        }
      });
      return bestIndex;
    };

    const setWeatherNow = () => {
      const range = document.querySelector<HTMLInputElement>('input[type="range"].accent-amber-400');
      if (!range) return;
      setReactInputValue(range, String(Math.min(Number(range.max) || 0, nearestForecastIndex())));
    };

    const currentMode = () => {
      const activeModeButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((btn) =>
        (btn.textContent?.trim() === "ROUTE ENCOUNTER" || btn.textContent?.trim() === "WEATHER TIME") && btn.className.includes("text-[#f1d56b]")
      );
      return activeModeButton?.textContent?.trim() || "ROUTE ENCOUNTER";
    };

    const selectedFrameDate = () => {
      const range = document.querySelector<HTMLInputElement>('input[type="range"].accent-amber-400');
      const index = Number(range?.value || 0);
      const frames = windMeta.frames.length ? windMeta.frames : waveMeta.frames;
      const date = new Date(frames[index] || "");
      return Number.isFinite(date.getTime()) ? date : null;
    };

    const applyTimeBasisToVisibleData = () => {
      const mode = currentMode();
      const frameDate = selectedFrameDate();
      if (mode === "WEATHER TIME" && frameDate) {
        const range = document.querySelector<HTMLInputElement>('input[type="range"].accent-amber-400');
        const wrapper = range?.parentElement;
        const headerSpans = wrapper?.querySelectorAll("div:first-child span");
        if (headerSpans && headerSpans.length > 1) headerSpans[1].textContent = formatBasisDate(frameDate, timeBasis);
      }

      const table = document.querySelector<HTMLTableElement>("main section table");
      if (table) {
        const { departureInput, speedInput } = getControls();
        const departureDate = departureInput ? new Date(departureInput.value) : null;
        const speed = Number(speedInput?.value);
        const frames = windMeta.frames.length ? windMeta.frames : waveMeta.frames;
        Array.from(table.tBodies[0]?.rows || []).forEach((row) => {
          const nm = Number(row.cells[0]?.textContent?.trim());
          const cell = row.cells[1];
          if (!cell) return;
          if (mode === "WEATHER TIME" && frameDate) {
            cell.textContent = formatBasisDate(frameDate, timeBasis);
          } else if (departureDate && Number.isFinite(departureDate.getTime()) && Number.isFinite(speed) && speed > 0 && Number.isFinite(nm)) {
            const eta = new Date(departureDate.getTime() + (nm / speed) * 3600000);
            let valid: Date | null = null;
            let delta = Number.POSITIVE_INFINITY;
            frames.forEach((value) => {
              const d = new Date(value);
              const diff = Math.abs(d.getTime() - eta.getTime());
              if (Number.isFinite(d.getTime()) && diff < delta) {
                valid = d;
                delta = diff;
              }
            });
            const validText = valid ? `valid ${formatBasisDate(valid, timeBasis)} • Δ ${(delta / 3600000).toFixed(1)}h` : "";
            cell.innerHTML = `<div>${formatBasisDate(eta, timeBasis)}</div>${validText ? `<div class="text-[8px] text-slate-600">${validText}</div>` : ""}`;
          }
        });
      }

      document.querySelectorAll<HTMLElement>("aside section").forEach((section) => {
        const heading = section.querySelector("div")?.textContent || "";
        if (!heading.includes("MAX SEAS ALONG VOYAGE") && !heading.includes("MAX WIND ALONG VOYAGE")) return;
        const lines = Array.from(section.querySelectorAll<HTMLElement>(".text-slate-400"));
        lines.forEach((line) => {
          const date = parseDisplayedDate(line.textContent || "");
          if (!date) return;
          line.textContent = (line.textContent || "").replace(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{2}):(\d{2})/, formatBasisDate(date, timeBasis));
        });
      });
    };

    const weatherAge = (meta: WeatherMeta) => ageLabel(meta.generatedAt || meta.loadedAt);

    const buildPrintBrief = () => {
      document.getElementById("route-weather-print")?.remove();
      const { departureInput } = getControls();
      const routeName = readText(document.querySelector("aside section:first-child .mt-1.truncate"));
      const table = document.querySelector<HTMLTableElement>("main section table");
      const maxSections = Array.from(document.querySelectorAll<HTMLElement>("aside section")).filter((section) => {
        const text = section.textContent || "";
        return text.includes("MAX SEAS ALONG VOYAGE") || text.includes("MAX WIND ALONG VOYAGE");
      });
      const fresh = ownShip && Date.now() - ownShip.updatedAt <= 120000;
      const avg = smoothedSog();
      const print = document.createElement("section");
      print.id = "route-weather-print";
      print.style.display = "none";
      print.innerHTML = `
        <h1 style="margin:0 0 3px;font-size:20px">NavDash Route Weather Brief</h1>
        <div style="font-size:11px;margin-bottom:12px">${routeName} • ${timeBasis === "utc" ? "UTC" : "Ship Time"} • Generated ${formatBasisDate(new Date(), timeBasis)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px"><tbody>
          <tr><td style="border:1px solid #999;padding:5px"><b>Planned departure</b><br/>${planDeparture ? formatBasisDate(new Date(planDeparture), timeBasis) : formatBasisDate(new Date(departureInput?.value || ""), timeBasis)}</td><td style="border:1px solid #999;padding:5px"><b>Planned speed</b><br/>${Number.isFinite(planSpeed) ? `${planSpeed.toFixed(1)} kt` : "--"}</td><td style="border:1px solid #999;padding:5px"><b>Actual</b><br/>${fresh && ownShip ? `${ownShip.sog?.toFixed(1) ?? "--"} kt / ${ownShip.cog?.toFixed(0) ?? "--"}°` : "OFFLINE"}</td><td style="border:1px solid #999;padding:5px"><b>30m avg SOG</b><br/>${avg == null ? "--" : `${avg.toFixed(1)} kt`}</td></tr>
          <tr><td style="border:1px solid #999;padding:5px"><b>ETA basis</b><br/>${etaBasis === "live" ? "LIVE 30M SOG" : "PLAN"}</td><td style="border:1px solid #999;padding:5px"><b>Progress</b><br/>${lastProgress ? `${lastProgress.alongNm.toFixed(0)} / ${lastProgress.totalNm.toFixed(0)} NM` : "--"}</td><td style="border:1px solid #999;padding:5px"><b>Wind age</b><br/>${weatherAge(windMeta)}</td><td style="border:1px solid #999;padding:5px"><b>Wave age</b><br/>${weatherAge(waveMeta)}</td></tr>
        </tbody></table>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">${maxSections.map((section) => `<div style="border:1px solid #999;padding:7px;font-size:10px">${section.innerText.replace(/\n/g, "<br/>")}</div>`).join("")}</div>
        ${table ? `<h2 style="font-size:13px;margin:8px 0 4px">Weather Along Route</h2><div style="font-size:8px">${table.outerHTML}</div>` : ""}
        <div style="margin-top:10px;font-size:8px;color:#555">Operational planning aid. Verify critical navigation and weather decisions against authoritative source products.</div>`;
      document.body.appendChild(print);
      return print;
    };

    const ensurePrintStyle = () => {
      if (document.getElementById("route-weather-print-style")) return;
      const style = document.createElement("style");
      style.id = "route-weather-print-style";
      style.textContent = `
        @media print {
          body * { visibility: hidden !important; }
          #route-weather-print, #route-weather-print * { visibility: visible !important; }
          #route-weather-print { display:block !important; position:absolute; left:0; top:0; width:100%; background:white !important; color:black !important; padding:12mm; box-sizing:border-box; }
          #route-weather-print table { color:black !important; background:white !important; border-collapse:collapse !important; }
          #route-weather-print th, #route-weather-print td { color:black !important; background:white !important; border-bottom:1px solid #bbb !important; padding:4px !important; }
          @page { size: landscape; margin: 8mm; }
        }
      `;
      document.head.appendChild(style);
    };

    const printBrief = () => {
      ensurePrintStyle();
      buildPrintBrief();
      window.setTimeout(() => window.print(), 40);
    };

    const exportCsv = () => {
      const table = document.querySelector<HTMLTableElement>("main section table");
      if (!table) return;
      const rows = Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => csvEscape(cell.innerText.trim())).join(","));
      const preamble = [
        `${csvEscape("Route")},${csvEscape(readText(document.querySelector("aside section:first-child .mt-1.truncate")))}`,
        `${csvEscape("ETA Basis")},${csvEscape(etaBasis === "live" ? "LIVE 30M SOG" : "PLAN")}`,
        `${csvEscape("Time Basis")},${csvEscape(timeBasis === "utc" ? "UTC" : "SHIP")}`,
        `${csvEscape("Wind Age")},${csvEscape(weatherAge(windMeta))}`,
        `${csvEscape("Wave Age")},${csvEscape(weatherAge(waveMeta))}`,
        "",
      ];
      const blob = new Blob([[...preamble, ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `route-weather-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const bindActions = (target: HTMLElement) => {
      target.querySelectorAll<HTMLButtonElement>("button[data-rw-action]").forEach((btn) => {
        btn.onclick = () => {
          const action = btn.dataset.rwAction;
          if (action === "eta-plan") {
            etaBasis = "plan";
            restorePlan();
          } else if (action === "eta-live") {
            const { departureInput, speedInput } = getControls();
            if (etaBasis === "plan") {
              if (departureInput?.value) planDeparture = departureInput.value;
              const speed = Number(speedInput?.value);
              if (Number.isFinite(speed)) planSpeed = speed;
            }
            etaBasis = "live";
            applyLiveEta();
          } else if (action === "time-ship") {
            timeBasis = "ship";
          } else if (action === "time-utc") {
            timeBasis = "utc";
          } else if (action === "now") {
            setWeatherNow();
          } else if (action === "print") {
            printBrief();
          } else if (action === "csv") {
            exportCsv();
          }
          render();
        };
      });
    };

    const render = () => {
      const target = ensureHost();
      if (!target) return;

      const { aside, departureInput, speedInput } = getControls();
      const routeName = readText(aside?.querySelector("section:first-child .mt-1.truncate") || null);
      if (etaBasis === "plan" && !applyingOverride) {
        if (departureInput?.value) planDeparture = departureInput.value;
        const currentPlanSpeed = Number(speedInput?.value);
        if (Number.isFinite(currentPlanSpeed)) planSpeed = currentPlanSpeed;
        if (departureInput) departureInput.disabled = false;
        if (speedInput) speedInput.disabled = false;
      }

      const mode = currentMode();
      const frameDate = selectedFrameDate();
      const forecastValid = frameDate ? formatBasisDate(frameDate, timeBasis) : "--";
      const fresh = ownShip && Date.now() - ownShip.updatedAt <= 120000;
      const avg = smoothedSog();
      const actual = fresh && ownShip
        ? `${ownShip.sog == null ? "--" : ownShip.sog.toFixed(1)} kt / ${ownShip.cog == null ? "--" : `${ownShip.cog.toFixed(0)}°`}`
        : "LIVE DATA OFFLINE";

      let progress = "--";
      let progressSub = "POSITION NOT MATCHED TO ROUTE";
      lastProgress = null;
      if (fresh && ownShip && routeState?.waypoints?.length && routeState.routeName === routeName) {
        const match = progressAlongRoute(routeState.waypoints, ownShip);
        const total = routeLength(routeState.waypoints);
        if (match && match.crossNm <= 20) {
          lastProgress = { alongNm: match.alongNm, totalNm: total, crossNm: match.crossNm };
          progress = `${match.alongNm.toFixed(0)} / ${total.toFixed(0)} NM`;
          progressSub = `${Math.max(0, total - match.alongNm).toFixed(0)} NM REMAINING`;
        }
      }

      if (etaBasis === "live") applyLiveEta();

      let deltaSub = "PLANNED SPEED";
      if (fresh && ownShip?.sog != null && Number.isFinite(planSpeed)) {
        const diff = ownShip.sog - planSpeed;
        deltaSub = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} KT VS PLAN`;
      }

      const dataState = fresh ? "LIVE" : socket?.readyState === WebSocket.OPEN ? "NO OWN-SHIP FIX" : "OFFLINE";
      const liveAvailable = Boolean(fresh && lastProgress && avg != null && avg >= 0.5);
      const dataSub = `WIND ${weatherAge(windMeta)} • WAVES ${weatherAge(waveMeta)} • AIS ${fresh ? "LIVE" : "--"}`;
      const planDepartureText = planDeparture ? formatBasisDate(new Date(planDeparture), timeBasis) : "--";

      target.innerHTML = `<div style="display:grid;grid-template-columns:minmax(180px,1.7fr) minmax(120px,1fr) minmax(100px,.8fr) minmax(135px,1fr) minmax(135px,1fr) minmax(125px,1fr) minmax(130px,1fr);gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:1px">
        ${panel("ROUTE", routeName, "neutral", mode === "WEATHER TIME" && forecastValid !== "--" ? `VALID ${forecastValid}` : mode)}
        ${panel("DEPARTURE", planDepartureText, "plan", timeBasis === "utc" ? "UTC" : "SHIP TIME")}
        ${panel("PLAN", Number.isFinite(planSpeed) ? `${planSpeed.toFixed(1)} kt` : "--", "plan", deltaSub)}
        ${panel("ACTUAL", actual, fresh ? "actual" : "neutral", fresh ? `30M AVG ${avg == null ? "--" : `${avg.toFixed(1)} KT`}` : "AIS / NAV FEED")}
        ${panel("PROGRESS", progress, fresh ? "actual" : "neutral", progressSub)}
        ${panel(mode === "WEATHER TIME" ? "FORECAST VALID" : "ETA BASIS", mode === "WEATHER TIME" ? forecastValid : etaBasis === "live" ? "LIVE 30M" : "PLAN", etaBasis === "live" ? "actual" : "neutral")}
        ${panel("DATA AGE", dataState, fresh ? "actual" : "neutral", dataSub)}
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:6px;padding:5px 6px;border:1px solid rgba(51,65,85,.55);background:#050a0f">
        <span style="font-size:8px;font-weight:900;letter-spacing:.11em;color:#64748b;margin-right:2px">ETA</span>
        ${button("PLAN", "eta-plan", etaBasis === "plan")}
        ${button("LIVE 30M SOG", "eta-live", etaBasis === "live", !liveAvailable && etaBasis !== "live")}
        <span style="font-size:8px;font-weight:900;letter-spacing:.11em;color:#64748b;margin-left:6px">TIME</span>
        ${button("SHIP", "time-ship", timeBasis === "ship")}
        ${button("UTC", "time-utc", timeBasis === "utc")}
        ${mode === "WEATHER TIME" ? button("NOW", "now") : ""}
        <span style="flex:1"></span>
        ${etaBasis === "live" ? `<span style="font-size:8px;font-weight:800;color:#67e8f9">LIVE ETA ACTIVE • 30-MIN AVG SOG</span>` : ""}
        ${button("PRINT BRIEF", "print")}
        ${button("EXPORT CSV", "csv")}
      </div>`;
      bindActions(target);
      applyTimeBasisToVisibleData();
    };

    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            if (json?.type === "nmea" && typeof json?.line === "string") raw = json.line;
          } catch {}
          const decoded = decodeOwnShip(raw.trim());
          if (!decoded) return;
          ownShip = decoded;
          if (decoded.sog != null && Number.isFinite(decoded.sog)) {
            speedSamples.push({ at: decoded.updatedAt, sog: decoded.sog });
            const cutoff = Date.now() - 30 * 60000;
            speedSamples = speedSamples.filter((sample) => sample.at >= cutoff);
          }
        };
        socket.onclose = () => {
          if (!disposed) reconnectTimer = window.setTimeout(connect, 3500);
        };
        socket.onerror = () => {
          try { socket?.close(); } catch {}
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 3500);
      }
    };

    loadRoute();
    routeTimer = window.setInterval(loadRoute, 15000);
    connect();
    updateTimer = window.setInterval(render, 1000);
    render();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(updateTimer);
      window.clearInterval(routeTimer);
      try { socket?.close(); } catch {}
      if (etaBasis === "live") restorePlan();
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
      host?.remove();
      document.getElementById("route-weather-print")?.remove();
      document.getElementById("route-weather-print-style")?.remove();
      if (hiddenSummary) hiddenSummary.style.display = "";
    };
  }, []);

  return null;
}
