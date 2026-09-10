"use client";

import { useEffect, useRef } from "react";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type OwnShip = { lat?: number; lon?: number; cog?: number | null; heading?: number | null } | null;

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
          marker.bindTooltip(`${index + 1} · ${wp.name}`, { direction: "top", opacity: 0.95 });
          marker.addTo(routeGroup);
        });
      }
      routeGroup.addTo(map);
      routeLayerRef.current = routeGroup;

      if (ship?.lat !== undefined && ship?.lon !== undefined) {
        const shipGroup = L.layerGroup();
        const orientation = ship.heading !== undefined && ship.heading !== null && Number.isFinite(ship.heading)
          ? ship.heading
          : (ship.cog !== undefined && ship.cog !== null && Number.isFinite(ship.cog) ? ship.cog : 0);

        const icon = L.divIcon({
          className: "navmap-main-ownship-icon",
          html: `<div style="width:30px;height:30px;transform:rotate(${orientation}deg);transform-origin:15px 15px;filter:drop-shadow(0 0 5px rgba(34,211,238,.35))"><svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#071019" stroke="#22d3ee" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#f1d56b" stroke-width="1.5"/><circle cx="15" cy="15" r="2.4" fill="#22d3ee"/></svg></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        L.marker([ship.lat, ship.lon], { icon, interactive: false })
          .bindTooltip("M/V MB480", { permanent: false, direction: "top" })
          .addTo(shipGroup);

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
  }, [route, ship?.lat, ship?.lon, ship?.cog, ship?.heading, nightMode]);

  useEffect(() => {
    if (!route?.waypoints?.length) return;
    let timer = 0;

    const syncSequenceLabels = () => {
      const crew = document.querySelector(".crew-view");
      if (!crew) return;

      const metrics = Array.from(crew.querySelectorAll<HTMLElement>("div.border.p-3"));
      for (const metric of metrics) {
        const label = metric.firstElementChild?.textContent?.trim();
        const value = metric.children[1] as HTMLElement | undefined;
        if (!value) continue;

        if (label === "Active Leg") {
          const match = value.textContent?.match(/^\s*(.+?)\s*→\s*(.+?)\s*$/);
          if (!match) continue;
          const fromId = match[1].trim();
          const toId = match[2].trim();
          for (let i = 0; i < route.waypoints.length - 1; i += 1) {
            if (route.waypoints[i].id === fromId && route.waypoints[i + 1].id === toId) {
              const nextText = `${i + 1} → ${i + 2}`;
              if (value.textContent !== nextText) value.textContent = nextText;
              break;
            }
          }
        }

        if (label === "Next Waypoint") {
          const current = value.textContent?.trim() || "";
          const separator = current.indexOf("·");
          const rawId = (separator >= 0 ? current.slice(0, separator) : current).trim();
          const index = route.waypoints.findIndex((wp) => wp.id === rawId);
          if (index >= 0) {
            const nextText = `${index + 1} · ${route.waypoints[index].name}`;
            if (value.textContent !== nextText) value.textContent = nextText;
          }
        }
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(syncSequenceLabels, 20);
    };

    syncSequenceLabels();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [route]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-[430px] w-full bg-[#d9e4ea] lg:min-h-[720px]" aria-label="NOAA ENC crew chart" />;
}
