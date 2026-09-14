import type { ReactNode } from "react";
import FullWidthRouteProfile from "./FullWidthRouteProfile";
import WeatherChartLayer from "./WeatherChartLayer";
import WeatherMainButtonFix from "./WeatherMainButtonFix";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #route-weather-lab-map + * {}

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

        /* Native route profile only. Keep it clean and readable. */
        [data-navdash-full-width-profile="true"] {
          box-sizing: border-box !important;
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          overflow: hidden !important;
        }

        [data-navdash-full-width-profile="true"] svg[viewBox="0 0 1000 160"] {
          display: block;
          width: 100% !important;
          max-width: none !important;
        }

        @media (max-width: 900px) {
          [data-navdash-full-width-profile="true"] {
            width: calc(100vw - 16px) !important;
            max-width: calc(100vw - 16px) !important;
          }
        }
      `}</style>
      <WeatherChartLayer />
      <FullWidthRouteProfile />
      <WeatherMainButtonFix />
      {children}
    </>
  );
}
