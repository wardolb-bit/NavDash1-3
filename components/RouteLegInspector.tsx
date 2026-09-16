"use client";

import { useEffect } from "react";

const ROUTE_COLOR = "#c9a227";
const INSPECTOR_PANE = "navmap-main-route-leg-inspector-v1";

type Point = { lat: number; lng: number };

function distanceAndBearing(from: Point, to: Point) {
  const radiusNm = 3440.065;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distanceNm = 2 * radiusNm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { distanceNm, bearing };
}

function isRoutePolyline(layer: any) {
  return typeof layer?.getLatLngs === "function"
    && String(layer?.options?.color || "").toLowerCase() === ROUTE_COLOR;
}

function visitLayers(layer: any, visitor: (candidate: any) => void) {
  visitor(layer);
  if (typeof layer?.eachLayer === "function") {
    layer.eachLayer((child: any) => visitLayers(child, visitor));
  }
}

function containsRoutePolyline(layer: any) {
  let found = false;
  visitLayers(layer, (candidate) => {
    if (!found && isRoutePolyline(candidate)) found = true;
  });
  return found;
}

function mainMap() {
  const element = document.getElementById("navmap-main-isolated-v2") as any;
  return element?.__navdashLeafletMap || null;
}

export function RouteLegInspector() {
  useEffect(() => {
    let disposed = false;
    let map: any = null;
    let L: any = null;
    let inspectorLayer: any = null;
    let retryTimer = 0;

    const rebuild = () => {
      if (disposed || !map || !L || !inspectorLayer) return;
      inspectorLayer.clearLayers();

      map.eachLayer((topLayer: any) => {
        if (topLayer === inspectorLayer) return;
        visitLayers(topLayer, (layer) => {
          if (!isRoutePolyline(layer)) return;
          const latLngs = layer.getLatLngs();
          if (!Array.isArray(latLngs) || latLngs.length < 2 || Array.isArray(latLngs[0])) return;

          for (let i = 1; i < latLngs.length; i += 1) {
            const from = latLngs[i - 1] as Point;
            const to = latLngs[i] as Point;
            const result = distanceAndBearing(from, to);
            const brg = String(Math.round(result.bearing) % 360).padStart(3, "0");
            const content = `<strong>LEG ${i}</strong><br>${brg}°T · ${result.distanceNm.toFixed(1)} NM`;

            const hitLine = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
              pane: INSPECTOR_PANE,
              color: "#67e8f9",
              weight: 18,
              opacity: 0.001,
              interactive: true,
              bubblingMouseEvents: false,
            }).bindTooltip(content, {
              direction: "top",
              sticky: true,
              opacity: 0.98,
              className: "navmap-route-leg-inspector",
              pane: INSPECTOR_PANE,
            });

            hitLine.on("mouseover", () => hitLine.setStyle({ opacity: 0.22, weight: 8 }));
            hitLine.on("mouseout", () => hitLine.setStyle({ opacity: 0.001, weight: 18 }));
            hitLine.on("click", (event: any) => hitLine.openTooltip(event.latlng));
            hitLine.addTo(inspectorLayer);
          }
        });
      });
    };

    const onLayerChange = (event: any) => {
      if (containsRoutePolyline(event?.layer)) window.requestAnimationFrame(rebuild);
    };

    const detach = () => {
      if (map) {
        map.off("layeradd", onLayerChange);
        map.off("layerremove", onLayerChange);
        if (inspectorLayer) {
          try { map.removeLayer(inspectorLayer); } catch {}
        }
      }
      map = null;
      inspectorLayer = null;
    };

    const attach = async () => {
      if (disposed) return;
      const nextMap = mainMap();
      if (!nextMap) {
        retryTimer = window.setTimeout(attach, 250);
        return;
      }
      if (map === nextMap) return;

      detach();
      L = await import("leaflet");
      if (disposed) return;
      map = nextMap;

      if (!map.getPane(INSPECTOR_PANE)) {
        const pane = map.createPane(INSPECTOR_PANE);
        pane.style.zIndex = "711";
      }

      inspectorLayer = L.layerGroup([], { pane: INSPECTOR_PANE } as any).addTo(map);
      map.on("layeradd", onLayerChange);
      map.on("layerremove", onLayerChange);
      rebuild();
    };

    const onMapReady = () => { void attach(); };
    window.addEventListener("navdash-leaflet-map-ready", onMapReady);
    void attach();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("navdash-leaflet-map-ready", onMapReady);
      detach();
    };
  }, []);

  return (
    <style>{`.navmap-route-leg-inspector{background:rgba(5,10,15,.94)!important;border:1px solid rgba(103,232,249,.60)!important;color:#d9fbff!important;box-shadow:0 2px 8px rgba(0,0,0,.45)!important;font:700 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace!important;padding:5px 7px!important;white-space:nowrap!important}.navmap-route-leg-inspector strong{color:#f1d56b!important;letter-spacing:.06em}.navmap-route-leg-inspector:before{border-top-color:rgba(103,232,249,.60)!important}`}</style>
  );
}
