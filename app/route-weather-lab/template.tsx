import type { ReactNode } from "react";
import OpsStatusStrip from "./OpsStatusStrip";
import RouteProfileTableIndexCompat from "./RouteProfileTableIndexCompat";

export default function RouteWeatherLabTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <OpsStatusStrip />
      <RouteProfileTableIndexCompat />
      {children}
    </>
  );
}
