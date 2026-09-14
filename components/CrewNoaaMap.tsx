"use client";

import { useEffect, useRef } from "react";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type OwnShip = { lat?: number; lon?: number; cog?: number | null; heading?: number | null } | null;

export function CrewNoaaMap({ route, ship, nightMode }: { route: RouteState | null; ship: OwnShip; nightMode: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const shipLayerRef = useRef<any>(null);
  const printStyleRef = useRef<HTMLStyleElement | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function printVoyagePlan() {
      const table = document.querySelector("table");
      const section = table?.closest("section") as HTMLElement | null;
      if (!section) return;

      const oldStyle = document.querySelector('style[data-navdash-plan-print="true"]');
      oldStyle?.remove();

      section.classList.add("navdash-plan-print-target");
      const style = document.createElement("style");
      style.setAttribute("data-navdash-plan-print", "true");
      style.textContent = `
        @media print {
          @page { size: landscape; margin: 0.35in; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .navdash-plan-print-target,
          .navdash-plan-print-target * { visibility: visible !important; }
          .navdash-plan-print-target {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            border: 0 !important;
            background: #fff !important;
            color: #111 !important;
          }
          .navdash-plan-print-target > div:first-child {
            border-bottom: 2px solid #111 !important;
            color: #111 !important;
          }
          .navdash-plan-print-target .overflow-x-auto { overflow: visible !important; }
          .navdash-plan-print-target table {
            width: 100% !important;
            min-width: 0 !important;
            table-layout: auto !important;
            color: #111 !important;
            font-size: 9pt !important;
          }
          .navdash-plan-print-target th,
          .navdash-plan-print-target td {
            color: #111 !important;
            border-color: #bbb !important;
            padding: 5px 6px !important;
          }
          .navdash-plan-print-target input {
            border: 0 !important;
            background: transparent !important;
            color: #111 !important;
            padding: 0 !important;
            width: 48px !important;
            font: inherit !important;
          }
        }
      `;
      document.head.appendChild(style);
      printStyleRef.current = style;

      const cleanup = () => {
        section.classList.remove("navdash-plan-print-target");
        printStyleRef.current?.remove();
        printStyleRef.current = null;
        window.removeEventListener("afterprint", cleanup);
      };

      window.addEventListener("afterprint", cleanup);
      window.print();
    }

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
      leafletRef.current = L;

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
        keepBuffer: 6,
        updateWhenIdle: false,
        updateWhenZooming: false,
        attribution: "NOAA Office of Coast Survey ENC Online",
      } as any).addTo(map);

      const PrintControl = L.Control.extend({
        options: { position: "topright" },
        onAdd() {
          const wrap = L.DomUtil.create("div", "leaflet-bar navdash-print-plan-control");
          const button = L.DomUtil.create("button", "", wrap) as HTMLButtonElement;
          button.type = "button";
          button.title = "Print leg speed and holding plan";
          button.setAttribute("aria-label", "Print leg speed and holding plan");
          button.style.cssText = "width:auto;min-width:88px;height:36px;padding:0 10px;border:0;background:#071019;color:#f1d56b;font:800 10px/36px system-ui,sans-serif;letter-spacing:.08em;cursor:pointer;";
          button.textContent = "PRINT PLAN";
          L.DomEvent.disableClickPropagation(wrap);
          L.DomEvent.on(button, "click", printVoyagePlan);
          return wrap;
        },
      });
      new PrintControl().addTo(map);

      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 50);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [route]);

  useEffect(() => {
    let cancelled = false;

    async function redraw() {
      const map = mapRef.current;
      if (!map) {
        window.setTimeout(() => { if (!cancelled) void redraw(); }, 100);
        return;
      }
      const L = leafletRef.current || await import("leaflet");
      if (cancelled) return;
      leafletRef.current = L;

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
          marker.bindTooltip(`${index + 1} · ${wp.name}`, { direction: "top", opacity: 0.95, permanent: false });
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
    return () => {
      printStyleRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-[430px] w-full bg-[#d9e4ea] lg:min-h-[720px]" aria-label="NOAA ENC crew chart" />;
}
