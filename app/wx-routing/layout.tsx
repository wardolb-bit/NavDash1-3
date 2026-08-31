import type { ReactNode } from "react";
import WeatherRouteRecommendation from "./WeatherRouteRecommendation";

export default function WxRoutingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <WeatherRouteRecommendation />
    </>
  );
}
