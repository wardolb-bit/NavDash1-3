"use client";

import { useEffect, useRef } from "react";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const LABEL_PANE = "navmap-main-route-leg-labels-v1";

type Waypoint = { lat: number; lon: number };
type StoredRoute = { waypoints?: Waypoint[] };

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function normalize360(value: number) { return ((value % 360) + 360) % 360; }
function lonDelta(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }

function distanceNm(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(lonDelta(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(lonDelta(b.lon - a.lon));
  return normalize360(deg(Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  )));
}

function mapInstance() {
  const element = document.getElementById("navmap-main-isolated-v2") as any;
  return element?.__navdashLeafletMap || null;
}

function readRoute(): Waypoint[] {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY) || window.sessionStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRoute;
    return (Array.isArray(parsed?.waypoints) ? parsed.waypoints : [])
      .map((wp) => ({ lat: Number(wp?.lat), lon: Number(wp?.lon) }))
      .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
  } catch {
    return [];
  }
}

export function RouteLegLabels() {
  const layerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const routeKeyRef = useRef("");

  useEffect(() => {
    let disposed = false;
    let timer = 0;

    const sync = async () => {
      if (disposed) return;
      const route = readRoute();
      const routeKey = JSON.stringify(route);
      const map = mapInstance();
      if (!map) return;

      if (mapRef.current !== map) {
        if (layerRef.current && mapRef.current) {
          try { mapRef.current.removeLayer(layerRef.current); } catch {}
        }
        mapRef.current = map;
        layerRef.current = null;
        routeKeyRef.current = "";
      }

      if (routeKeyRef.current === routeKey && layerRef.current) return;

      const L = await import("leaflet");
      if (disposed || mapRef.current !== map) return;

      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch {}
      }

      if (!map.getPane(LABEL_PANE)) {
        const pane = map.createPane(LABEL_PANE);
        pane.style.zIndex = "710";
        pane.style.pointerEvents = "none";
      }

      const layer = L.layerGroup([], { pane: LABEL_PANE } as any).addTo(map);
      layerRef.current = layer;
      routeKeyRef.current = routeKey;

      for (let i = 1; i < route.length; i += 1) {
        const a = route[i - 1];
        const b = route[i];
        const midLon = a.lon + lonDelta(b.lon - a.lon) / 2;
        const midpoint: [number, number] = [(a.lat + b.lat) / 2, ((midLon + 540) % 360) - 180];
        const brg = String(Math.round(bearing(a, b)) % 360).padStart(3, "0");
        const dist = distanceNm(a, b).toFixed(1);

        L.marker(midpoint, {
          pane: LABEL_PANE,
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "navmap-main-route-leg-label",
            iconSize: [108, 22],
            iconAnchor: [54, 11],
            html: `<div style="display:inline-block;white-space:nowrap;padding:2px 5px;border:1px solid rgba(34,211,238,.45);border-radius:3px;background:rgba(5,10,15,.86);color:#c9f7ff;font:700 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;box-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:none">${brg}°  ${dist} NM</div>`,
          }),
        }).addTo(layer);
      }
    };

    void sync();
    timer = window.setInterval(() => { void sync(); }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (layerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch {}
      }
      layerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  return null;
}
