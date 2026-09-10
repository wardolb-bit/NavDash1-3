"use client";

import { useEffect, useRef } from "react";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type OwnShip = { lat?: number; lon?: number; cog?: number | null } | null;

export function CrewNoaaMap({ route, ship, nightMode }: { route: RouteState | null; ship: OwnShip; nightMode: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const shipLayerRef = useRef<any>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!containerRef.current || mapRef.current) return;

      if (!document.querySelector('link[data-crew-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-crew-leaflet", "true");
        document.head.appendChild(link);
      }

      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const fallback: [number, number] = [21.35, -157.95];
      const first = route?.waypoints?.[0];
      const center: [number, number] = ship?.lat !== undefined && ship?.lon !== undefined
        ? [ship.lat, ship.lon]
        : first
          ? [first.lat, first.lon]
          : fallback;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        minZoom: 3,
        maxZoom: 15,
      }).setView(center, 10);

      L.tileLayer.wms("/api/noaa-charts/wms", {
        layers: "1,2,3,4,5,6,7,12",
        format: "image/png",
        transparent: false,
        version: "1.3.0",
        maxZoom: 15,
        attribution: "NOAA Office of Coast Survey ENC Online",
      }).addTo(map);

      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 50);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function redraw() {
      const map = mapRef.current;
      if (!map) {
        window.setTimeout(() => { if (!cancelled) void redraw(); }, 100);
        return;
      }
      const L = await import("leaflet");
      if (cancelled) return;

      if (routeLayerRef.current) {
        routeLayerRef.current.remove();
        routeLayerRef.current = null;
      }
      if (shipLayerRef.current) {
        shipLayerRef.current.remove();
        shipLayerRef.current = null;
      }

      const routePoints = route?.waypoints?.map((wp) => [wp.lat, wp.lon] as [number, number]) || [];
      const routeGroup = L.layerGroup();

      if (routePoints.length > 1) {
        L.polyline(routePoints, { color: "#c9a227", weight: 3, opacity: 0.95 }).addTo(routeGroup);
        route.waypoints.forEach((wp, index) => {
          const isActive = index === route.activeWaypointIndex;
          const marker = L.circleMarker([wp.lat, wp.lon], {
            radius: isActive ? 6 : 4,
            weight: 2,
            color: isActive ? "#38bdf8" : "#c9a227",
            fillColor: nightMode ? "#08111a" : "#ffffff",
            fillOpacity: 1,
          });
          marker.bindTooltip(`${wp.id} · ${wp.name}`, { direction: "top", opacity: 0.95 });
          marker.addTo(routeGroup);
        });
      }
      routeGroup.addTo(map);
      routeLayerRef.current = routeGroup;

      if (ship?.lat !== undefined && ship?.lon !== undefined) {
        const shipGroup = L.layerGroup();
        L.circleMarker([ship.lat, ship.lon], {
          radius: 8,
          weight: 3,
          color: "#38bdf8",
          fillColor: "#38bdf8",
          fillOpacity: 0.55,
        }).bindTooltip("M/V MB480", { permanent: false, direction: "top" }).addTo(shipGroup);

        if (ship.cog !== undefined && ship.cog !== null && Number.isFinite(ship.cog)) {
          const lengthNm = 3;
          const brng = ship.cog * Math.PI / 180;
          const latRad = ship.lat * Math.PI / 180;
          const dLat = (lengthNm / 60) * Math.cos(brng);
          const dLon = (lengthNm / (60 * Math.max(0.2, Math.cos(latRad)))) * Math.sin(brng);
          L.polyline([[ship.lat, ship.lon], [ship.lat + dLat, ship.lon + dLon]], {
            color: "#38bdf8",
            weight: 2,
            dashArray: "6 6",
          }).addTo(shipGroup);
        }

        shipGroup.addTo(map);
        shipLayerRef.current = shipGroup;
      }

      if (!fittedRef.current) {
        const fitPoints = [...routePoints];
        if (ship?.lat !== undefined && ship?.lon !== undefined) fitPoints.push([ship.lat, ship.lon]);
        if (fitPoints.length > 1) {
          map.fitBounds(L.latLngBounds(fitPoints), { padding: [28, 28], maxZoom: 12 });
          fittedRef.current = true;
        } else if (fitPoints.length === 1) {
          map.setView(fitPoints[0], 11);
          fittedRef.current = true;
        }
      }

      map.invalidateSize();
    }

    void redraw();
    return () => { cancelled = true; };
  }, [route, ship?.lat, ship?.lon, ship?.cog, nightMode]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-[430px] w-full bg-[#d9e4ea] lg:min-h-[720px]" aria-label="NOAA ENC crew chart" />;
}
