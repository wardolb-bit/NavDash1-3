import type { ReactNode } from "react";
import WeatherRouteRecommendation from "./WeatherRouteRecommendation";
import WeatherRoutingDataBridge from "./WeatherRoutingDataBridge";

export default function WxRoutingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WeatherRoutingDataBridge />
      {children}
      <WeatherRouteRecommendation />
    </>
  );
}
