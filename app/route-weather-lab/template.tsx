import type { ReactNode } from "react";
import OpsStatusStrip from "./OpsStatusStrip";

export default function RouteWeatherLabTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <OpsStatusStrip />
      {children}
    </>
  );
}
