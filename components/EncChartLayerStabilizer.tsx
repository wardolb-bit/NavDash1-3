"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_WMS_URL = "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer";

export function EncChartLayerStabilizer() {
  useEffect(() => {
    let cancelled = false;
    let attachTimer = 0;
    let refreshTimer = 0;
    let map: any = null;
    let L: any = null;
    let overlay: any = null;
    let requestSerial = 0;

    const removeConflictingChartLayers = () => {
      if (!map) return;
      const remove: any[] = [];
      map.eachLayer((layer: any) => {
        if (layer?.__navdashSingleNoaaViewport) return;
        const url = String(layer?._url || "");
        if (
          url.includes("tiles.openseamap.org/seamark") ||
          url.includes("MaritimeChartService/WMSServer")
        ) {
          remove.push(layer);
        }
      });
      for (const layer of remove) {
        try { map.removeLayer(layer); } catch {}
      }
    };

    const buildNoaaUrl = () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const width = Math.max(256, Math.min(2048, Math.round(size.x)));
      const height = Math.max(256, Math.min(2048, Math.round(size.y)));

      const sw = L.CRS.EPSG3857.project(L.latLng(bounds.getSouth(), bounds.getWest()));
      const ne = L.CRS.EPSG3857.project(L.latLng(bounds.getNorth(), bounds.getEast()));

      const params = new URLSearchParams({
        service: "WMS",
        request: "GetMap",
        version: "1.1.1",
        layers: "1,2,3,4,5,6,7",
        styles: "",
        format: "image/png",
        transparent: "true",
        srs: "EPSG:3857",
        bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
        width: String(width),
        height: String(height),
      });

      return `${NOAA_WMS_URL}?${params.toString()}`;
    };

    const refresh = () => {
      if (cancelled || !map || !L) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (cancelled || !map) return;

        removeConflictingChartLayers();

        const bounds = map.getBounds();
        const url = buildNoaaUrl();
        const serial = ++requestSerial;

        const nextOverlay = L.imageOverlay(url, bounds, {
          opacity: 0.9,
          interactive: false,
          crossOrigin: true,
          pane: "overlayPane",
        });
        nextOverlay.__navdashSingleNoaaViewport = true;

        nextOverlay.once("load", () => {
          if (cancelled || serial !== requestSerial) {
            try { map.removeLayer(nextOverlay); } catch {}
            return;
          }
          const previous = overlay;
          overlay = nextOverlay;
          if (previous && previous !== overlay) {
            try { map.removeLayer(previous); } catch {}
          }
        });

        nextOverlay.once("error", () => {
          try { map.removeLayer(nextOverlay); } catch {}
        });

        // Start loading the next full-viewport chart image while the previous
        // one remains visible. Once the new image loads, swap them atomically.
        try { nextOverlay.addTo(map); } catch {}
      }, 140);
    };

    const onLayerAdd = (event: any) => {
      const layer = event?.layer;
      if (!layer || layer?.__navdashSingleNoaaViewport) return;
      const url = String(layer?._url || "");
      if (
        url.includes("tiles.openseamap.org/seamark") ||
        url.includes("MaritimeChartService/WMSServer")
      ) {
        try { map.removeLayer(layer); } catch {}
      }
    };

    const attach = async () => {
      if (cancelled) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      map = element?.__navdashLeafletMap;
      if (!map) {
        attachTimer = window.setTimeout(attach, 100);
        return;
      }

      L = await import("leaflet");
      if (cancelled || !map) return;

      removeConflictingChartLayers();
      map.on("moveend zoomend resize", refresh);
      map.on("layeradd", onLayerAdd);
      refresh();
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(attachTimer);
      window.clearTimeout(refreshTimer);
      try { if (map) map.off("moveend zoomend resize", refresh); } catch {}
      try { if (map) map.off("layeradd", onLayerAdd); } catch {}
      try { if (map && overlay) map.removeLayer(overlay); } catch {}
    };
  }, []);

  return null;
}
