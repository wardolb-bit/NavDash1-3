"use client";

import { useEffect, useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

const ROUTE_CACHE_KEY = "navdash-wx-routing-route";
const GRIB_CACHE_KEY = "navdash-wx-routing-grib";
const SOURCE_KEY = "navdash-wx-routing-source";

function cacheJson(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function readJson(key: string) {
  try { const raw = window.sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearJson(key: string) {
  try { window.sessionStorage.removeItem(key); } catch {}
}
function sourceMode() {
  try { return window.localStorage.getItem(SOURCE_KEY) === "noaa" ? "noaa" : "grib"; } catch { return "grib"; }
}
function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const rawUrl = request ? request.url : String(input);
  const url = new URL(rawUrl, window.location.href);
  const method = String(init?.method || request?.method || "GET").toUpperCase();
  return { path: url.pathname, method };
}
function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}
function validRoute(data: any) {
  return Boolean(data?.hasRoute && Array.isArray(data?.waypoints) && data.waypoints.length >= 2);
}
function noaaRow(frame: any, point: any) {
  return {
    label: frame?.validAt || "NOAA",
    valid: frame?.validAt || "",
    forecast: "NOAA / NWS route forecast",
    windKt: point?.windKt ?? null,
    windDir: point?.windDirectionDeg ?? null,
    gustKt: point?.gustKt ?? null,
    seasFt: point?.waveHeightFt ?? null,
    swellFt: null,
    swellPeriod: point?.wavePeriodSec ?? null,
    pressureHpa: null,
    tempC: null,
  };
}
function nearestPoint(points: any[], lat: number, lon: number) {
  let best: any = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const point of points || []) {
    const dLat = Number(point?.lat) - lat;
    const dLon = Number(point?.lon) - lon;
    const score = dLat * dLat + dLon * dLon;
    if (Number.isFinite(score) && score < bestScore) { best = point; bestScore = score; }
  }
  return best;
}
function noaaAsGrib(noaa: any) {
  const frames = Array.isArray(noaa?.frames) ? noaa.frames : [];
  const firstFrame = frames.find((frame: any) => Array.isArray(frame?.points) && frame.points.length) || null;
  if (!firstFrame) return null;
  const overlayPoints = firstFrame.points.map((basePoint: any, index: number) => {
    const lat = Number(basePoint.lat);
    const lon = Number(basePoint.lon);
    const timeline = frames.map((frame: any) => {
      const point = frame?.points?.[index] || nearestPoint(frame?.points || [], lat, lon);
      return point ? noaaRow(frame, point) : null;
    }).filter(Boolean);
    const first = timeline[0] || noaaRow(firstFrame, basePoint);
    return {
      lat,
      lon,
      label: `NOAA ${index + 1}`,
      valid: first.valid,
      windKt: first.windKt,
      windDir: first.windDir,
      gustKt: first.gustKt,
      seasFt: first.seasFt,
      swellFt: null,
      swellPeriod: first.swellPeriod,
      routePoint: `NOAA ${index + 1}`,
      timeline,
    };
  });
  const timeline = frames.map((frame: any) => {
    const points = Array.isArray(frame?.points) ? frame.points : [];
    const maxWind = points.reduce((max: number | null, point: any) => {
      const value = Math.max(Number(point?.windKt) || 0, Number(point?.gustKt) || 0);
      return max === null ? value : Math.max(max, value);
    }, null);
    const maxSeas = points.reduce((max: number | null, point: any) => {
      const value = Number(point?.waveHeightFt);
      if (!Number.isFinite(value)) return max;
      return max === null ? value : Math.max(max, value);
    }, null);
    return {
      label: frame?.validAt || "NOAA",
      valid: frame?.validAt || "",
      forecast: "NOAA / NWS route forecast",
      windKt: maxWind,
      windDir: null,
      gustKt: null,
      seasFt: maxSeas,
      swellFt: null,
      swellPeriod: null,
      pressureHpa: null,
      tempC: null,
    };
  });
  return {
    hasGrib: true,
    fileName: "NOAA Route Forecast",
    fileSize: 0,
    loadedAt: noaa?.generatedAt || new Date().toISOString(),
    status: "NOAA route weather loaded",
    summary: `${noaa?.coveredSampleCount ?? overlayPoints.length}/${noaa?.sampleCount ?? overlayPoints.length} NOAA route samples`,
    sourceNotes: `${noaa?.provider || "NOAA / National Weather Service"} · ${noaa?.product || "Route forecast"}`,
    inventoryPreview: "NOAA route weather source for WX Routing.",
    timeline,
    overlayPoints,
    routeForecast: null,
    isobarGrid: [],
  };
}

async function loadNoaaFallback(nativeFetch: typeof window.fetch, routeData: any) {
  if (!validRoute(routeData)) return null;
  try {
    const noaaResponse = await nativeFetch("/api/noaa-route-weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints: routeData.waypoints }),
      cache: "no-store",
    });
    if (!noaaResponse.ok) return null;
    return noaaAsGrib(await noaaResponse.json());
  } catch {
    return null;
  }
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
          if (isRoute && validRoute(data)) cacheJson(ROUTE_CACHE_KEY, data);
          if (isGrib && data?.hasGrib) cacheJson(GRIB_CACHE_KEY, data);
        } catch {}
        return response;
      }

      if (method === "GET" && response.ok) {
        try {
          const data = await response.clone().json();
          if (isRoute) {
            if (validRoute(data)) { cacheJson(ROUTE_CACHE_KEY, data); return response; }
            const cached = readJson(ROUTE_CACHE_KEY);
            if (validRoute(cached)) return jsonResponse(cached);
          }

          if (isGrib) {
            const forceNoaa = sourceMode() === "noaa";
            if (!forceNoaa && data?.hasGrib) { cacheJson(GRIB_CACHE_KEY, data); return response; }

            const cachedGrib = readJson(GRIB_CACHE_KEY);
            if (!forceNoaa && cachedGrib?.hasGrib && cachedGrib?.fileName !== "NOAA Route Forecast") return jsonResponse(cachedGrib);

            let routeData = readJson(ROUTE_CACHE_KEY);
            if (!validRoute(routeData)) {
              try {
                const routeResponse = await nativeFetch("/api/route-state", { cache: "no-store" });
                if (routeResponse.ok) routeData = await routeResponse.json();
              } catch {}
            }

            const noaa = await loadNoaaFallback(nativeFetch, routeData);
            if (noaa) {
              cacheJson(GRIB_CACHE_KEY, noaa);
              return jsonResponse(noaa);
            }

            if (data?.hasGrib) return response;
            if (cachedGrib?.hasGrib) return jsonResponse(cachedGrib);
          }
        } catch {}
      }

      return response;
    };

    return () => { window.fetch = nativeFetch; };
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
          if (message?.type !== "route-state" || !Array.isArray(message?.waypoints) || message.waypoints.length < 2) return;
          cacheJson(ROUTE_CACHE_KEY, {
            hasRoute: true,
            type: "route-state",
            routeName: message.routeName || "AIS Host Route",
            waypoints: message.waypoints,
            activeWaypointIndex: Number.isFinite(Number(message.activeWaypointIndex)) ? Number(message.activeWaypointIndex) : 1,
            savedAt: message.savedAt || new Date().toISOString(),
          });
        } catch {}
      };
    } catch {}
    return () => { closed = true; ws?.close(); };
  }, []);

  return null;
}
