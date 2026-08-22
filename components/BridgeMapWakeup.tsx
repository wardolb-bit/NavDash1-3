"use client";

import { useEffect } from "react";

/**
 * Force a real map-container size change after the bridge layout settles.
 * app/page.tsx already observes #v12-map with ResizeObserver and calls
 * Leaflet map.invalidateSize() whenever the container size changes.
 *
 * Browser zoom was proving this path works, so this reproduces that layout
 * nudge without touching the map instance, AIS, or navigation logic.
 */
export function BridgeMapWakeup() {
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    const nudge = () => {
      if (cancelled) return;
      const map = document.getElementById("v12-map") as HTMLElement | null;
      if (!map || !map.querySelector(".leaflet-pane")) return;

      const previousWidth = map.style.getPropertyValue("width");
      const previousPriority = map.style.getPropertyPriority("width");

      map.style.setProperty("width", "calc(100% - 1px)", "important");
      // Force the browser to commit the one-pixel geometry change.
      void map.getBoundingClientRect().width;

      requestAnimationFrame(() => {
        if (cancelled) return;
        if (previousWidth) {
          map.style.setProperty("width", previousWidth, previousPriority || undefined);
        } else {
          map.style.removeProperty("width");
        }
        void map.getBoundingClientRect().width;
        window.dispatchEvent(new Event("resize"));
      });
    };

    const waitForLeaflet = (attempt = 0) => {
      if (cancelled) return;
      const map = document.getElementById("v12-map");
      if (map?.querySelector(".leaflet-pane")) {
        [80, 250, 650].forEach((delay) => {
          timers.push(window.setTimeout(nudge, delay));
        });
        return;
      }
      if (attempt < 80) timers.push(window.setTimeout(() => waitForLeaflet(attempt + 1), 100));
    };

    waitForLeaflet();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}
