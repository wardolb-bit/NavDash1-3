import type { ReactNode } from "react";
import WeatherChartLayer from "./WeatherChartLayer";
import WeatherMainButtonFix from "./WeatherMainButtonFix";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #route-weather-lab-map + * {}

        /* Desktop: keep map/content left, voyage rail right, and let the native route profile span the full workspace below them. */
        @media (min-width: 1280px) {
          main > div.mb-2.grid:has(#route-weather-lab-map) {
            position: relative !important;
            display: block !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section {
            width: 100% !important;
            min-width: 0 !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section > :not(:has(> svg[viewBox="0 0 1000 160"])) {
            width: calc(100% - 388px) !important;
            max-width: calc(100% - 388px) !important;
            box-sizing: border-box !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section > div:has(> svg[viewBox="0 0 1000 160"]) {
            width: 100% !important;
            max-width: none !important;
            box-sizing: border-box !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
            overflow: hidden !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > section > div:has(> svg[viewBox="0 0 1000 160"]) svg {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
          }

          main > div.mb-2.grid:has(#route-weather-lab-map) > aside {
            position: absolute !important;
            top: 0 !important;
            right: 0 !important;
            width: 380px !important;
            max-width: 380px !important;
            z-index: 2 !important;
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
