"use client";

import { useEffect } from "react";
import { useBridgeTheme } from "../lib/useBridgeTheme";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_DIRECT_FRAGMENT = "gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline";
const NAVDASH_ENC_FRAGMENT = "/api/noaa-charts/wms";
const BRIGHTNESS_STORAGE_KEY = "navdash-enc-brightness";
const BRIGHTNESS_EVENT = "navdash-enc-brightness-change";

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

function readBrightness() {
  try {
    const stored = Number(window.localStorage.getItem(BRIGHTNESS_STORAGE_KEY));
    if (!Number.isFinite(stored)) return 100;
    return Math.max(40, Math.min(140, stored));
  } catch {
    return 100;
  }
}

function applyBrightness(layer: any, value = readBrightness()) {
  const container = layer?.getContainer?.();
  if (container instanceof HTMLElement) {
    container.style.filter = `brightness(${value}%)`;
  }
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
    let chartLayer: any = null;

    const onBrightnessChange = (event: Event) => {
      const value = Number((event as CustomEvent<number>).detail);
      applyBrightness(chartLayer, Number.isFinite(value) ? value : readBrightness());
    };
    window.addEventListener(BRIGHTNESS_EVENT, onBrightnessChange);

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

      chartLayer = L.tileLayer.wms(NAVDASH_ENC_FRAGMENT, {
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

      applyBrightness(chartLayer);
      chartLayer.on?.("load", () => applyBrightness(chartLayer));
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(BRIGHTNESS_EVENT, onBrightnessChange);
    };
  }, [nightMode]);

  return null;
}
