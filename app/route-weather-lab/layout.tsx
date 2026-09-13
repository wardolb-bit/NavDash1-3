import type { ReactNode } from "react";

export default function RouteWeatherLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #route-weather-lab-map + * {}
        .leaflet-marker-icon > div:first-child {
          display: none !important;
        }
      `}</style>
      {children}
    </>
  );
}
