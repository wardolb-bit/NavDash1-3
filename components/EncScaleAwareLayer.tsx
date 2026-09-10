"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_DIRECT_FRAGMENT = "gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline";

/**
 * Keeps the current NavDash map intact while restoring the original cached
 * NOAA ENC service path. NOAA's Maritime Chart Service selects the best-scale
 * ENC content as the requested map scale changes.
 */
export function EncScaleAwareLayer() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const attach = async () => {
      if (cancelled) return;

      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      const map = element?.__navdashLeafletMap;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      const L = await import("leaflet");
      if (cancelled) return;

      // Remove only the direct NOAA ENC WMS layer created by the base map.
      for (const layer of Object.values(map._layers || {}) as any[]) {
        const url = String(layer?._url || "");
        if (url.includes(NOAA_DIRECT_FRAGMENT)) {
          try { map.removeLayer(layer); } catch {}
        }
      }

      // Avoid adding a second cached ENC layer if this effect is re-run.
      const existing = Object.values(map._layers || {}).find((layer: any) =>
        String(layer?._url || "").includes("/api/noaa-charts/wms"),
      );
      if (existing) return;

      L.tileLayer.wms("/api/noaa-charts/wms", {
        layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        opacity: 0.9,
        tileSize: 512,
        updateWhenZooming: false,
        keepBuffer: 2,
        attribution: "NOAA Office of Coast Survey ENC Online",
      } as any).addTo(map);
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
