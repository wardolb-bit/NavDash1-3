"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const ROUTE_PANE = "navdash-preview-route-pane";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };

function normalizeRoutePayload(payload: any): Waypoint[] {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  return raw.map((wp: any) => ({
    id: typeof wp?.id === "string" ? wp.id : undefined,
    name: typeof wp?.name === "string" ? wp.name : undefined,
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function readSavedRoute(): Waypoint[] {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [];
    return normalizeRoutePayload(JSON.parse(raw));
  } catch {
    return [];
  }
}

function longitudeNearReference(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function unwrapRouteNear(route: Waypoint[], referenceLon: number) {
  if (!route.length) return [] as Array<[number, number]>;
  const points: Array<[number, number]> = [];
  let previousLon = longitudeNearReference(route[0].lon, referenceLon);
  points.push([route[0].lat, previousLon]);
  for (let i = 1; i < route.length; i += 1) {
    const lon = longitudeNearReference(route[i].lon, previousLon);
    points.push([route[i].lat, lon]);
    previousLon = lon;
  }
  return points;
}

export function PreviewRouteLineOverlay() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let refreshTimer = 0;
    let map: any = null;
    let L: any = null;
    let layer: any = null;
    let lastSignature = "";

    const draw = async () => {
      if (cancelled || !map || !L) return;

      let route = readSavedRoute();
      if (route.length < 2) {
        try {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) route = normalizeRoutePayload(await response.json());
        } catch {}
      }

      const signature = route.map((wp) => `${wp.id || ""}|${wp.name || ""}|${wp.lat.toFixed(6)}|${wp.lon.toFixed(6)}`).join(";");
      if (signature === lastSignature && layer) return;
      lastSignature = signature;

      if (layer) {
        try { map.removeLayer(layer); } catch {}
        layer = null;
      }
      if (route.length < 2) return;

      const referenceLon = map.getCenter().lng;
      const points = unwrapRouteNear(route, referenceLon);
      const offsets = [-360, 0, 360];
      const group = L.layerGroup();

      for (const offset of offsets) {
        const shifted = points.map(([lat, lon]) => [lat, lon + offset]);
        L.polyline(shifted, {
          pane: ROUTE_PANE,
          color: "#c9a227",
          weight: 4,
          opacity: 0.98,
          interactive: false,
        }).addTo(group);

        route.forEach((wp, index) => {
          L.circleMarker([points[index][0], points[index][1] + offset], {
            pane: ROUTE_PANE,
            radius: 5,
            color: "#c9a227",
            fillColor: "#c9a227",
            fillOpacity: 0.88,
            weight: 2,
            interactive: false,
          }).addTo(group);
        });
      }

      layer = group.addTo(map);
      try { layer.eachLayer((child: any) => child?.bringToFront?.()); } catch {}
    };

    const attach = async () => {
      if (cancelled) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      map = element?.__navdashLeafletMap;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      L = await import("leaflet");
      if (cancelled || !map) return;

      let pane = map.getPane(ROUTE_PANE);
      if (!pane) pane = map.createPane(ROUTE_PANE);
      if (pane?.style) {
        pane.style.zIndex = "610";
        pane.style.pointerEvents = "none";
      }

      await draw();
      refreshTimer = window.setInterval(() => { void draw(); }, 1500);
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(refreshTimer);
      try { if (map && layer) map.removeLayer(layer); } catch {}
    };
  }, []);

  return null;
}
