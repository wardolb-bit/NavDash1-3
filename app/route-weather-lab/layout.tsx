"use client";

import { useEffect, useState, type ReactNode } from "react";

const GC_THRESHOLD_NM = 250;
const GC_STEP_NM = 35;
const PATCH_KEY = "__navdashGcPolylinePatch";

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }

function nearLon(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function nmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
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

function greatCirclePoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }, fraction: number) {
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

function patchLeaflet(L: any) {
  if (L.Polyline.prototype[PATCH_KEY]) return;
  const originalInitialize = L.Polyline.prototype.initialize;
  L.Polyline.prototype.initialize = function patchedInitialize(latlngs: any, options: any) {
    if (!Array.isArray(latlngs) || latlngs.length < 2 || Array.isArray(latlngs[0]?.[0])) {
      return originalInitialize.call(this, latlngs, options);
    }
    const source = latlngs.map((value: any) => L.latLng(value));
    const out: any[] = [source[0]];
    let referenceLon = source[0].lng;
    for (let i = 1; i < source.length; i += 1) {
      const a = source[i - 1];
      const b = source[i];
      const distance = nmBetween(a, b);
      const segments = distance >= GC_THRESHOLD_NM ? Math.max(2, Math.ceil(distance / GC_STEP_NM)) : 1;
      for (let step = 1; step <= segments; step += 1) {
        const fraction = step / segments;
        const point = segments === 1 ? { lat: b.lat, lng: b.lng } : greatCirclePoint(a, b, fraction);
        const lng = nearLon(point.lng, referenceLon);
        out.push(L.latLng(point.lat, lng));
        referenceLon = lng;
      }
    }
    return originalInitialize.call(this, out, options);
  };
  L.Polyline.prototype[PATCH_KEY] = true;
}

export default function RouteWeatherLayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void import("leaflet").then((module) => {
      patchLeaflet(module);
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);
  return ready ? children : null;
}
