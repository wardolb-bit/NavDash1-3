import type { ReactNode } from "react";
import WeatherRouteRecommendation from "./WeatherRouteRecommendation";
import WeatherRoutingDataBridge from "./WeatherRoutingDataBridge";
import WeatherSourceSelector from "./WeatherSourceSelector";

export default function WxRoutingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WeatherRoutingDataBridge />
      <WeatherSourceSelector />
      {children}
      <WeatherRouteRecommendation />
    </>
  );
}
