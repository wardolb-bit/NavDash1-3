import type { ReactNode } from "react";
import CrewRouteWeatherBridge from "../CrewRouteWeatherBridge";

export default function CrewPhoneLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CrewRouteWeatherBridge />
      {children}
    </>
  );
}
