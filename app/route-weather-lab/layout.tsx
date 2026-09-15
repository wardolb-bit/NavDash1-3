import type { ReactNode } from "react";
import SpeedSourceSelector from "./SpeedSourceSelector";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        main svg[viewBox="0 0 1000 160"] {
          display: none !important;
        }
        main div:has(> svg[viewBox="0 0 1000 160"]) {
          display: none !important;
        }

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

        html[data-navdash-theme="day"] main .text-cyan-200,
        html[data-navdash-theme="day"] main .text-cyan-300,
        html[data-navdash-theme="day"] main .text-cyan-400,
        html[data-navdash-theme="day"] main [class*="text-cyan-200"],
        html[data-navdash-theme="day"] main [class*="text-cyan-300"],
        html[data-navdash-theme="day"] main [class*="text-cyan-400"] {
          color: #075f68 !important;
        }
      `}</style>
      {children}
      <SpeedSourceSelector />
    </>
  );
}
