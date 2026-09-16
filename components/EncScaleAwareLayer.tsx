"use client";

import { useEffect } from "react";
import { useBridgeTheme } from "../lib/useBridgeTheme";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_DIRECT_FRAGMENT = "gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline";
const NAVDASH_ENC_FRAGMENT = "/api/noaa-charts/wms";
const OSM_FRAGMENT = "tile.openstreetmap.org";
const OPENSEAMAP_FRAGMENT = "tiles.openseamap.org";
const BRIGHTNESS_STORAGE_KEY = "navdash-enc-brightness";
const BRIGHTNESS_EVENT = "navdash-enc-brightness-change";
const NIGHT_BRIGHTNESS = 140;

function s52NightDisplayParams() {
  return JSON.stringify({
    ECDISParameters: {
      version: "10.9",
      DynamicParameters: {
        Parameter: [
          { name: "ColorScheme", value: 5 },
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

export function EncScaleAwareLayer() {
  const { nightMode } = useBridgeTheme();

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let chartLayer: any = null;
    let mapRef: any = null;
    let previousBackground = "";
    const baseLayers: Array<{ layer: any; opacity: number }> = [];

    if (nightMode) {
      try { window.localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(NIGHT_BRIGHTNESS)); } catch {}
    }

    const restoreBaseLayers = () => {
      for (const item of baseLayers) {
        try { item.layer.setOpacity?.(item.opacity); } catch {}
      }
      if (mapRef) {
        try { mapRef.getContainer().style.background = previousBackground; } catch {}
      }
    };

    const onBrightnessChange = (event: Event) => {
      if (!nightMode) return;
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
      mapRef = map;
      previousBackground = map.getContainer?.().style?.background || "";

      const L = await import("leaflet");
      if (cancelled) return;

      for (const layer of Object.values(map._layers || {}) as any[]) {
        const url = String(layer?._url || "");
        if (url.includes(NOAA_DIRECT_FRAGMENT) || url.includes(NAVDASH_ENC_FRAGMENT)) {
          try { map.removeLayer(layer); } catch {}
          continue;
        }
        if (url.includes(OSM_FRAGMENT) || url.includes(OPENSEAMAP_FRAGMENT)) {
          const opacity = Number(layer?.options?.opacity);
          baseLayers.push({ layer, opacity: Number.isFinite(opacity) ? opacity : 1 });
        }
      }

      if (nightMode) {
        for (const item of baseLayers) {
          try { item.layer.setOpacity?.(0); } catch {}
        }
        try { map.getContainer().style.background = "#071019"; } catch {}

        chartLayer = L.tileLayer.wms(NAVDASH_ENC_FRAGMENT, {
          layers: "1,2,3,4,5,6,7",
          format: "image/png",
          transparent: true,
          version: "1.1.1",
          display_params: s52NightDisplayParams(),
          opacity: 1,
          tileSize: 512,
          updateWhenZooming: false,
          keepBuffer: 2,
          attribution: "NOAA Office of Coast Survey ENC Online",
        } as any).addTo(map);

        applyBrightness(chartLayer, NIGHT_BRIGHTNESS);
        chartLayer.on?.("load", () => applyBrightness(chartLayer));
      } else {
        restoreBaseLayers();
        chartLayer = L.tileLayer.wms(NAVDASH_ENC_FRAGMENT, {
          layers: "0,1,2,3,4,5,6,7",
          format: "image/png",
          transparent: true,
          version: "1.1.1",
          opacity: 0.9,
          tileSize: 512,
          updateWhenZooming: false,
          keepBuffer: 2,
          attribution: "NOAA Office of Coast Survey ENC Online",
        } as any).addTo(map);
      }
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(BRIGHTNESS_EVENT, onBrightnessChange);
      if (chartLayer && mapRef) {
        try { mapRef.removeLayer(chartLayer); } catch {}
      }
      restoreBaseLayers();
    };
  }, [nightMode]);

  return null;
}
