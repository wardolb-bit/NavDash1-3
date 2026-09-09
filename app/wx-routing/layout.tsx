import type { ReactNode } from "react";
import WeatherMapUxOverlay from "./WeatherMapUxOverlay";
import WeatherRouteRecommendation from "./WeatherRouteRecommendation";
import WeatherRoutingDataBridge from "./WeatherRoutingDataBridge";
import WeatherSourceSelector from "./WeatherSourceSelector";
import WxRoutingHeaderThemeFix from "./WxRoutingHeaderThemeFix";

export default function WxRoutingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WeatherRoutingDataBridge />
      <WeatherSourceSelector />
      <WeatherMapUxOverlay />
      <WxRoutingHeaderThemeFix />
      {children}
      <WeatherRouteRecommendation />
    </>
  );
}
