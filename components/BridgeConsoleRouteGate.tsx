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
import { NavMapZoomLimit } from "./NavMapZoomLimit";
import { NoaaLeafletPaneWeatherOverlay } from "./NoaaLeafletPaneWeatherOverlay";
import { CelestialConsoleSkin } from "./CelestialConsoleSkin";
import { MsiConsoleSkin } from "./MsiConsoleSkin";
import { NavDashMainLinkGuard } from "./NavDashMainLinkGuard";
import { SharedRouteSync } from "./SharedRouteSync";

export function BridgeConsoleRouteGate() {
  const pathname = usePathname();
  const isMainNavDashRoute = pathname === "/bridge" || pathname === "/mobile";

  let routeUi = <NavDashMainLinkGuard />;

  if (pathname.startsWith("/celestial")) {
    routeUi = (
      <>
        <NavDashMainLinkGuard />
        <CelestialConsoleSkin />
      </>
    );
  } else if (pathname === "/msi") {
    routeUi = (
      <>
        <NavDashMainLinkGuard />
        <MsiConsoleSkin />
      </>
    );
  } else if (isMainNavDashRoute) {
    routeUi = (
      <>
        <NavDashMainLinkGuard />
        <NavMapMainOverlayV2 />
        <MainMapDisplayControls />
        <EncScaleAwareLayer />
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
          .navdash-v12-day .bc2-rail-title > span:first-child {
            color: #52606d !important;
          }
          .navdash-v12-day #bc2-route,
          .navdash-v12-day #bc2-leg {
            color: #1f3a56 !important;
          }
        `}</style>
      </>
    );
  }

  return (
    <>
      <SharedRouteSync />
      {routeUi}
    </>
  );
}
