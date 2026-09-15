"use client";

import { usePathname } from "next/navigation";
import { BridgeQuickAccess } from "./BridgeQuickAccess";
import { BridgeMapWakeup } from "./BridgeMapWakeup";
import { BridgeMapLayerControls } from "./BridgeMapLayerControls";
import { BridgeNextWaypointDistance } from "./BridgeNextWaypointDistance";
import { BridgeRouteDistanceWgs84 } from "./BridgeRouteDistanceWgs84";
import { BridgeLegSequenceDisplay } from "./BridgeLegSequenceDisplay";
import { NavMapMainOverlayV2 } from "./NavMapMainOverlayV2";
import { MainMapDisplayControls } from "./MainMapDisplayControls";
import { EncScaleAwareLayer } from "./EncScaleAwareLayer";
import { BridgeEncBrightnessMenu } from "./BridgeEncBrightnessMenu";
import { NavMapZoomLimit } from "./NavMapZoomLimit";
import { NoaaLeafletPaneWeatherOverlay } from "./NoaaLeafletPaneWeatherOverlay";

export function BridgeConsoleRouteGate() {
  const pathname = usePathname();
  const isMainNavDashRoute = pathname === "/bridge" || pathname === "/mobile";

  if (!isMainNavDashRoute) return null;

  return (
    <>
      <NavMapMainOverlayV2 />
      <MainMapDisplayControls />
      <EncScaleAwareLayer />
      <BridgeEncBrightnessMenu />
      <BridgeMapWakeup />
      <NavMapZoomLimit />
      <NoaaLeafletPaneWeatherOverlay />
      <BridgeMapLayerControls />
      <BridgeQuickAccess />
      <BridgeNextWaypointDistance />
      <BridgeRouteDistanceWgs84 />
      <BridgeLegSequenceDisplay />
      <style jsx global>{`
        .leaflet-navmap-main-ami-v1-pane .leaflet-tooltip-top {
          margin-top: -40px !important;
        }
      `}</style>
    </>
  );
}
