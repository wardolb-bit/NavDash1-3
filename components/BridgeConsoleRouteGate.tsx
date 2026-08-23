"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BridgeConsolePreview } from "./BridgeConsolePreview";
import { BridgeQuickAccess } from "./BridgeQuickAccess";
import { BridgeOwnShipEnhancer } from "./BridgeOwnShipEnhancer";
import { BridgeRailPolish } from "./BridgeRailPolish";
import { BridgeMapWakeup } from "./BridgeMapWakeup";
import { BridgeMapLayerControls } from "./BridgeMapLayerControls";
import { BridgeNextWaypointDistance } from "./BridgeNextWaypointDistance";
import { BridgeRouteDistanceWgs84 } from "./BridgeRouteDistanceWgs84";
import { NavMapMainOverlayV2 } from "./NavMapMainOverlayV2";

/**
 * Keep the bridge-console DOM enhancers scoped to the main Nav Console route.
 *
 * The helpers also wait until Leaflet has actually initialized the main map.
 * This avoids racing the map mount on route return, which can leave the map
 * container resized before Leaflet has created its panes/tiles.
 */
export function BridgeConsoleRouteGate() {
  const pathname = usePathname();
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    setMapReady(false);
    if (pathname !== "/") return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const waitForLeaflet = () => {
      if (cancelled) return;

      const map = document.getElementById("v12-map");
      const leafletReady = !!map?.querySelector(".leaflet-map-pane, .leaflet-pane");

      if (leafletReady) {
        setMapReady(true);
        return;
      }

      attempts += 1;
      if (attempts < 120) {
        timer = window.setTimeout(waitForLeaflet, 100);
      }
    };

    waitForLeaflet();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  if (pathname !== "/" || !mapReady) return null;

  return (
    <>
      <BridgeConsolePreview />
      <BridgeMapWakeup />
      <NavMapMainOverlayV2 />
      <BridgeMapLayerControls />
      <BridgeOwnShipEnhancer />
      <BridgeRailPolish />
      <BridgeQuickAccess />
      <BridgeNextWaypointDistance />
      <BridgeRouteDistanceWgs84 />
    </>
  );
}
