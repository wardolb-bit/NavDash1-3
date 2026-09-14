import type { ReactNode } from "react";
import WeatherChartLayer from "./WeatherChartLayer";
import WeatherMainButtonFix from "./WeatherMainButtonFix";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        /* Keep the normal map + voyage rail layout. The route profile itself is allowed to
           extend across the full page from the left page margin to the right page margin. */
        @media (min-width: 900px) {
          main > div.mb-2.grid:has(#route-weather-lab-map) {
            overflow: visible !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section {
            overflow: visible !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section > div:has(> svg[viewBox="0 0 1000 160"]) {
            width: calc(100vw - 16px) !important;
            max-width: calc(100vw - 16px) !important;
            min-width: calc(100vw - 16px) !important;
            box-sizing: border-box !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
            overflow: hidden !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section > div:has(> svg[viewBox="0 0 1000 160"]) svg[viewBox="0 0 1000 160"] {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
          }
        }

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
      <WeatherMainButtonFix />
      {children}
    </>
  );
}
