"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const ROUTE_PANE = "navdash-route-restore-pane";

type Waypoint = { lat: number; lon: number };

function normalizeRoutePayload(payload: any): Waypoint[] {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  return raw
    .map((wp: any) => ({
      lat: Number(wp?.lat ?? wp?.latitude),
      lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
    }))
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
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
  for (let index = 1; index < route.length; index += 1) {
    const lon = longitudeNearReference(route[index].lon, previousLon);
    points.push([route[index].lat, lon]);
    previousLon = lon;
  }
  return points;
}

function readSavedRoute() {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [] as Waypoint[];
    return normalizeRoutePayload(JSON.parse(raw));
  } catch {
    return [] as Waypoint[];
  }
}

export function RouteRestoreOnMapReady() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let map: any = null;
    let L: any = null;
    let restoreLayer: any = null;
    let lastSignature = "";

    const hasNormalRoute = () => {
      let found = false;
      if (!map) return false;
      map.eachLayer((layer: any) => {
        if (layer?.__navdashRouteRestore) return;
        if (String(layer?.options?.color || "").toLowerCase() === "#c9a227" && typeof layer?.getLatLngs === "function") found = true;
        if (typeof layer?.eachLayer === "function") {
          try {
            layer.eachLayer((child: any) => {
              if (child?.__navdashRouteRestore) return;
              if (String(child?.options?.color || "").toLowerCase() === "#c9a227" && typeof child?.getLatLngs === "function") found = true;
            });
          } catch {}
        }
      });
      return found;
    };

    const clearRestore = () => {
      if (map && restoreLayer) {
        try { map.removeLayer(restoreLayer); } catch {}
      }
      restoreLayer = null;
    };

    const refresh = async () => {
      if (cancelled || !map || !L) return;

      if (hasNormalRoute()) {
        clearRestore();
        timer = window.setTimeout(refresh, 1500);
        return;
      }

      let route = readSavedRoute();
      if (route.length < 2) {
        try {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) route = normalizeRoutePayload(await response.json());
        } catch {}
      }

      const signature = route.map((wp) => `${wp.lat.toFixed(6)}|${wp.lon.toFixed(6)}`).join(";");
      if (route.length >= 2 && signature !== lastSignature) {
        clearRestore();
        lastSignature = signature;
        const referenceLon = map.getCenter().lng;
        const points = unwrapRouteNear(route, referenceLon);
        const copies = [-360, 0, 360].map((offset) => {
          const line = L.polyline(points.map(([lat, lon]) => [lat, lon + offset]), {
            pane: ROUTE_PANE,
            color: "#c9a227",
            weight: 4,
            opacity: 0.95,
            interactive: false,
          });
          line.__navdashRouteRestore = true;
          return line;
        });
        restoreLayer = L.layerGroup(copies).addTo(map);
        restoreLayer.__navdashRouteRestore = true;
      }

      timer = window.setTimeout(refresh, 1500);
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
        pane.style.zIndex = "650";
        pane.style.pointerEvents = "none";
      }

      void refresh();
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      clearRestore();
    };
  }, []);

  return null;
}
