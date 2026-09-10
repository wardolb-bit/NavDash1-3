"use client";

import { useEffect } from "react";

const MAX_CHART_ZOOM = 15;

type LeafletMapLike = {
  getZoom?: () => number;
  getMaxZoom?: () => number;
  setMaxZoom?: (zoom: number) => unknown;
  setZoom?: (zoom: number, options?: { animate?: boolean }) => unknown;
};

function findLeafletMap(element: HTMLElement): LeafletMapLike | null {
  const events = (element as HTMLElement & { _leaflet_events?: Record<string, unknown[]> })._leaflet_events;
  if (!events) return null;

  for (const handlers of Object.values(events)) {
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      const candidate = (handler as { ctx?: LeafletMapLike })?.ctx;
      if (candidate && typeof candidate.setMaxZoom === "function" && typeof candidate.getZoom === "function") {
        return candidate;
      }
    }
  }

  return null;
}

export function NavMapZoomLimit() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const apply = () => {
      if (cancelled) return;

      const element = document.getElementById("v12-map");
      const map = element ? findLeafletMap(element) : null;

      if (!map) {
        attempts += 1;
        if (attempts < 120) timer = window.setTimeout(apply, 100);
        return;
      }

      map.setMaxZoom?.(MAX_CHART_ZOOM);
      const zoom = map.getZoom?.();
      if (typeof zoom === "number" && zoom > MAX_CHART_ZOOM) {
        map.setZoom?.(MAX_CHART_ZOOM, { animate: false });
      }
    };

    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
