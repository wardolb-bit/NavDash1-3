"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

function invalidateCapturedMap() {
  const map = (window as any).__navdashLeafletMap;
  if (map?.invalidateSize) map.invalidateSize();
}

export function BridgeLeafletCapture() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (pathname !== "/") return;

    let cancelled = false;
    let retryTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    const settleTimers: number[] = [];

    const settleMap = () => {
      window.requestAnimationFrame(() => {
        window.setTimeout(invalidateCapturedMap, 60);
      });
    };

    const watchMapElement = () => {
      if (cancelled) return;

      const mapElement = document.getElementById("v12-map");
      if (!mapElement) {
        retryTimer = window.setTimeout(watchMapElement, 50);
        return;
      }

      resizeObserver = new ResizeObserver(settleMap);
      resizeObserver.observe(mapElement);

      for (const delay of [0, 100, 350, 900, 1500]) {
        settleTimers.push(window.setTimeout(settleMap, delay));
      }
    };

    import("leaflet")
      .then((leafletModule: any) => {
        if (cancelled) return;

        const L = leafletModule.default ?? leafletModule;
        const mapClass = L?.Map;
        if (!mapClass || mapClass.prototype.__navdashCaptureHookInstalled) return;

        mapClass.prototype.__navdashCaptureHookInstalled = true;
        L.Map.addInitHook(function navdashCaptureMap(this: any) {
          if (this?._container?.id === "v12-map") {
            (window as any).__navdashLeafletMap = this;
          }
        });
      })
      .catch(() => {
        // Keep navigation usable if Leaflet is not available yet.
      });

    watchMapElement();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
    };
  }, [pathname]);

  return null;
}
