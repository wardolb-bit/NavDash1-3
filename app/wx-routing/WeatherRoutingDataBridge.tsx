"use client";

import { useEffect, useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

const ROUTE_CACHE_KEY = "navdash-wx-routing-route";
const GRIB_CACHE_KEY = "navdash-wx-routing-grib";
const SOURCE_KEY = "navdash-wx-routing-source";
const NOAA_ROUTE_RELOAD_KEY = "navdash-wx-routing-noaa-route-reload";

function cacheJson(key: string, value: unknown) { try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch {} }
function readJson(key: string) { try { const raw = window.sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function clearJson(key: string) { try { window.sessionStorage.removeItem(key); } catch {} }
function sourceMode() { try { return window.localStorage.getItem(SOURCE_KEY) === "noaa" ? "noaa" : "grib"; } catch { return "grib"; } }
function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.href);
  return { path: url.pathname, method: String(init?.method || request?.method || "GET").toUpperCase() };
}
function jsonResponse(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }); }
function validRoute(data: any) { return Boolean(data?.hasRoute && Array.isArray(data?.waypoints) && data.waypoints.length >= 2); }
function finite(value: any) { const number = Number(value); return Number.isFinite(number) ? number : null; }

function noaaRow(frame: any, point: any) {
  const source = typeof point?.source === "string" && point.source ? point.source : "NOAA / NWS";
  return {
    label: frame?.validAt || "NOAA",
    valid: frame?.validAt || "",
    forecast: source,
    windKt: finite(point?.windKt),
    windDir: finite(point?.windDirectionDeg),
    gustKt: finite(point?.gustKt),
    seasFt: finite(point?.waveHeightFt),
    swellFt: null,
    swellPeriod: finite(point?.wavePeriodSec),
    pressureHpa: finite(point?.pressureHpa),
    tempC: null,
  };
}

function nearestPoint(points: any[], lat: number, lon: number) {
  let best: any = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const point of points || []) {
    const dLat = Number(point?.lat) - lat;
    let dLon = Number(point?.lon) - lon;
    while (dLon > 180) dLon -= 360;
    while (dLon < -180) dLon += 360;
    const score = dLat * dLat + dLon * dLon;
    if (Number.isFinite(score) && score < bestScore) { best = point; bestScore = score; }
  }
  return best;
}

