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

function fmtDeparture(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.replace("T", " ");
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
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
        const response = await fetch("/api/route-state", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok || !json?.hasRoute || !Array.isArray(json?.waypoints)) return;
        routeState = {
          routeName: String(json.routeName || "Current NavDash Route"),
          waypoints: json.waypoints.map((wp: any) => ({ name: wp?.name, lat: Number(wp?.lat), lon: Number(wp?.lon) }))
            .filter((wp: RouteWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon)),
        };
      } catch {}
    };

    const render = () => {
      const target = ensureHost();
      if (!target) return;

      const aside = document.querySelector("aside");
      const routeName = readText(aside?.querySelector("section:first-child .mt-1.truncate") || null);
      const departureInput = aside?.querySelector<HTMLInputElement>('section:first-child input[type="datetime-local"]') || null;
      const speedInput = aside?.querySelector<HTMLInputElement>('section:first-child input[type="number"]') || null;
      const plannedSpeed = Number(speedInput?.value);

      const activeModeButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
        (button.textContent?.trim() === "ROUTE ENCOUNTER" || button.textContent?.trim() === "WEATHER TIME") && button.className.includes("text-[#f1d56b]")
      );
      const mode = activeModeButton?.textContent?.trim() || "ROUTE ENCOUNTER";

      let forecastValid = "--";
      if (hiddenSummary) {
        const cards = Array.from(hiddenSummary.querySelectorAll<HTMLElement>(":scope > div"));
        const last = cards[cards.length - 1];
        const label = last?.children?.[0]?.textContent?.trim() || "";
        if (label === "FORECAST VALID") forecastValid = last?.children?.[1]?.textContent?.trim() || "--";
      }

      const fresh = ownShip && Date.now() - ownShip.updatedAt <= 120000;
      const actual = fresh && ownShip
        ? `${ownShip.sog == null ? "--" : ownShip.sog.toFixed(1)} kt / ${ownShip.cog == null ? "--" : `${ownShip.cog.toFixed(0)}°`}`
        : "LIVE DATA OFFLINE";

      let progress = "--";
      let progressSub = "POSITION NOT MATCHED TO ROUTE";
      if (fresh && ownShip && routeState?.waypoints?.length && routeState.routeName === routeName) {
        const match = progressAlongRoute(routeState.waypoints, ownShip);
        const total = routeLength(routeState.waypoints);
        if (match && match.crossNm <= 20) {
          progress = `${match.alongNm.toFixed(0)} / ${total.toFixed(0)} NM`;
          progressSub = `${Math.max(0, total - match.alongNm).toFixed(0)} NM REMAINING`;
        }
      }

      let deltaSub = "PLANNED SPEED";
      if (fresh && ownShip?.sog != null && Number.isFinite(plannedSpeed)) {
        const diff = ownShip.sog - plannedSpeed;
        deltaSub = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} KT VS PLAN`;
      }

      const dataState = fresh ? "LIVE" : socket?.readyState === WebSocket.OPEN ? "NO OWN-SHIP FIX" : "OFFLINE";
      const dataTone = fresh ? "actual" : "neutral";

      target.innerHTML = `<div style="display:grid;grid-template-columns:minmax(180px,1.7fr) minmax(120px,1fr) minmax(100px,.8fr) minmax(135px,1fr) minmax(135px,1fr) minmax(125px,1fr) minmax(92px,.7fr);gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:1px">
        ${panel("ROUTE", routeName, "neutral", mode === "WEATHER TIME" && forecastValid !== "--" ? `VALID ${forecastValid}` : mode)}
        ${panel("DEPARTURE", fmtDeparture(departureInput?.value || ""), "plan")}
        ${panel("PLAN", Number.isFinite(plannedSpeed) ? `${plannedSpeed.toFixed(1)} kt` : "--", "plan", deltaSub)}
        ${panel("ACTUAL", actual, fresh ? "actual" : "neutral", fresh ? "SOG / COG" : "AIS / NAV FEED")}
        ${panel("PROGRESS", progress, fresh ? "actual" : "neutral", progressSub)}
        ${panel(mode === "WEATHER TIME" ? "FORECAST VALID" : "MODE", mode === "WEATHER TIME" ? forecastValid : "ENCOUNTER", "neutral")}
        ${panel("DATA", dataState, dataTone, fresh ? "WIND ✓  WAVES ✓  AIS ✓" : "WIND / WAVES AVAILABLE")}
      </div>`;
    };

    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          try {
            const json = JSON.parse(String(event.data || ""));
            if (json?.type === "nmea" && typeof json?.line === "string") {
              const decoded = decodeOwnShip(json.line);
              if (decoded) ownShip = decoded;
            }
          } catch {}
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
      host?.remove();
      if (hiddenSummary) hiddenSummary.style.display = "";
    };
  }, []);

  return null;
}
