import type { ReactNode } from "react";
import RouteProfileEnhancer from "./RouteProfileEnhancer";

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

        /* Route profile only. Keep waypoint labels readable instead of piling on top of one another. */
        svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(-n+6) text:first-of-type {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .025em;
          paint-order: stroke;
          stroke: rgba(5,10,15,.96);
          stroke-width: 3px;
          stroke-linejoin: round;
        }
        svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(-n+6) text:nth-of-type(2) {
          font-size: 8px;
          font-weight: 700;
          letter-spacing: .04em;
        }

        /* Stronger bridge-instrument treatment so the two data bands read immediately. */
        div:has(> svg[viewBox="0 0 1000 160"]) {
          position: relative;
          overflow: hidden;
          border-color: rgba(71,85,105,.82) !important;
          background:
            radial-gradient(circle at 12% 0%, rgba(34,211,238,.09), transparent 28%),
            radial-gradient(circle at 88% 0%, rgba(241,213,107,.08), transparent 30%),
            linear-gradient(180deg, #07111a 0%, #04090e 100%) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            inset 0 -26px 44px rgba(0,0,0,.24),
            0 0 0 1px rgba(15,23,42,.35);
        }
        div:has(> svg[viewBox="0 0 1000 160"])::before {
          content: "SEA STATE     •     WIND PROFILE";
          position: absolute;
          right: 14px;
          top: 44px;
          z-index: 2;
          pointer-events: none;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .16em;
          color: rgba(148,163,184,.62);
        }
        div:has(> svg[viewBox="0 0 1000 160"])::after {
          content: "";
          position: absolute;
          inset: 43px 12px 12px;
          z-index: 0;
          pointer-events: none;
          border: 1px solid rgba(100,116,139,.2);
          background:
            linear-gradient(to bottom,
              rgba(241,213,107,.075) 0%,
              rgba(241,213,107,.025) 36%,
              rgba(15,23,42,0) 36.4%,
              rgba(15,23,42,0) 38%,
              rgba(34,211,238,.025) 38%,
              rgba(34,211,238,.07) 70%,
              rgba(15,23,42,0) 70.5%,
              rgba(2,6,12,.52) 72%,
              rgba(2,6,12,.72) 100%),
            repeating-linear-gradient(to right,
              rgba(148,163,184,.06) 0,
              rgba(148,163,184,.06) 1px,
              transparent 1px,
              transparent 10%);
        }

        svg[viewBox="0 0 1000 160"] {
          position: relative;
          z-index: 1;
          border-radius: 4px;
          background:
            linear-gradient(to bottom, transparent 0 38%, rgba(100,116,139,.22) 38.2%, transparent 38.8%),
            linear-gradient(to bottom, transparent 0 70%, rgba(100,116,139,.18) 70.2%, transparent 70.8%);
        }

        svg[viewBox="0 0 1000 160"] > polyline:nth-of-type(1) {
          stroke-width: 5px !important;
          filter: drop-shadow(0 0 2px rgba(241,213,107,.95)) drop-shadow(0 0 8px rgba(241,213,107,.32));
        }
        svg[viewBox="0 0 1000 160"] > polyline:nth-of-type(2) {
          stroke-width: 4px !important;
          filter: drop-shadow(0 0 2px rgba(103,232,249,.9)) drop-shadow(0 0 8px rgba(103,232,249,.28));
        }
        svg[viewBox="0 0 1000 160"] circle {
          filter: drop-shadow(0 0 4px rgba(255,255,255,.22));
          transition: r .12s ease, filter .12s ease;
        }
        svg[viewBox="0 0 1000 160"] g:hover circle {
          filter: drop-shadow(0 0 8px rgba(255,255,255,.65));
        }

        svg[viewBox="0 0 1000 160"] path[fill="#22d3ee"] {
          filter: drop-shadow(0 0 3px rgba(34,211,238,1)) drop-shadow(0 0 9px rgba(34,211,238,.72));
        }
        svg[viewBox="0 0 1000 160"] line[stroke="#22d3ee"] {
          stroke-width: 3px !important;
          filter: drop-shadow(0 0 4px rgba(34,211,238,.7));
        }

        /* Map wind markers use a north-pointing base glyph so meteorological
           bearings rotate correctly. The inline code supplies compass bearing. */
        .leaflet-marker-icon > div[style*="color:#7dd3fc"][style*="transform:rotate"] {
          font-size: 0 !important;
        }
        .leaflet-marker-icon > div[style*="color:#7dd3fc"][style*="transform:rotate"]::before {
          content: "▲";
          display: block;
          font-size: 18px;
          line-height: 24px;
          color: #7dd3fc;
        }

        @media (max-width: 1350px) {
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(2),
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(4) {
            display: none;
          }
        }

        @media (max-width: 900px) {
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(2),
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(3),
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(4),
          svg[viewBox="0 0 1000 160"] > g:not(.route-profile-enhancements):nth-of-type(5) {
            display: none;
          }
          div:has(> svg[viewBox="0 0 1000 160"])::before {
            right: 10px;
            letter-spacing: .1em;
          }
        }
      `}</style>
      <RouteProfileEnhancer />
      {children}
    </>
  );
}
