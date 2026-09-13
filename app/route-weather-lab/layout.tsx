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
          font-size: 11px;
          letter-spacing: .01em;
        }
        svg[viewBox="0 0 1000 160"] > g:nth-of-type(-n+6) text:nth-of-type(2) {
          font-size: 9px;
        }

        /* Subtle instrument-panel treatment for the profile. */
        svg[viewBox="0 0 1000 160"] {
          border-radius: 4px;
          background:
            linear-gradient(to bottom, rgba(125,211,252,.025), transparent 42%),
            repeating-linear-gradient(to right, rgba(148,163,184,.035) 0, rgba(148,163,184,.035) 1px, transparent 1px, transparent 100px);
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
        }
      `}</style>
      {children}
    </>
  );
}
