"use client";

import { useEffect, useRef } from "react";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const ROUTE_COLOR = "#c9a227";
const GREAT_CIRCLE_THRESHOLD_NM = 250;
const GREAT_CIRCLE_STEP_NM = 50;

type Waypoint = { lat: number; lon: number; geometryType?: "Orthodrome" | "Loxodrome" };

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function nearLon(lon: number, reference: number) {
  let value = lon;
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
}

function distanceNm(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat), p2 = rad(b.lat);
  const dp = rad(b.lat - a.lat);
  let dlDeg = b.lon - a.lon;
  while (dlDeg > 180) dlDeg -= 360;
  while (dlDeg < -180) dlDeg += 360;
  const dl = rad(dlDeg);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function greatCirclePoint(a: Waypoint, b: Waypoint, fraction: number) {
  const p1 = rad(a.lat), l1 = rad(a.lon);
  const p2 = rad(b.lat), l2 = rad(b.lon);
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
  const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-12) return { lat: a.lat, lon: a.lon };
  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - fraction) * omega) / sinOmega;
  const wb = Math.sin(fraction * omega) / sinOmega;
  const x = wa * v1[0] + wb * v2[0];
  const y = wa * v1[1] + wb * v2[1];
  const z = wa * v1[2] + wb * v2[2];
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}

function displayRoute(route: Waypoint[], referenceLon: number) {
  if (!route.length) return [] as Array<[number, number]>;
  const result: Array<[number, number]> = [];
  let previousLon = nearLon(route[0].lon, referenceLon);
  result.push([route[0].lat, previousLon]);

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const legNm = distanceNm(start, end);
    const isOrthodrome = end.geometryType === "Orthodrome";
    const segments = isOrthodrome && legNm >= GREAT_CIRCLE_THRESHOLD_NM
      ? Math.max(2, Math.ceil(legNm / GREAT_CIRCLE_STEP_NM))
      : 1;
    for (let step = 1; step <= segments; step += 1) {
      const point = segments === 1 ? end : greatCirclePoint(start, end, step / segments);
      const lon = nearLon(point.lon, previousLon);
      result.push([point.lat, lon]);
      previousLon = lon;
    }
  }
  return result;
}

function normalizeRoute(payload: any): Waypoint[] {
  return (Array.isArray(payload?.waypoints) ? payload.waypoints : []).map((wp: any) => ({
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
    geometryType: wp?.geometryType === "Orthodrome" || wp?.geometryType === "Loxodrome" ? wp.geometryType : undefined,
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
}

function savedRoute() {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    return raw ? normalizeRoute(JSON.parse(raw)) : [];
  } catch { return []; }
}

export function BridgeGreatCircleRoute() {
  const signatureRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let overlay: any = null;

    const refresh = async () => {
      if (cancelled) return;
      const host = document.getElementById("v12-map");
      const surface = document.getElementById("navmap-main-isolated-v2") as any;
      const map = surface?.__navdashLeafletMap;
      if (!host || !map) {
        timer = window.setTimeout(refresh, 300);
        return;
      }

      let route = savedRoute();
      if (route.length < 2) {
        try {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) route = normalizeRoute(await response.json());
        } catch {}
      }
      if (route.length < 2) {
        timer = window.setTimeout(refresh, 1200);
        return;
      }

      const signature = route.map((wp) => `${wp.lat.toFixed(6)},${wp.lon.toFixed(6)},${wp.geometryType || ""}`).join(";");
      let rawRouteVisible = false;
      map.eachLayer((layer: any) => {
        const color = String(layer?.options?.color || "").toLowerCase();
        if (color === ROUTE_COLOR && Number(layer?.options?.weight) === 4 && layer !== overlay) rawRouteVisible = true;
      });

      if (signature !== signatureRef.current || rawRouteVisible || !overlay) {
        signatureRef.current = signature;
        const L = await import("leaflet");
        if (overlay) { try { map.removeLayer(overlay); } catch {} }
        map.eachLayer((layer: any) => {
          const color = String(layer?.options?.color || "").toLowerCase();
          if (color === ROUTE_COLOR && Number(layer?.options?.weight) === 4) {
            try { map.removeLayer(layer); } catch {}
          }
        });
        const referenceLon = map.getCenter().lng;
        const points = displayRoute(route, referenceLon);
        overlay = L.layerGroup([-360, 0, 360].map((offset) => L.polyline(points.map(([lat, lon]) => [lat, lon + offset]) as any, {
          color: ROUTE_COLOR,
          weight: 4,
          opacity: 0.95,
          interactive: false,
        }))).addTo(map);
      }

      timer = window.setTimeout(refresh, 1200);
    };

    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const surface = document.getElementById("navmap-main-isolated-v2") as any;
      const map = surface?.__navdashLeafletMap;
      if (map && overlay) { try { map.removeLayer(overlay); } catch {} }
    };
  }, []);

  return null;
}