function worstNumber(rows: any[], key: string) {
  const values = rows.map((row) => finite(row?.[key])).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function noaaAsGrib(noaa: any, routeData: any) {
  const frames = Array.isArray(noaa?.frames) ? noaa.frames : [];
  const firstFrame = frames.find((frame: any) => Array.isArray(frame?.points) && frame.points.length) || null;
  if (!firstFrame) return null;

  const overlayPoints = firstFrame.points.map((basePoint: any, index: number) => {
    const lat = Number(basePoint.lat);
    const lon = Number(basePoint.lon);
    const timeline = frames.map((frame: any) => {
      const point = nearestPoint(frame?.points || [], lat, lon);
      return point ? noaaRow(frame, point) : null;
    }).filter(Boolean);
    const first = timeline[0] || noaaRow(firstFrame, basePoint);
    const wind = first.windKt === null ? "--" : `${Math.round(first.windKt)}kt`;
    const seas = first.seasFt === null ? "" : ` ${Number(first.seasFt).toFixed(1)}ft`;
    return {
      lat, lon,
      label: `N${index + 1} ${wind}${seas}`,
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
    return {
      label: frame?.validAt || "NOAA",
      valid: frame?.validAt || "",
      forecast: noaa?.product || "NOAA / NWS route forecast",
      windKt: worstNumber(points, "windKt"),
      windDir: null,
      gustKt: worstNumber(points, "gustKt"),
      seasFt: worstNumber(points, "waveHeightFt"),
      swellFt: null,
      swellPeriod: null,
      pressureHpa: null,
      tempC: null,
    };
  });

  const routeWaypoints = Array.isArray(routeData?.waypoints) ? routeData.waypoints : [];
  const routePoints = overlayPoints.map((point: any, index: number) => {
    const nearestWp = nearestPoint(routeWaypoints, point.lat, point.lon);
    const pointTimeline = point.timeline || [];
    const worstWindKt = Math.max(worstNumber(pointTimeline, "windKt") || 0, worstNumber(pointTimeline, "gustKt") || 0) || null;
    const worstSeasFt = worstNumber(pointTimeline, "seasFt");
    const worstRow = pointTimeline.reduce((worst: any, row: any) => {
      if (!worst) return row;
      const score = Math.max(row.windKt || 0, row.gustKt || 0) + (row.seasFt || 0) * 2;
      const worstScore = Math.max(worst.windKt || 0, worst.gustKt || 0) + (worst.seasFt || 0) * 2;
      return score > worstScore ? row : worst;
    }, null);
    return {
      id: nearestWp?.id || `N${index + 1}`,
      name: nearestWp?.name || `NOAA sample ${index + 1}`,
      lat: point.lat,
      lon: point.lon,
      worstWindKt,
      worstGustKt: worstNumber(pointTimeline, "gustKt"),
      worstSeasFt,
      worstSwellFt: null,
      worstSwellPeriod: worstNumber(pointTimeline, "swellPeriod"),
      worstValid: worstRow?.valid || pointTimeline[0]?.valid || "",
      timeline: pointTimeline,
    };
  });
  const worstWindPoint = routePoints.reduce((worst: any, point: any) => !worst || (point.worstWindKt || 0) > (worst.worstWindKt || 0) ? point : worst, null);
  const worstSeasPoint = routePoints.reduce((worst: any, point: any) => !worst || (point.worstSeasFt || 0) > (worst.worstSeasFt || 0) ? point : worst, null);

  return {
    hasGrib: true,
    fileName: "NOAA Route Forecast",
    fileSize: 0,
    loadedAt: noaa?.generatedAt || new Date().toISOString(),
    status: "NOAA route weather loaded",
    summary: `${noaa?.coveredSampleCount ?? overlayPoints.length}/${noaa?.sampleCount ?? overlayPoints.length} NOAA route samples`,
    sourceNotes: `${noaa?.provider || "NOAA / National Weather Service"} · ${noaa?.product || "Route forecast"}`,
    inventoryPreview: noaa?.note || "NOAA route weather source for WX Routing.",
    timeline,
    overlayPoints,
    routeForecast: {
      routeName: routeData?.routeName || "Loaded Route",
      sampledPoints: routePoints.length,
      routePoints,
      worstWindPoint,
      worstSeasPoint,
    },
    isobarGrid: [],
  };
}

function emptyNoaa(reason = "NOAA route weather is unavailable for the loaded route.") {
  return {
    hasGrib: false, fileName: "NOAA Route Forecast", fileSize: 0, loadedAt: new Date().toISOString(),
    status: "NOAA selected · no NOAA data available", summary: reason,
    sourceNotes: "NOAA / National Weather Service only",
    inventoryPreview: "GRIB is intentionally hidden while NOAA is selected.",
    timeline: [], overlayPoints: [], routeForecast: null, isobarGrid: [],
  };
}

async function loadNoaaFallback(nativeFetch: typeof window.fetch, routeData: any) {
  if (!validRoute(routeData)) return null;
  try {
    const response = await nativeFetch("/api/noaa-route-weather", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints: routeData.waypoints }), cache: "no-store",
    });
    if (!response.ok) return null;
    return noaaAsGrib(await response.json(), routeData);
  } catch { return null; }
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

      if (method === "DELETE") { clearJson(isRoute ? ROUTE_CACHE_KEY : GRIB_CACHE_KEY); return response; }
      if (method === "POST" && response.ok) {
        try {
          const data = await response.clone().json();
          if (isRoute && validRoute(data)) cacheJson(ROUTE_CACHE_KEY, data);
          if (isGrib && data?.hasGrib && data?.fileName !== "NOAA Route Forecast") cacheJson(GRIB_CACHE_KEY, data);
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
            if (sourceMode() === "grib") {
              if (data?.hasGrib && data?.fileName !== "NOAA Route Forecast") { cacheJson(GRIB_CACHE_KEY, data); return response; }
              const cached = readJson(GRIB_CACHE_KEY);
              if (cached?.hasGrib && cached?.fileName !== "NOAA Route Forecast") return jsonResponse(cached);
              return response;
            }
            let routeData = readJson(ROUTE_CACHE_KEY);
            if (!validRoute(routeData)) {
              try {
                const routeResponse = await nativeFetch("/api/route-state", { cache: "no-store" });
                if (routeResponse.ok) routeData = await routeResponse.json();
              } catch {}
            }
            if (!validRoute(routeData)) return jsonResponse(emptyNoaa("Load a route before requesting NOAA route weather."));
            const noaa = await loadNoaaFallback(nativeFetch, routeData);
            return jsonResponse(noaa || emptyNoaa());
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
          const routeData = {
            hasRoute: true, type: "route-state", routeName: message.routeName || "AIS Host Route",
            waypoints: message.waypoints,
            activeWaypointIndex: Number.isFinite(Number(message.activeWaypointIndex)) ? Number(message.activeWaypointIndex) : 1,
            savedAt: message.savedAt || new Date().toISOString(),
          };
          cacheJson(ROUTE_CACHE_KEY, routeData);
          if (sourceMode() === "noaa") {
            const signature = `${routeData.routeName}|${routeData.waypoints.length}|${routeData.savedAt}`;
            let lastSignature = "";
            try { lastSignature = window.sessionStorage.getItem(NOAA_ROUTE_RELOAD_KEY) || ""; } catch {}
            if (lastSignature !== signature) {
              try { window.sessionStorage.setItem(NOAA_ROUTE_RELOAD_KEY, signature); } catch {}
              window.setTimeout(() => window.location.reload(), 120);
            }
          }
        } catch {}
      };
    } catch {}
    return () => { closed = true; ws?.close(); };
  }, []);

  return null;
}
