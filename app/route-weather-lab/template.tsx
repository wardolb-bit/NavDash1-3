import type { ReactNode } from "react";
import OpsStatusStrip from "./OpsStatusStrip";
import RouteProfileTableIndexCompat from "./RouteProfileTableIndexCompat";
import RouteProfileDistanceUnitFix from "./RouteProfileDistanceUnitFix";

export default function RouteWeatherLabTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <OpsStatusStrip />
      <RouteProfileTableIndexCompat />
      <RouteProfileDistanceUnitFix />
      {children}
    </>
  );
}
