"use client";

import { useEffect, useRef } from "react";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type OwnShip = { lat?: number; lon?: number; cog?: number | null; heading?: number | null } | null;

function s52NightDisplayParams() {
  return JSON.stringify({
    ECDISParameters: {
      version: "10.9",
      DynamicParameters: {
        Parameter: [
          { name: "ColorScheme", value: 5 },
          { name: "DisplayFrames", value: 2 },
          { name: "DisplayFrameText", value: 0 },
        ],
      },
    },
  });
}

export function CrewNoaaMap({ route, ship, nightMode }: { route: RouteState | null; ship: OwnShip; nightMode: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const chartLayerRef = useRef<any>(null);
  const seamarkLayerRef = useRef<any>(null);
  const jcgLayerRef = useRef<any>(null);
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

      const planningBadge = new L.Control({ position: "bottomleft" });
      planningBadge.onAdd = () => {
        const el = L.DomUtil.create("div");
        el.innerHTML = "PLANNING MAP · NOT FOR NAVIGATION";
        el.style.cssText = "background:rgba(3,7,10,.86);color:#f1d56b;border:1px solid rgba(241,213,107,.45);padding:5px 8px;border-radius:4px;font:700 10px/1.2 system-ui;letter-spacing:.08em;";
        return el;
      };
      planningBadge.addTo(map);

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
    let timer = 0;

    async function updateChart() {
      const map = mapRef.current;
      if (!map) {
        timer = window.setTimeout(() => { if (!cancelled) void updateChart(); }, 100);
        return;
      }

      const L = await import("leaflet");
      if (cancelled) return;

      if (chartLayerRef.current) {
        try { map.removeLayer(chartLayerRef.current); } catch {}
        chartLayerRef.current = null;
      }

      const center = map.getCenter();
      const inNoaaCoverage = (
        (center.lat >= 15 && center.lat <= 75 && center.lng >= -180 && center.lng <= -50) ||
        (center.lat >= -20 && center.lat <= 30 && (center.lng >= 130 || center.lng <= -130))
      );

      if (seamarkLayerRef.current) {
        try { map.removeLayer(seamarkLayerRef.current); } catch {}
        seamarkLayerRef.current = null;
      }

      const chartLayer = inNoaaCoverage && nightMode
        ? L.tileLayer.wms("/api/noaa-charts/wms", {
            layers: "1,2,3,4,5,6,7",
            format: "image/png",
            transparent: false,
            version: "1.1.1",
            display_params: s52NightDisplayParams(),
            maxZoom: 15,
            keepBuffer: 6,
            updateWhenIdle: false,
            updateWhenZooming: false,
            attribution: "NOAA Office of Coast Survey ENC Online",
          } as any)
        : inNoaaCoverage
          ? L.tileLayer.wms("/api/noaa-charts/wms", {
            layers: "1,2,3,4,5,6,7,12",
            format: "image/png",
            transparent: false,
            version: "1.3.0",
            maxZoom: 15,
            keepBuffer: 6,
            updateWhenIdle: false,
            updateWhenZooming: false,
            attribution: "NOAA Office of Coast Survey ENC Online",
          } as any)
          : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
              maxZoom: 19,
              attribution: "OpenStreetMap contributors",
            });

      chartLayer.addTo(map);
      chartLayerRef.current = chartLayer;

      if (!inNoaaCoverage) {
        const seamarks = L.tileLayer("/api/planning-map/seamark/{z}/{x}/{y}", {
          minZoom: 4,
          maxZoom: 18,
          opacity: 1,
          pane: "overlayPane",
          attribution: "OpenSeaMap contributors",
        });
        seamarks.addTo(map);
        seamarks.bringToFront();
        seamarkLayerRef.current = seamarks;
      }

      const loadJapanOverlays = async () => {
        if (jcgLayerRef.current) {
          try { map.removeLayer(jcgLayerRef.current); } catch {}
          jcgLayerRef.current = null;
        }

        const bounds = map.getBounds();
        const japanView = bounds.getNorth() >= 20 && bounds.getSouth() <= 48 &&
          bounds.getEast() >= 122 && bounds.getWest() <= 154;
        if (!japanView || map.getZoom() < 7) return;

        const west = Math.max(122, bounds.getWest());
        const south = Math.max(20, bounds.getSouth());
        const east = Math.min(154, bounds.getEast());
        const north = Math.min(48, bounds.getNorth());
        const bbox = [west, south, east, north].join(",");
        const group = L.layerGroup().addTo(map);
        jcgLayerRef.current = group;

        const specs = [
          { key: "lighthouses", radius: 6, color: "#f8fafc" },
          { key: "buoys", radius: 5, color: "#22d3ee" },
          { key: "beacons", radius: 5, color: "#a3e635" },
          { key: "wrecks", radius: 5, color: "#ef4444" },
          { key: "obstructions", radius: 4, color: "#f97316" },
          { key: "anchorages", radius: 4, color: "#38bdf8" },
          { key: "warnings", radius: 5, color: "#facc15" },
        ];

        await Promise.all(specs.map(async (spec) => {
          try {
            const response = await fetch(`/api/jcg-msil?layer=${spec.key}&bbox=${encodeURIComponent(bbox)}`);
            if (!response.ok || jcgLayerRef.current !== group) return;
            const geojson = await response.json();
            L.geoJSON(geojson, {
              style: { color: spec.color, weight: 2, opacity: 0.9, fillOpacity: 0.12 },
              pointToLayer: (_feature: any, latlng: any) => L.circleMarker(latlng, {
                radius: spec.radius,
                color: spec.color,
                weight: 2,
                fillColor: nightMode ? "#071019" : "#ffffff",
                fillOpacity: 0.9,
              }),
              onEachFeature: (feature: any, layer: any) => {
                const props = feature?.properties || {};
                const title = props.名称 || props.name || props.NAME || props.title || spec.key;
                layer.bindTooltip(`JCG · ${title}`, { sticky: true, opacity: 0.95 });
              },
            }).addTo(group);
          } catch {}
        }));
      };

      await loadJapanOverlays();
    }

    let moveTimer = 0;
    const bindMapEvents = () => {
      const map = mapRef.current;
      if (!map) {
        moveTimer = window.setTimeout(bindMapEvents, 100);
        return;
      }
      const refresh = () => void updateChart();
      map.on("moveend zoomend", refresh);
      return () => map.off("moveend zoomend", refresh);
    };
    const unbind = bindMapEvents();

    void updateChart();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(moveTimer);
      if (typeof unbind === "function") unbind();
    };
  }, [nightMode]);

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

      if (route && routePoints.length > 1) {
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
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      chartLayerRef.current = null;
      seamarkLayerRef.current = null;
      jcgLayerRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`h-full min-h-[430px] w-full ${nightMode ? "bg-[#03070a]" : "bg-[#d9e4ea]"} lg:min-h-[720px]`}
      aria-label="NOAA ENC crew chart"
    />
  );
}
