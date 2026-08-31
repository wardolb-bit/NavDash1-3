"use client";

import { useEffect, useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

const ROUTE_CACHE_KEY = "navdash-wx-routing-route";
const GRIB_CACHE_KEY = "navdash-wx-routing-grib";

function cacheJson(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser cache is only a fallback. Keep the live page working if storage is unavailable/full.
  }
}

function readJson(key: string) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearJson(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // No-op.
  }
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const rawUrl = request ? request.url : String(input);
  const url = new URL(rawUrl, window.location.href);
  const method = String(init?.method || request?.method || "GET").toUpperCase();
  return { path: url.pathname, method };
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default function WeatherRoutingDataBridge() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { path, method } = requestDetails(input, init);
      const isRoute = path === "/api/route-state";
      const isGrib = path === "/api/grib-summary";

      const response = await nativeFetch(input, init);

      if (!isRoute && !isGrib) return response;

      if (method === "DELETE") {
        clearJson(isRoute ? ROUTE_CACHE_KEY : GRIB_CACHE_KEY);
        return response;
      }

      if (method === "POST" && response.ok) {
        try {
          const data = await response.clone().json();
          if (isRoute && data?.hasRoute && Array.isArray(data?.waypoints) && data.waypoints.length >= 2) {
            cacheJson(ROUTE_CACHE_KEY, data);
          }
          if (isGrib && data?.hasGrib) {
            cacheJson(GRIB_CACHE_KEY, data);
          }
        } catch {
          // Leave the original fetch response untouched if it is not JSON.
        }
        return response;
      }

      if (method === "GET" && response.ok) {
        try {
          const data = await response.clone().json();
          if (isRoute) {
            if (data?.hasRoute && Array.isArray(data?.waypoints) && data.waypoints.length >= 2) {
              cacheJson(ROUTE_CACHE_KEY, data);
              return response;
            }
            const cached = readJson(ROUTE_CACHE_KEY);
            if (cached?.hasRoute && Array.isArray(cached?.waypoints) && cached.waypoints.length >= 2) {
              return jsonResponse(cached);
            }
          }

          if (isGrib) {
            if (data?.hasGrib) {
              cacheJson(GRIB_CACHE_KEY, data);
              return response;
            }
            const cached = readJson(GRIB_CACHE_KEY);
            if (cached?.hasGrib) {
              return jsonResponse(cached);
            }
          }
        } catch {
          // Use the network response unchanged if parsing fails.
        }
      }

      return response;
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(getAisWebSocketUrl());
      ws.onmessage = (event) => {
        if (closed) return;
        try {
          const message = JSON.parse(event.data);
          if (message?.type !== "route-state") return;
          if (!Array.isArray(message?.waypoints) || message.waypoints.length < 2) return;

          cacheJson(ROUTE_CACHE_KEY, {
            hasRoute: true,
            type: "route-state",
            routeName: message.routeName || "AIS Host Route",
            waypoints: message.waypoints,
            activeWaypointIndex: Number.isFinite(Number(message.activeWaypointIndex))
              ? Number(message.activeWaypointIndex)
              : 1,
            savedAt: message.savedAt || new Date().toISOString(),
          });
        } catch {
          // Ignore unrelated or malformed AIS websocket messages.
        }
      };
    } catch {
      // The normal WX page will continue handling AIS even if this bridge cannot connect.
    }

    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  return null;
}
