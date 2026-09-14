"use client";

import { useEffect } from "react";
import { useBridgeTheme } from "../lib/useBridgeTheme";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_DIRECT_FRAGMENT = "gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline";
const NAVDASH_ENC_FRAGMENT = "/api/noaa-charts/wms";

function s52DisplayParams(colorScheme: 0 | 5) {
  return JSON.stringify({
    ECDISParameters: {
      version: "10.9",
      DynamicParameters: {
        Parameter: [
          { name: "ColorScheme", value: colorScheme },
          { name: "DisplayFrames", value: 2 },
          { name: "DisplayFrameText", value: 0 },
        ],
      },
    },
  });
}

/**
 * Keeps the current NavDash map intact while rendering NOAA ENC through the
 * Maritime Chart Service export path. Day and Bridge Night request NOAA's
 * S-52 DAY/NIGHT portrayals directly; route, AIS, tools and overlays are not
 * changed here.
 */
export function EncScaleAwareLayer() {
  const { nightMode } = useBridgeTheme();

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

      // Remove only NOAA ENC layers. Leave OSM, OpenSeaMap and NavDash overlays alone.
      for (const layer of Object.values(map._layers || {}) as any[]) {
        const url = String(layer?._url || "");
        if (url.includes(NOAA_DIRECT_FRAGMENT) || url.includes(NAVDASH_ENC_FRAGMENT)) {
          try { map.removeLayer(layer); } catch {}
        }
      }

      L.tileLayer.wms(NAVDASH_ENC_FRAGMENT, {
        layers: "1,2,3,4,5,6,7",
        format: "image/png",
        transparent: false,
        version: "1.1.1",
        display_params: s52DisplayParams(nightMode ? 5 : 0),
        opacity: 1,
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
  }, [nightMode]);

  return null;
}
