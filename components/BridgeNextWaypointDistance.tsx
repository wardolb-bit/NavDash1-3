"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import {
  geodesicDistanceNm,
  normalizeLongitude,
  normalizeLongitudeDelta,
  normalizeRouteWaypoints,
  routeLegDistanceNm,
  routeSignature,
  type RouteWaypoint,
} from "../lib/routeNavigation";

type Position = { lat: number; lon: number; cog?: number };

function sixBit(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const value = parseInt(bits.slice(start, start + length), 2);
  const sign = 2 ** (length - 1);
  return value >= sign ? value - 2 ** length : value;
}

function decodeOwnShip(line: string): Position | null {
  try {
    if (!line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = parts[5].split("").map((char) => sixBit(char).toString(2).padStart(6, "0")).join("");
    if (![1, 2, 3].includes(unsigned(bits, 0, 6))) return null;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cogRaw = unsigned(bits, 116, 12);
    const cog = cogRaw < 3600 ? cogRaw / 10 : undefined;
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, cog } : null;
  } catch {
    return null;
  }
}

function normalizeRoute(data: any) {
  const waypoints = normalizeRouteWaypoints(data?.waypoints)
    .map((waypoint, index) => ({
      ...waypoint,
      id: `WP${String(index + 1).padStart(2, "0")}`,
      name: waypoint.name?.trim() || `Waypoint ${index + 1}`,
    }));
  const rawIndex = Number(data?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(rawIndex)
    ? Math.max(1, Math.min(waypoints.length - 1, Math.trunc(rawIndex)))
    : 1;
  return { waypoints, activeWaypointIndex };
}

function waypointLabel(waypoint: RouteWaypoint | undefined, index: number) {
  return waypoint?.name?.trim() || `Waypoint ${index + 1}`;
}

function passageMetrics(position: Position, from: RouteWaypoint, to: RouteWaypoint) {
  const meanLat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const nmPerDegLon = 60 * Math.max(0.01, Math.cos(meanLat));
  const vx = normalizeLongitudeDelta(to.lon - from.lon) * nmPerDegLon;
  const vy = (to.lat - from.lat) * 60;
  const wx = normalizeLongitudeDelta(position.lon - from.lon) * nmPerDegLon;
  const wy = (position.lat - from.lat) * 60;
  const legSq = vx * vx + vy * vy;
  return { projectionRatio: legSq <= 0.000001 ? 0 : (wx * vx + wy * vy) / legSq };
}

function zoneIndex(lon: number) {
  return -Math.floor((lon + 7.5) / 15);
}

function zoneLabel(index: number) {
  const hours = Math.max(-12, Math.min(12, index));
  return hours === 0 ? "ZD 0" : `ZD ${hours > 0 ? "+" : ""}${hours}`;
}

function nextZoneFromMotion(position: Position) {
  if (!Number.isFinite(position.cog)) return null;
  const cog = position.cog as number;
  const eastComponent = Math.sin(cog * Math.PI / 180);
  if (Math.abs(eastComponent) < 0.05) return null;
  const eastbound = eastComponent > 0;
  const currentLon = position.lon;
  let boundary: number;
  if (eastbound) {
    boundary = 7.5 + 15 * Math.floor((currentLon - 7.5) / 15 + 1);
    if (boundary > 180) boundary = 180;
  } else {
    boundary = 7.5 + 15 * Math.ceil((currentLon - 7.5) / 15 - 1);
    if (boundary < -180) boundary = -180;
  }
  const deltaLon = Math.abs(boundary - currentLon);
  const distance = deltaLon * 60 * Math.max(0, Math.cos(position.lat * Math.PI / 180));
  const probeLon = normalizeLongitude(boundary + (eastbound ? 0.001 : -0.001));
  const nextZone = zoneIndex(probeLon);
  const idl = Math.abs(boundary) === 180;
  return { distance, label: idl ? `NEXT ${zoneLabel(nextZone)} / IDL` : `NEXT ${zoneLabel(nextZone)}` };
}

export function BridgeNextWaypointDistance() {
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let routeTimer = 0;
    let position: Position | null = null;
    let route: RouteWaypoint[] = [];
    let activeWaypointIndex = 1;
    let currentRouteSignature = "";
    let closestDistanceToTarget = Infinity;

    const styleChip = (element: HTMLElement) => {
      const day = document.documentElement.dataset.navdashTheme === "day" || document.documentElement.classList.contains("day-mode");
      element.style.cssText = day
        ? "padding:5px 9px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-size:9px"
        : "padding:5px 9px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#6F9278;font-size:9px";
    };

    const acceptRoute = (data: any) => {
      const normalized = normalizeRoute(data);
      if (normalized.waypoints.length < 2) return;
      const signature = routeSignature(normalized.waypoints);
      if (signature !== currentRouteSignature) {
        route = normalized.waypoints;
        currentRouteSignature = signature;
        activeWaypointIndex = normalized.activeWaypointIndex;
        closestDistanceToTarget = Infinity;
      } else {
        route = normalized.waypoints;
        activeWaypointIndex = Math.max(activeWaypointIndex, normalized.activeWaypointIndex);
      }
    };

    const advancePassedWaypoint = () => {
      if (!position || route.length < 2) return;
      while (activeWaypointIndex > 0 && activeWaypointIndex < route.length - 1) {
        const previous = route[activeWaypointIndex - 1];
        const target = route[activeWaypointIndex];
        const currentDistance = geodesicDistanceNm(position, target);
        closestDistanceToTarget = Math.min(closestDistanceToTarget, currentDistance);
        const { projectionRatio } = passageMetrics(position, previous, target);
        const crossedWaypointPlane = projectionRatio >= 1;
        const passedAfterCloseApproach = closestDistanceToTarget <= 2 && currentDistance >= closestDistanceToTarget + 0.2;
        if (!crossedWaypointPlane && !passedAfterCloseApproach) break;
        activeWaypointIndex += 1;
        closestDistanceToTarget = Infinity;
      }
    };

    const render = () => {
      advancePassedWaypoint();
      const center = document.querySelector<HTMLElement>("#bc-v2-topbar .bc2-center");
      if (!center) return;

      let display = document.getElementById("bc2-top-nextwpt") as HTMLElement | null;
      if (!display) {
        display = document.createElement("span");
        display.id = "bc2-top-nextwpt";
        document.getElementById("bc2-top-dtg")?.insertAdjacentElement("afterend", display);
      }
      styleChip(display);

      let zoneDisplay = document.getElementById("bc2-top-zone") as HTMLElement | null;
      if (!zoneDisplay) {
        zoneDisplay = document.createElement("span");
        zoneDisplay.id = "bc2-top-zone";
        display.insertAdjacentElement("afterend", zoneDisplay);
      }
      styleChip(zoneDisplay);

      const previous = route[activeWaypointIndex - 1];
      const next = route[activeWaypointIndex];
      if (previous && next) {
        const legText = `${waypointLabel(previous, activeWaypointIndex - 1)} → ${waypointLabel(next, activeWaypointIndex)}`;
        const topLeg = document.getElementById("bc2-top-leg");
        const railLeg = document.getElementById("bc2-leg");
        if (topLeg) topLeg.textContent = `LEG ${legText}`;
        if (railLeg) railLeg.textContent = legText;
      }

      display.textContent = position && next
        ? `NEXT WPT ${routeLegDistanceNm(position, next).toFixed(1)} NM`
        : "NEXT WPT --";
      const transition = position ? nextZoneFromMotion(position) : null;
      zoneDisplay.textContent = transition ? `${transition.label} ${transition.distance.toFixed(0)} NM` : "NEXT ZD --";
    };

    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-navdash-theme"] });

    const loadRoute = async () => {
      if (closed) return;
      try {
        let data: any = null;
        const local = window.localStorage.getItem("navconsole-saved-route");
        if (local) data = JSON.parse(local);
        if (!data?.waypoints?.length) {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) data = await response.json();
        }
        if (data) acceptRoute(data);
      } catch {}
      render();
      routeTimer = window.setTimeout(loadRoute, 1500);
    };

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            if (json?.type === "route-state") {
              acceptRoute(json);
              render();
              return;
            }
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}
          for (const line of raw.split(/\r?\n/)) {
            const decoded = decodeOwnShip(line.trim());
            if (decoded) {
              position = decoded;
              render();
            }
          }
        };
        socket.onclose = () => {
          if (!closed) retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        retryTimer = window.setTimeout(connect, 2000);
      }
    };

    loadRoute();
    connect();
    const initialTimer = window.setTimeout(render, 250);
    const syncTimer = window.setInterval(render, 500);

    return () => {
      closed = true;
      themeObserver.disconnect();
      window.clearTimeout(initialTimer);
      window.clearInterval(syncTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(routeTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      document.getElementById("bc2-top-nextwpt")?.remove();
      document.getElementById("bc2-top-zone")?.remove();
    };
  }, []);

  return null;
}
