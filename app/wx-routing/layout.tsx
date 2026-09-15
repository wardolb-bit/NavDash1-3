import type { ReactNode } from "react";
import WeatherEncBaseLayer from "./WeatherEncBaseLayer";
import WeatherMapUxOverlay from "./WeatherMapUxOverlay";
import WeatherRouteRecommendation from "./WeatherRouteRecommendation";
import WeatherRoutingDataBridge from "./WeatherRoutingDataBridge";
import WeatherSourceSelector from "./WeatherSourceSelector";
import { WxRoutingBridgeSkin } from "../../components/WxRoutingBridgeSkin";

export default function WxRoutingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WeatherRoutingDataBridge />
      <WeatherSourceSelector />
      <WeatherEncBaseLayer />
      <WeatherMapUxOverlay />
      <WxRoutingBridgeSkin />
      {children}
      <WeatherRouteRecommendation />
    </>
  );
}
