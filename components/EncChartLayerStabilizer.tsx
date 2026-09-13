"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_WMS_URL = "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer";

export function EncChartLayerStabilizer() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let map: any = null;
    let replacementNoaaLayer: any = null;

    const attach = async () => {
      if (cancelled) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      map = element?.__navdashLeafletMap;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      const L = await import("leaflet");
      if (cancelled || !map) return;

      let existingNoaaLayer: any = null;
      map.eachLayer((layer: any) => {
        const url = String(layer?._url || "");
        if (url.includes("tiles.openseamap.org/seamark")) {
          try { map.removeLayer(layer); } catch {}
          return;
        }
        if (url.includes("MaritimeChartService/WMSServer")) existingNoaaLayer = layer;
      });

      if (existingNoaaLayer) {
        try { map.removeLayer(existingNoaaLayer); } catch {}
      }

      replacementNoaaLayer = L.tileLayer.wms(NOAA_WMS_URL, {
        layers: "1,2,3,4,5,6,7",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        opacity: 0.9,
        tileSize: 256,
        updateWhenZooming: false,
        updateWhenIdle: true,
        keepBuffer: 4,
        noWrap: true,
      } as any);
      replacementNoaaLayer.addTo(map);

      const pane = replacementNoaaLayer.getPane?.();
      if (pane?.style) pane.style.zIndex = "320";
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try {
        if (map && replacementNoaaLayer) map.removeLayer(replacementNoaaLayer);
      } catch {}
    };
  }, []);

  return null;
}
