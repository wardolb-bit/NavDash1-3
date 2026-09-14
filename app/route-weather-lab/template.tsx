import type { ReactNode } from "react";
import OpsStatusStrip from "./OpsStatusStrip";
import RouteProfileTableIndexCompat from "./RouteProfileTableIndexCompat";
import RouteProfileDistanceUnitFix from "./RouteProfileDistanceUnitFix";
import AutoRouteWeather from "./AutoRouteWeather";

export default function RouteWeatherLabTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <OpsStatusStrip />
      <RouteProfileTableIndexCompat />
      <RouteProfileDistanceUnitFix />
      <AutoRouteWeather />
      {children}
    </>
  );
}
