"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };

type RouteState = {
  type?: string;
  routeName?: string;
  waypoints?: Waypoint[];
  activeWaypointIndex?: number;
  savedAt?: string;
};

function sequentialId(index: number) {
  return `WP${String(index + 1).padStart(2, "0")}`;
}

function normalizeRoute(data: RouteState | null | undefined) {
  if (!data || !Array.isArray(data.waypoints)) return null;

  const waypoints = data.waypoints
    .map((wp, index) => ({
      id: sequentialId(index),
      name: typeof wp?.name === "string" && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
      lat: Number((wp as any)?.lat ?? (wp as any)?.latitude),
      lon: Number((wp as any)?.lon ?? (wp as any)?.lng ?? (wp as any)?.longitude),
    }))
    .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon))
    .map((wp, index) => ({ ...wp, id: sequentialId(index) }));

  if (waypoints.length < 2) return null;

  const rawIndex = Number(data.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(rawIndex)
    ? Math.max(1, Math.min(Math.trunc(rawIndex), waypoints.length - 1))
    : 1;

  return {
    type: "route-state",
    routeName: typeof data.routeName === "string" && data.routeName.trim() ? data.routeName : "Loaded RTZ Route",
    waypoints,
    activeWaypointIndex,
    savedAt: typeof data.savedAt === "string" ? data.savedAt : new Date().toISOString(),
  };
}

function needsRenumber(data: RouteState | null | undefined) {
  if (!data || !Array.isArray(data.waypoints)) return false;
  return data.waypoints.some((wp, index) => String(wp?.id || "").trim() !== sequentialId(index));
}

function writeBrowserRoute(route: ReturnType<typeof normalizeRoute>) {
  if (!route) return;
  const value = JSON.stringify(route);
  try { window.localStorage.setItem(ROUTE_STORAGE_KEY, value); } catch {}
  try { window.sessionStorage.setItem(ROUTE_STORAGE_KEY, value); } catch {}
}

export function RouteWaypointNumberNormalizer() {
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;

    const publishCloud = (route: ReturnType<typeof normalizeRoute>) => {
      if (!route) return;
      fetch("/api/route-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route),
      }).catch(() => {});
    };

    try {
      const local = window.localStorage.getItem(ROUTE_STORAGE_KEY) || window.sessionStorage.getItem(ROUTE_STORAGE_KEY);
      if (local) {
        const parsed = JSON.parse(local);
        const normalized = normalizeRoute(parsed);
        if (normalized) {
          writeBrowserRoute(normalized);
          if (needsRenumber(parsed)) publishCloud(normalized);
        }
      }
    } catch {}

    fetch("/api/route-state", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (closed || !data?.waypoints?.length) return;
        const normalized = normalizeRoute(data);
        if (!normalized) return;
        writeBrowserRoute(normalized);
        if (needsRenumber(data)) publishCloud(normalized);
      })
      .catch(() => {});

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let message: any = event.data;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message?.type !== "route-state" || !Array.isArray(message?.waypoints) || message.waypoints.length < 2) return;

          const normalized = normalizeRoute(message);
          if (!normalized) return;
          writeBrowserRoute(normalized);

          if (needsRenumber(message) && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(normalized));
            publishCloud(normalized);
          }
        };
        socket.onclose = () => {
          if (!closed) reconnectTimer = window.setTimeout(connect, 2500);
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 2500);
      }
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return null;
}
