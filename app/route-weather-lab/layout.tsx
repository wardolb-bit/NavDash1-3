import type { ReactNode } from "react";
import FullWidthRouteProfile from "./FullWidthRouteProfile";
import WeatherChartLayer from "./WeatherChartLayer";
import WeatherMainButtonFix from "./WeatherMainButtonFix";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        /* Keep the voyage controls inside their panel on iPad/narrow sidebars. */
        aside > section:first-child .grid.grid-cols-2 {
          grid-template-columns: minmax(0, 1fr) !important;
          align-items: stretch;
        }
        aside > section:first-child .grid.grid-cols-2 > label {
          min-width: 0;
          width: 100%;
          overflow: hidden;
        }
        aside > section:first-child input[type="datetime-local"],
        aside > section:first-child input[type="number"] {
          display: block;
          box-sizing: border-box;
          min-width: 0;
          width: 100% !important;
          max-width: 100%;
          overflow: hidden;
        }
        aside > section:first-child input[type="datetime-local"] {
          font-size: 12px !important;
          letter-spacing: -.015em;
        }
      `}</style>
      <WeatherChartLayer />
      <FullWidthRouteProfile />
      <WeatherMainButtonFix />
      {children}
    </>
  );
}
