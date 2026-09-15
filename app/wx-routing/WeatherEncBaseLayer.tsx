"use client";

import { useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

const MAP_EVENT = "navdash-wx-map-instance";
const MAP_HOOK_KEY = "__navdashWxEncMapHook";
const ENC_SOURCE_ID = "navdash-wx-enc-source";
const ENC_LAYER_ID = "navdash-wx-enc-layer";
const NIGHT_BACKGROUND_ID = "navdash-wx-enc-background";

function installMapCaptureHook() {
  if (typeof window === "undefined") return;
  const globalWindow = window as any;
  if (globalWindow[MAP_HOOK_KEY]) return;

  const prototype = (maplibregl as any).Map?.prototype;
  if (!prototype?.addControl) return;

  const originalAddControl = prototype.addControl;
  prototype.addControl = function (...args: any[]) {
    globalWindow.__navdashWxMapInstance = this;
    window.dispatchEvent(new CustomEvent(MAP_EVENT, { detail: this }));
    return originalAddControl.apply(this, args);
  };

  globalWindow[MAP_HOOK_KEY] = true;
}

installMapCaptureHook();

function installEnc(map: any) {
  if (!map || !map.isStyleLoaded?.()) return;

  if (!map.getLayer(NIGHT_BACKGROUND_ID)) {
    map.addLayer({
      id: NIGHT_BACKGROUND_ID,
      type: "background",
      paint: { "background-color": "#02070a" },
    });
  }

  if (!map.getSource(ENC_SOURCE_ID)) {
    map.addSource(ENC_SOURCE_ID, {
      type: "raster",
      tiles: [
        "/api/noaa-charts/wms?service=WMS&request=GetMap&layers=1,2,3,4,5,6,7&format=image/png&transparent=false&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}",
      ],
      tileSize: 256,
      attribution: "NOAA Maritime Chart Service",
    });
  }

  if (!map.getLayer(ENC_LAYER_ID)) {
    map.addLayer({
      id: ENC_LAYER_ID,
      type: "raster",
      source: ENC_SOURCE_ID,
      paint: {
        "raster-opacity": 1,
        "raster-fade-duration": 0,
      },
    });
  }

  if (map.getLayer("osm-base")) {
    map.setLayoutProperty("osm-base", "visibility", "none");
  }
}

function applyTheme(map: any, nightMode: boolean) {
  if (!map?.isStyleLoaded?.()) return;
  installEnc(map);

  if (map.getLayer(NIGHT_BACKGROUND_ID)) {
    map.setPaintProperty(NIGHT_BACKGROUND_ID, "background-color", nightMode ? "#02070a" : "#dbe5e8");
  }
  if (map.getLayer(ENC_LAYER_ID)) {
    map.setPaintProperty(ENC_LAYER_ID, "raster-opacity", nightMode ? 0.42 : 1);
    map.setPaintProperty(ENC_LAYER_ID, "raster-brightness-max", nightMode ? 0.56 : 1);
    map.setPaintProperty(ENC_LAYER_ID, "raster-contrast", nightMode ? 0.12 : 0);
    map.setPaintProperty(ENC_LAYER_ID, "raster-saturation", nightMode ? -0.35 : 0);
  }
}

export default function WeatherEncBaseLayer() {
  const { nightMode } = useBridgeTheme();
  const [map, setMap] = useState<any>(null);

  useEffect(() => {
    const existing = (window as any).__navdashWxMapInstance;
    if (existing) setMap(existing);

    const onMap = (event: Event) => {
      const nextMap = (event as CustomEvent).detail;
      if (nextMap) setMap(nextMap);
    };

    window.addEventListener(MAP_EVENT, onMap);
    return () => window.removeEventListener(MAP_EVENT, onMap);
  }, []);

  useEffect(() => {
    if (!map) return;

    const refresh = () => applyTheme(map, nightMode);
    if (map.isStyleLoaded?.()) refresh();
    else map.once?.("load", refresh);

    return () => {
      try { map.off?.("load", refresh); } catch {}
    };
  }, [map, nightMode]);

  return null;
}
