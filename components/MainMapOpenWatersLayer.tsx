"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const OPENWATERS_STYLE = "https://tiles.openwaters.io/seamap/style.json";

function isLegacyBaseLayer(layer: any) {
  const url = String(layer?._url || "");
  return url.includes("tile.openstreetmap.org") || url.includes("tiles.openseamap.org/seamark");
}

export function MainMapOpenWatersLayer() {
  useEffect(() => {
    let disposed = false;
    let retryTimer = 0;
    let glMap: any = null;
    let mapContainer: HTMLDivElement | null = null;
    let attributionControl: any = null;
    const removedLegacyLayers: any[] = [];
    const boundEvents: Array<[string, () => void]> = [];

    if (!document.querySelector('link[data-navdash-maplibre-css="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css";
      link.setAttribute("data-navdash-maplibre-css", "true");
      document.head.appendChild(link);
    }

    const attach = async () => {
      if (disposed || glMap) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      const map = element?.__navdashLeafletMap;
      if (!map) {
        retryTimer = window.setTimeout(attach, 250);
        return;
      }

      try {
        const L: any = await import("leaflet");
        const maplibreModule: any = await import("maplibre-gl");
        const MapLibreMap: any = maplibreModule.Map || maplibreModule.default?.Map;
        if (disposed || !MapLibreMap) return;

        mapContainer = document.createElement("div");
        mapContainer.className = "navdash-openwaters-map";
        mapContainer.style.position = "absolute";
        mapContainer.style.inset = "0";
        mapContainer.style.width = "100%";
        mapContainer.style.height = "100%";
        mapContainer.style.zIndex = "150";
        mapContainer.style.pointerEvents = "none";
        mapContainer.style.overflow = "hidden";
        element.appendChild(mapContainer);

        const center = map.getCenter();
        glMap = new MapLibreMap({
          container: mapContainer,
          style: OPENWATERS_STYLE,
          center: [center.lng, center.lat],
          zoom: Math.max(0, map.getZoom() - 1),
          interactive: false,
          attributionControl: false,
          renderWorldCopies: true,
        } as any);

        const sync = () => {
          if (!glMap || disposed) return;
          const nextCenter = map.getCenter();
          glMap.jumpTo({
            center: [nextCenter.lng, nextCenter.lat],
            zoom: Math.max(0, map.getZoom() - 1),
            bearing: 0,
            pitch: 0,
          } as any);
          glMap.resize();
        };

        for (const eventName of ["move", "zoom", "moveend", "zoomend", "resize"]) {
          map.on(eventName, sync);
          boundEvents.push([eventName, sync]);
        }

        glMap.once("load", () => {
          if (disposed) return;
          sync();

          map.eachLayer((layer: any) => {
            if (!isLegacyBaseLayer(layer)) return;
            removedLegacyLayers.push(layer);
            try { map.removeLayer(layer); } catch {}
          });

          if (!attributionControl) {
            attributionControl = L.control({ position: "bottomright" });
            attributionControl.onAdd = () => {
              const div = L.DomUtil.create("div", "navdash-openwaters-attribution");
              div.innerHTML = '© <a href="https://openwaters.io/charts/seamap/" target="_blank" rel="noreferrer">Open Waters: Seamap</a> · © OpenStreetMap contributors · NOT FOR NAVIGATION';
              return div;
            };
            attributionControl.addTo(map);
          }
        });

        glMap.on("error", (event: any) => {
          console.warn("OpenWaters map layer error", event?.error || event);
        });
      } catch (error) {
        console.warn("OpenWaters map layer unavailable", error);
      }
    };

    const onMapReady = () => void attach();
    window.addEventListener("navdash-leaflet-map-ready", onMapReady);
    void attach();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("navdash-leaflet-map-ready", onMapReady);
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      const map = element?.__navdashLeafletMap;
      if (map) {
        for (const [eventName, handler] of boundEvents) {
          try { map.off(eventName, handler); } catch {}
        }
        if (attributionControl) {
          try { map.removeControl(attributionControl); } catch {}
        }
        for (const layer of removedLegacyLayers) {
          try { layer.addTo(map); } catch {}
        }
      }
      if (glMap) {
        try { glMap.remove(); } catch {}
        glMap = null;
      }
      if (mapContainer?.parentElement) mapContainer.parentElement.removeChild(mapContainer);
      mapContainer = null;
    };
  }, []);

  return (
    <style jsx global>{`
      #${MAP_ELEMENT_ID} > .navdash-openwaters-map {
        position: absolute !important;
        inset: 0 !important;
        z-index: 150 !important;
        pointer-events: none !important;
      }
      #${MAP_ELEMENT_ID} > .navdash-openwaters-map .maplibregl-canvas-container,
      #${MAP_ELEMENT_ID} > .navdash-openwaters-map .maplibregl-canvas {
        width: 100% !important;
        height: 100% !important;
      }
      .navdash-openwaters-attribution {
        padding: 2px 5px;
        border: 1px solid rgba(0,0,0,.18);
        background: rgba(255,255,255,.82);
        color: #1f2937;
        font: 8px/1.2 system-ui, sans-serif;
        pointer-events: auto;
      }
      .navdash-openwaters-attribution a { color: inherit; text-decoration: none; }
      html[data-navdash-theme="night"] .navdash-openwaters-attribution {
        border-color: rgba(255,255,255,.16);
        background: rgba(4,8,12,.82);
        color: #cbd5e1;
      }
    `}</style>
  );
}
