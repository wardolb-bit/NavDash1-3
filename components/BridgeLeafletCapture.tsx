"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

export function BridgeLeafletCapture() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (pathname !== "/") return;

    let cancelled = false;

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

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
