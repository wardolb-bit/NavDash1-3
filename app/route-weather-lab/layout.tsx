import type { ReactNode } from "react";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #route-weather-lab-map + * {}
        .leaflet-marker-icon > div:first-child {
          display: none !important;
        }

        /* Route profile only. Keep waypoint labels readable instead of piling on top of one another. */
        svg[viewBox="0 0 1000 160"] > g:nth-of-type(-n+6) text:first-of-type {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .025em;
          paint-order: stroke;
          stroke: rgba(5,10,15,.92);
          stroke-width: 3px;
          stroke-linejoin: round;
        }
        svg[viewBox="0 0 1000 160"] > g:nth-of-type(-n+6) text:nth-of-type(2) {
          font-size: 8px;
          font-weight: 700;
          letter-spacing: .04em;
        }

        /* Instrument-panel shell around the route profile. */
        div:has(> svg[viewBox="0 0 1000 160"]) {
          position: relative;
          overflow: hidden;
          border-color: rgba(71,85,105,.7) !important;
          background:
            radial-gradient(circle at 15% 0%, rgba(34,211,238,.055), transparent 31%),
            radial-gradient(circle at 88% 0%, rgba(241,213,107,.05), transparent 28%),
            linear-gradient(180deg, #071019 0%, #050a0f 100%) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025),
            inset 0 -20px 35px rgba(0,0,0,.18);
        }
        div:has(> svg[viewBox="0 0 1000 160"])::after {
          content: "";
          position: absolute;
          inset: 43px 12px 12px;
          pointer-events: none;
          border: 1px solid rgba(100,116,139,.14);
          background:
            repeating-linear-gradient(to right, rgba(148,163,184,.045) 0, rgba(148,163,184,.045) 1px, transparent 1px, transparent 10%),
            repeating-linear-gradient(to bottom, rgba(148,163,184,.032) 0, rgba(148,163,184,.032) 1px, transparent 1px, transparent 25%);
          mask-image: linear-gradient(to bottom, transparent, black 12%, black 88%, transparent);
        }

        svg[viewBox="0 0 1000 160"] {
          position: relative;
          z-index: 1;
          border-radius: 4px;
          background:
            linear-gradient(to bottom, rgba(125,211,252,.018), transparent 44%),
            linear-gradient(to top, rgba(241,213,107,.018), transparent 46%);
        }

        /* Sea and wind traces read like illuminated bridge instrumentation. */
        svg[viewBox="0 0 1000 160"] > polyline:nth-of-type(1) {
          filter: drop-shadow(0 0 4px rgba(241,213,107,.38));
        }
        svg[viewBox="0 0 1000 160"] > polyline:nth-of-type(2) {
          filter: drop-shadow(0 0 4px rgba(103,232,249,.34));
        }
        svg[viewBox="0 0 1000 160"] circle {
          filter: drop-shadow(0 0 3px rgba(255,255,255,.18));
          transition: r .12s ease, filter .12s ease;
        }
        svg[viewBox="0 0 1000 160"] g:hover circle {
          filter: drop-shadow(0 0 7px rgba(255,255,255,.55));
        }

        /* Expected-vessel cursor gets a proper luminous track marker. */
        svg[viewBox="0 0 1000 160"] path[fill="#22d3ee"] {
          filter: drop-shadow(0 0 5px rgba(34,211,238,.85));
        }
        svg[viewBox="0 0 1000 160"] line[stroke="#22d3ee"] {
          filter: drop-shadow(0 0 3px rgba(34,211,238,.55));
        }

        @media (max-width: 1350px) {
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(2),
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(4) {
            display: none;
          }
        }

        @media (max-width: 900px) {
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(2),
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(3),
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(4),
          svg[viewBox="0 0 1000 160"] > g:nth-of-type(5) {
            display: none;
          }
          div:has(> svg[viewBox="0 0 1000 160"])::after {
            inset-left: 8px;
            inset-right: 8px;
          }
        }
      `}</style>
      {children}
    </>
  );
}
