import type { ReactNode } from "react";
import WeatherChartLayer from "./WeatherChartLayer";
import WeatherMainButtonFix from "./WeatherMainButtonFix";
import WeatherPlanStateSync from "./WeatherPlanStateSync";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        /* Hide the voyage profile. Route-leg hover on the map remains the weather detail view. */
        main svg[viewBox="0 0 1000 160"] {
          display: none !important;
        }
        main div:has(> svg[viewBox="0 0 1000 160"]) {
          display: none !important;
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

        /* Route Weather day mode: remove hard-coded night panels without changing Bridge Night. */
        html[data-navdash-theme="day"] main [class*="bg-[#050a0f]"],
        html[data-navdash-theme="day"] main [class*="bg-[#08131b]"],
        html[data-navdash-theme="day"] main [class*="bg-[#08130f]"],
        html[data-navdash-theme="day"] main [class*="bg-[#101820]"],
        html[data-navdash-theme="day"] main [class*="bg-[#17130a]"] {
          background: var(--nd-panel) !important;
          background-color: var(--nd-panel) !important;
          color: var(--nd-text) !important;
        }

        html[data-navdash-theme="day"] main [class*="bg-[#17130a]"] {
          background: var(--nd-panel-alt) !important;
          background-color: var(--nd-panel-alt) !important;
        }

        /* Darker cyan/teal values for Day mode readability on this page only. */
        html[data-navdash-theme="day"] main [class*="text-cyan-200"],
        html[data-navdash-theme="day"] main [class*="text-cyan-300"] {
          color: #0b6872 !important;
        }

        html[data-navdash-theme="day"] main aside > section:nth-child(3) [class*="text-cyan"],
        html[data-navdash-theme="day"] main table [class*="text-cyan"] {
          color: #0b6872 !important;
        }

        /* OpsStatusStrip is injected after first paint and rebuilt every second with inline night colors.
           Override those inline colors at the host so the cards stay light after injection/re-render. */
        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="background:#050a0f"],
        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="background: #050a0f"] {
          background: var(--nd-panel) !important;
          background-color: var(--nd-panel) !important;
          color: var(--nd-text) !important;
          border-color: var(--nd-border) !important;
        }

        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="background:#17130a"],
        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="background: #17130a"] {
          background: var(--nd-panel-alt) !important;
          background-color: var(--nd-panel-alt) !important;
          border-color: rgba(122,91,0,.38) !important;
        }

        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="color:#67e8f9"],
        html[data-navdash-theme="day"] [data-route-weather-ops-strip="1"] [style*="color: #67e8f9"] {
          color: #0b6872 !important;
        }
      `}</style>
      <WeatherChartLayer />
      <WeatherPlanStateSync />
      <WeatherMainButtonFix />
      {children}
    </>
  );
}
