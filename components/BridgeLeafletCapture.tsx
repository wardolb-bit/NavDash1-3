"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

function invalidateCapturedMap() {
  const map = (window as any).__navdashLeafletMap;
  if (map?.invalidateSize) map.invalidateSize();
}

export function BridgeLeafletCapture({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(pathname !== "/");

  useEffect(() => {
    if (pathname !== "/") {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    import("leaflet")
      .then((leafletModule: any) => {
        if (cancelled) return;

        const L = leafletModule.default ?? leafletModule;
        const mapClass = L?.Map;

        if (mapClass && !mapClass.prototype.__navdashCaptureHookInstalled) {
          mapClass.prototype.__navdashCaptureHookInstalled = true;
          L.Map.addInitHook(function navdashCaptureMap(this: any) {
            if (this?._container?.id === "v12-map") {
              (window as any).__navdashLeafletMap = this;
            }
          });
        }

        setReady(true);
      })
      .catch(() => {
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/" || !ready) return;

    let cancelled = false;
    let retryTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    const settleTimers: number[] = [];

    const settleMap = () => {
      window.requestAnimationFrame(() => {
        window.setTimeout(invalidateCapturedMap, 80);
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

      for (const delay of [0, 120, 360, 750, 1200, 1800]) {
        settleTimers.push(window.setTimeout(settleMap, delay));
      }
    };

    watchMapElement();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
    };
  }, [pathname, ready]);

  if (!ready) return null;
  return <>{children}</>;
}
