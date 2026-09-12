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
  const printLabelLayerRef = useRef<any>(null);
  const printStyleRef = useRef<HTMLStyleElement | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function printPlanningChart() {
      const map = mapRef.current;
      const container = containerRef.current;
      const L = leafletRef.current;
      if (!map || !container || !L || !route?.waypoints?.length) return;

      if (printLabelLayerRef.current) {
        printLabelLayerRef.current.remove();
        printLabelLayerRef.current = null;
      }

      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      const labelGroup = L.layerGroup();

      route.waypoints.slice(1).forEach((to: Waypoint, index: number) => {
        const from = route.waypoints[index];
        const row = rows[index] as HTMLTableRowElement | undefined;
        const cells = row ? Array.from(row.querySelectorAll("td")) : [];
        const speedInput = row?.querySelector('input[aria-label^="Speed for leg"]') as HTMLInputElement | null;
        const speedCellText = cells[4]?.textContent?.replace(/AUTO SPEED/gi, "").trim() || "";
        const speedText = speedCellText || (speedInput?.value ? `${Number(speedInput.value).toFixed(1)} kt` : "");
        const etaText = cells[6]?.textContent?.trim() || "";

        const midLat = (from.lat + to.lat) / 2;
        let lon1 = from.lon;
        let lon2 = to.lon;
        if (Math.abs(lon2 - lon1) > 180) {
          if (lon1 < lon2) lon1 += 360;
          else lon2 += 360;
        }
        let midLon = (lon1 + lon2) / 2;
        if (midLon > 180) midLon -= 360;
        if (midLon < -180) midLon += 360;

        const icon = L.divIcon({
          className: "navdash-print-leg-label",
          html: `<div style="white-space:nowrap;background:rgba(255,255,255,.96);color:#111827;border:1.5px solid #111827;border-radius:4px;padding:4px 6px;font:800 10px/1.25 system-ui,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.18)"><div>LEG ${index + 1} · ${speedText || "--"}</div><div>ETA ${etaText || "--"}</div></div>`,
          iconSize: [150, 38],
          iconAnchor: [75, 19],
        });
        L.marker([midLat, midLon], { icon, interactive: false }).addTo(labelGroup);
      });

      labelGroup.addTo(map);
      printLabelLayerRef.current = labelGroup;
      container.classList.add("navdash-chart-print-target");

      const oldStyle = document.querySelector('style[data-navdash-chart-print="true"]');
      oldStyle?.remove();

      const style = document.createElement("style");
      style.setAttribute("data-navdash-chart-print", "true");
      style.textContent = `
        @media print {
          @page { size: landscape; margin: 0.35in; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .navdash-chart-print-target,
          .navdash-chart-print-target * { visibility: visible !important; }
          .navdash-chart-print-target {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 0 !important;
            background: #d9e4ea !important;
          }
          .navdash-chart-print-target .leaflet-control-container { display: none !important; }
          .navdash-print-leg-label { visibility: visible !important; }
        }
      `;
      document.head.appendChild(style);
      printStyleRef.current = style;

      const cleanup = () => {
        container.classList.remove("navdash-chart-print-target");
        printLabelLayerRef.current?.remove();
        printLabelLayerRef.current = null;
        printStyleRef.current?.remove();
        printStyleRef.current = null;
        window.removeEventListener("afterprint", cleanup);
        window.setTimeout(() => map.invalidateSize(), 50);
      };

      window.addEventListener("afterprint", cleanup);
      map.invalidateSize();

      // Keep this call synchronous with the user's tap. iPad/Safari can block
      // the native print sheet if an await/timer occurs before window.print().
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
          const wrap = L.DomUtil.create("div", "leaflet-bar navdash-print-chart-control");
          const button = L.DomUtil.create("button", "", wrap) as HTMLButtonElement;
          button.type = "button";
          button.title = "Print planning chart on paper";
          button.setAttribute("aria-label", "Print planning chart on paper");
          button.style.cssText = "width:auto;min-width:92px;height:36px;padding:0 10px;border:0;background:#071019;color:#f1d56b;font:800 10px/36px system-ui,sans-serif;letter-spacing:.08em;cursor:pointer;";
          button.textContent = "PRINT CHART";
          L.DomEvent.disableClickPropagation(wrap);
          L.DomEvent.on(button, "click", printPlanningChart);
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
      printLabelLayerRef.current?.remove();
      printStyleRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-[430px] w-full bg-[#d9e4ea] lg:min-h-[720px]" aria-label="NOAA ENC crew chart" />;
}
