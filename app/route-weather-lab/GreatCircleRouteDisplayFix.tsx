"use client";

import { useEffect } from "react";

type GeometryType = "GreatCircle" | "Loxodrome";
type RouteWaypoint = { lat: number; lon: number; geometryType?: GeometryType };
type LatLngLike = { lat: number; lng: number };

const PATCH_KEY = "__navdashRouteWeatherGcDisplayPatch";
const ROUTE_CACHE_KEY = "__navdashRouteWeatherDisplayRoute";
const STEP_NM = 35;

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }

function nearLon(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function nmBetween(a: LatLngLike, b: LatLngLike) {
  const r = 3440.065;
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = rad(b.lat - a.lat);
  let dlDeg = b.lng - a.lng;
  while (dlDeg > 180) dlDeg -= 360;
  while (dlDeg < -180) dlDeg += 360;
  const dl = rad(dlDeg);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function greatCirclePoint(a: LatLngLike, b: LatLngLike, fraction: number) {
  const p1 = rad(a.lat), l1 = rad(a.lng), p2 = rad(b.lat), l2 = rad(b.lng);
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
  const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-12) return { lat: a.lat, lng: a.lng };
  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - fraction) * omega) / sinOmega;
  const wb = Math.sin(fraction * omega) / sinOmega;
  const x = wa * v1[0] + wb * v2[0];
  const y = wa * v1[1] + wb * v2[1];
  const z = wa * v1[2] + wb * v2[2];
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lng: deg(Math.atan2(y, x)) };
}

function normalizeGeometry(value: unknown): GeometryType | undefined {
  if (typeof value !== "string") return undefined;
  if (/great/i.test(value)) return "GreatCircle";
  if (/lox|rhumb/i.test(value)) return "Loxodrome";
  return undefined;
}

function parseRouteState(json: any): RouteWaypoint[] {
  return (Array.isArray(json?.waypoints) ? json.waypoints : [])
    .map((wp: any) => ({
      lat: Number(wp?.lat ?? wp?.latitude),
      lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
      geometryType: normalizeGeometry(wp?.geometryType),
    }))
    .filter((wp: RouteWaypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function parseRtz(text: string): RouteWaypoint[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  return Array.from(doc.querySelectorAll("waypoint"))
    .map((node) => {
      const pos = node.querySelector("position");
      const leg = node.querySelector("leg");
      return {
        lat: Number(pos?.getAttribute("lat")),
        lon: Number(pos?.getAttribute("lon")),
        geometryType: normalizeGeometry(leg?.getAttribute("geometryType")),
      };
    })
    .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function closeEnough(a: number, b: number) {
  return Math.abs(a - b) < 0.0002;
}

function expandRoute(latlngs: LatLngLike[], route: RouteWaypoint[]) {
  if (latlngs.length !== route.length || route.length < 2) return latlngs;
  for (let i = 0; i < route.length; i += 1) {
    if (!closeEnough(latlngs[i].lat, route[i].lat)) return latlngs;
    if (!closeEnough(nearLon(latlngs[i].lng, route[i].lon), route[i].lon)) return latlngs;
  }

  const expanded: LatLngLike[] = [{ lat: latlngs[0].lat, lng: latlngs[0].lng }];
  let referenceLon = latlngs[0].lng;

  for (let i = 1; i < latlngs.length; i += 1) {
    const a = { lat: latlngs[i - 1].lat, lng: referenceLon };
    const rawB = latlngs[i];
    const b = { lat: rawB.lat, lng: nearLon(rawB.lng, referenceLon) };

    if (route[i].geometryType === "GreatCircle") {
      const segments = Math.max(2, Math.ceil(nmBetween(a, b) / STEP_NM));
      for (let step = 1; step <= segments; step += 1) {
        const point = greatCirclePoint(a, b, step / segments);
        const lng = nearLon(point.lng, referenceLon);
        expanded.push({ lat: point.lat, lng });
        referenceLon = lng;
      }
    } else {
      expanded.push(b);
      referenceLon = b.lng;
    }
  }

  return expanded;
}

export default function GreatCircleRouteDisplayFix() {
  useEffect(() => {
    let disposed = false;
    const w = window as any;

    const setRoute = (route: RouteWaypoint[]) => {
      if (route.length >= 2) w[ROUTE_CACHE_KEY] = route;
    };

    void fetch("/api/route-state", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((json) => { if (!disposed && json) setRoute(parseRouteState(json)); })
      .catch(() => {});

    const onFileChange = async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      const file = input?.files?.[0];
      if (!file || !/\.(rtz|xml)$/i.test(file.name)) return;
      try { setRoute(parseRtz(await file.text())); } catch {}
    };
    document.addEventListener("change", onFileChange, true);

    void import("leaflet").then((module) => {
      if (disposed) return;
      const L: any = module;
      if (L[PATCH_KEY]) return;
      L[PATCH_KEY] = true;
      const originalPolyline = L.polyline.bind(L);
      L.polyline = (latlngs: any, options?: any) => {
        const route: RouteWaypoint[] = w[ROUTE_CACHE_KEY] || [];
        const normalized = Array.isArray(latlngs)
          ? latlngs.map((p: any) => Array.isArray(p) ? { lat: Number(p[0]), lng: Number(p[1]) } : { lat: Number(p?.lat), lng: Number(p?.lng ?? p?.lon) })
          : [];
        const corrected = expandRoute(normalized, route);
        const changed = corrected.length !== normalized.length || corrected.some((p, i) => p.lat !== normalized[i]?.lat || p.lng !== normalized[i]?.lng);
        return originalPolyline(changed ? corrected : latlngs, options);
      };
    }).catch(() => {});

    return () => {
      disposed = true;
      document.removeEventListener("change", onFileChange, true);
    };
  }, []);

  return null;
}
