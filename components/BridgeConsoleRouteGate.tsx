"use client";

import { usePathname } from "next/navigation";
import { BridgeQuickAccess } from "./BridgeQuickAccess";
import { BridgeOwnShipEnhancer } from "./BridgeOwnShipEnhancer";
import { BridgeRailPolish } from "./BridgeRailPolish";
import { BridgeMapWakeup } from "./BridgeMapWakeup";
import { BridgeMapLayerControls } from "./BridgeMapLayerControls";
import { BridgeNextWaypointDistance } from "./BridgeNextWaypointDistance";
import { BridgeRouteDistanceWgs84 } from "./BridgeRouteDistanceWgs84";
import { BridgeLegSequenceDisplay } from "./BridgeLegSequenceDisplay";
import { NavMapMainOverlayV2 } from "./NavMapMainOverlayV2";
import { NavMapZoomLimit } from "./NavMapZoomLimit";
import { NoaaLeafletPaneWeatherOverlay } from "./NoaaLeafletPaneWeatherOverlay";
import { CelestialConsoleSkin } from "./CelestialConsoleSkin";
import { MsiConsoleSkin } from "./MsiConsoleSkin";
import { NavDashMainLinkGuard } from "./NavDashMainLinkGuard";

export function BridgeConsoleRouteGate() {
  const pathname = usePathname();
  const isMainNavDashRoute = pathname === "/" || pathname === "/navdash";

  if (pathname.startsWith("/celestial")) {
    return (
      <>
        <NavDashMainLinkGuard />
        <CelestialConsoleSkin />
      </>
    );
  }

  if (pathname === "/msi") {
    return (
      <>
        <NavDashMainLinkGuard />
        <MsiConsoleSkin />
      </>
    );
  }

  if (!isMainNavDashRoute) return <NavDashMainLinkGuard />;

  return (
    <>
      <NavDashMainLinkGuard />
      <NavMapMainOverlayV2 />
      <BridgeMapWakeup />
      <NavMapZoomLimit />
      <NoaaLeafletPaneWeatherOverlay />
      <BridgeMapLayerControls />
      <BridgeOwnShipEnhancer />
      <BridgeRailPolish />
      <BridgeQuickAccess />
      <BridgeNextWaypointDistance />
      <BridgeRouteDistanceWgs84 />
      <BridgeLegSequenceDisplay />
    </>
  );
}
