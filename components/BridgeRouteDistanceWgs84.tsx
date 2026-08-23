"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type Position = { lat: number; lon: number };
type Waypoint = { lat: number; lon: number };

function rad(value: number) { return value * Math.PI / 180; }
function normalizedLonDelta(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function gcNm(a: Position, b: Waypoint) {
  const r = 3440.065;
  const p1 = rad(a.lat), p2 = rad(b.lat);
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(normalizedLonDelta(b.lon - a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rhumbWgs84Nm(a: Waypoint, b: Waypoint) {
  const A = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const p1 = rad(a.lat), p2 = rad(b.lat);
  let dl = rad(normalizedLonDelta(b.lon - a.lon));
  const iso = (p: number) => Math.log(Math.tan(Math.PI / 4 + p / 2)) - e / 2 * Math.log((1 + e * Math.sin(p)) / (1 - e * Math.sin(p)));
  const M = (p: number) => A * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * p)
  );
  const dPsi = iso(p2) - iso(p1);
  const dM = M(p2) - M(p1);
  const q = Math.abs(dPsi) > 1e-12 ? dM / dPsi : A * Math.cos(p1) / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  return Math.hypot(dM, q * dl) / 1852;
}

function sixBit(char: string) { let value = char.charCodeAt(0) - 48; if (value > 40) value -= 8; return value; }
function unsigned(bits: string, start: number, length: number) { return parseInt(bits.slice(start, start + length), 2); }
function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
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
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  } catch { return null; }
}

function normalizeRoute(data: any) {
  const waypoints: Waypoint[] = (Array.isArray(data?.waypoints) ? data.waypoints : [])
    .map((wp: any) => ({ lat: Number(wp?.lat ?? wp?.latitude), lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude) }))
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  const rawIndex = Number(data?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(rawIndex) ? Math.max(1, Math.min(waypoints.length - 1, Math.trunc(rawIndex))) : 1;
  return { waypoints, activeWaypointIndex };
}

function routeSignature(route: Waypoint[]) {
  return route.map((wp) => `${wp.lat.toFixed(6)},${wp.lon.toFixed(6)}`).join(";");
}

function passageMetrics(position: Position, from: Waypoint, to: Waypoint) {
  const meanLat = rad((from.lat + to.lat) / 2);
  const nmPerDegLon = 60 * Math.max(0.01, Math.cos(meanLat));
  const vx = normalizedLonDelta(to.lon - from.lon) * nmPerDegLon;
  const vy = (to.lat - from.lat) * 60;
  const wx = normalizedLonDelta(position.lon - from.lon) * nmPerDegLon;
  const wy = (position.lat - from.lat) * 60;
  const legSq = vx * vx + vy * vy;
  if (legSq <= 0.000001) return { projectionRatio: 0, crossTrackNm: Infinity };
  return {
    projectionRatio: (wx * vx + wy * vy) / legSq,
    crossTrackNm: Math.abs(wx * vy - wy * vx) / Math.sqrt(legSq),
  };
}

export function BridgeRouteDistanceWgs84() {
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let routeTimer = 0;
    let renderTimer = 0;
    let position: Position | null = null;
    let route: Waypoint[] = [];
    let activeWaypointIndex = 1;
    let currentRouteSignature = "";
    let closestDistanceToTarget = Infinity;

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
        const currentDistance = gcNm(position, target);
        closestDistanceToTarget = Math.min(closestDistanceToTarget, currentDistance);
        const { projectionRatio, crossTrackNm } = passageMetrics(position, previous, target);
        const crossedWaypointPlane = projectionRatio >= 1 && crossTrackNm <= 5;
        const passedAfterCloseApproach = closestDistanceToTarget <= 2 && currentDistance >= closestDistanceToTarget + 0.2;
        if (!crossedWaypointPlane && !passedAfterCloseApproach) break;
        activeWaypointIndex += 1;
        closestDistanceToTarget = Infinity;
      }
    };

    const calculateDtg = () => {
      if (!position || route.length < 2 || activeWaypointIndex >= route.length) return null;
      advancePassedWaypoint();
      const target = route[activeWaypointIndex];
      let total = rhumbWgs84Nm(position, target);
      for (let i = activeWaypointIndex; i < route.length - 1; i += 1) {
        total += rhumbWgs84Nm(route[i], route[i + 1]);
      }
      return total;
    };

    const render = () => {
      const dtg = calculateDtg();
      if (dtg === null || !Number.isFinite(dtg)) return;
      for (const id of ["bc2-top-dtg", "bc2-dtg"]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const existing = el.textContent || "";
        const decimals = existing.match(/\.(\d+)/)?.[1]?.length ?? 0;
        el.textContent = `${id === "bc2-top-dtg" ? "DTG " : ""}${dtg.toFixed(decimals)} NM`;
      }
    };

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
        socket.onclose = () => { if (!closed) retryTimer = window.setTimeout(connect, 2000); };
      } catch { retryTimer = window.setTimeout(connect, 2000); }
    };

    loadRoute();
    connect();
    renderTimer = window.setInterval(render, 250);

    return () => {
      closed = true;
      window.clearInterval(renderTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(routeTimer);
      if (socket) { socket.onclose = null; socket.close(); }
    };
  }, []);

  return null;
}
