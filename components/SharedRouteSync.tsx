"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const CLOUD_FALLBACK_DELAY_MS = 1200;

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
      name: typeof wp?.name === "string" && wp.name.trim() ? wp.name.trim() : `Waypoint ${index + 1}`,
      lat: Number((wp as any)?.lat ?? (wp as any)?.latitude),
      lon: Number((wp as any)?.lon ?? (wp as any)?.lng ?? (wp as any)?.longitude),
    }))
    .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

  if (waypoints.length < 2) return null;

  const rawIndex = Number(data.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(rawIndex)
    ? Math.max(1, Math.min(Math.trunc(rawIndex), waypoints.length - 1))
    : 1;

  return {
    type: "route-state",
    routeName: typeof data.routeName === "string" && data.routeName.trim() ? data.routeName.trim() : "Loaded RTZ Route",
    waypoints,
    activeWaypointIndex,
    savedAt: typeof data.savedAt === "string" ? data.savedAt : new Date().toISOString(),
  };
}

function writeBrowserRoute(route: ReturnType<typeof normalizeRoute>) {
  if (!route) return;
  const value = JSON.stringify(route);
  try { window.localStorage.setItem(ROUTE_STORAGE_KEY, value); } catch {}
  try { window.sessionStorage.setItem(ROUTE_STORAGE_KEY, value); } catch {}
  window.dispatchEvent(new CustomEvent("navdash-route-state-updated", { detail: route }));
}

function clearBrowserRoute() {
  try { window.localStorage.removeItem(ROUTE_STORAGE_KEY); } catch {}
  try { window.sessionStorage.removeItem(ROUTE_STORAGE_KEY); } catch {}
  window.dispatchEvent(new CustomEvent("navdash-route-state-updated", { detail: null }));
}

export function SharedRouteSync() {
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let cloudFallbackTimer = 0;
    let wheelhouseAnswered = false;

    const loadCloudFallback = async () => {
      if (closed || wheelhouseAnswered) return;
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok || closed || wheelhouseAnswered) return;
        const data = await response.json();
        const normalized = normalizeRoute(data);
        if (!normalized) return;
        writeBrowserRoute(normalized);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(normalized));
      } catch {}
    };

    const scheduleCloudFallback = () => {
      window.clearTimeout(cloudFallbackTimer);
      cloudFallbackTimer = window.setTimeout(loadCloudFallback, CLOUD_FALLBACK_DELAY_MS);
    };

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onopen = scheduleCloudFallback;
        socket.onmessage = (event) => {
          let message: any = event.data;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message?.type !== "route-state") return;

          wheelhouseAnswered = true;
          window.clearTimeout(cloudFallbackTimer);

          if (!Array.isArray(message.waypoints) || message.waypoints.length < 2) {
            clearBrowserRoute();
            return;
          }

          const normalized = normalizeRoute(message);
          if (!normalized) return;
          writeBrowserRoute(normalized);

          const needsRenumber = message.waypoints.some((wp: Waypoint, index: number) => String(wp?.id || "").trim() !== sequentialId(index));
          if (needsRenumber && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(normalized));
            fetch("/api/route-state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(normalized),
            }).catch(() => {});
          }
        };
        socket.onclose = () => {
          socket = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 2000);
        };
        socket.onerror = () => {};
      } catch {
        scheduleCloudFallback();
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();
    scheduleCloudFallback();

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(cloudFallbackTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return null;
}
