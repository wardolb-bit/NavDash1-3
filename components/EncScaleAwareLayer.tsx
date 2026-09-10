"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_DIRECT_FRAGMENT = "gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline";
const ENC_PANE = "navdash-enc-pane";
const ENC_TILE_STYLE_ID = "navdash-enc-tile-seam-fix";
const ENC_BLEED_PX = 2;
const ENC_TILE_SIZE = 512;

/**
 * Keeps the current NavDash map intact while restoring the cached NOAA ENC
 * service path. NOAA's Maritime Chart Service selects best-scale ENC content
 * as the requested map scale changes. Optional diagnostic/quality overlays
 * remain off to avoid the large U/triangle symbology.
 *
 * Seam fix: the proxy requests a 2 px geographic bleed on every tile edge;
 * this pane renders the returned image 2 px outward to match that bleed.
 * Deployment trigger refreshed after Vercel plan upgrade.
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

      // Keep ENC in its own pane so the seam fix cannot affect other tiles.
      let encPane = map.getPane(ENC_PANE);
      if (!encPane) {
        encPane = map.createPane(ENC_PANE);
        encPane.style.zIndex = "260";
        encPane.style.pointerEvents = "none";
      }

      if (!document.getElementById(ENC_TILE_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = ENC_TILE_STYLE_ID;
        const renderedSize = ENC_TILE_SIZE + ENC_BLEED_PX * 2;
        style.textContent = `
          .leaflet-${ENC_PANE}-pane .leaflet-tile {
            width: ${renderedSize}px !important;
            height: ${renderedSize}px !important;
            margin-left: -${ENC_BLEED_PX}px !important;
            margin-top: -${ENC_BLEED_PX}px !important;
          }
        `;
        document.head.appendChild(style);
      }

      // Avoid adding a second cached ENC layer if this effect is re-run.
      const existing = Object.values(map._layers || {}).find((layer: any) =>
        String(layer?._url || "").includes("/api/noaa-charts/wms"),
      );
      if (existing) return;

      L.tileLayer.wms("/api/noaa-charts/wms", {
        layers: "0,1,2,3,4,5,6,7",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        opacity: 0.9,
        tileSize: ENC_TILE_SIZE,
        updateWhenZooming: false,
        keepBuffer: 2,
        pane: ENC_PANE,
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
