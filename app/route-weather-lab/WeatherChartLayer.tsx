"use client";

import { useEffect, useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

const NOAA_CHART_EXPORT = "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export";
const MAP_ID = "route-weather-lab-map";

type OwnShip = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updatedAt: number;
};

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload.split("").map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}

function decodeOwnShip(line: string): OwnShip | null {
  try {
    if (!/^[$!]AIVDO/.test(line)) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;

    const sogRaw = unsigned(bits, 50, 10);
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cogRaw = unsigned(bits, 116, 12);
    const headingRaw = unsigned(bits, 128, 9);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      lat,
      lon,
      sog: sogRaw >= 1023 ? null : sogRaw / 10,
      cog: cogRaw >= 3600 ? null : cogRaw / 10,
      heading: headingRaw === 511 ? null : headingRaw,
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function vesselIconHtml(orientation: number) {
  return `<div style="width:28px;height:28px;transform:rotate(${orientation}deg);transform-origin:14px 14px;filter:drop-shadow(0 0 5px rgba(34,211,238,.8))"><svg width="28" height="28" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#061018" stroke="#67e8f9" stroke-width="2.4" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#67e8f9" stroke-width="1.7"/><circle cx="15" cy="15" r="2.3" fill="#f8fafc"/></svg></div>`;
}

function webMercator(lon: number, lat: number) {
  const x = lon * 20037508.342789244 / 180;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = Math.log(Math.tan((90 + clampedLat) * Math.PI / 360)) / (Math.PI / 180);
  return [x, y * 20037508.342789244 / 180] as const;
}

export default function WeatherChartLayer() {
  useLayoutEffect(() => {
    let cancelled = false;

    (async () => {
      const leafletModule = await import("leaflet");
      if (cancelled) return;
      const L: any = leafletModule.default || leafletModule;
      if ((L.Map as any).__navdashRouteWeatherHookInstalled) return;

      L.Map.addInitHook(function (this: any) {
        const container = this.getContainer?.();
        if (container?.id === MAP_ID) container.__routeWeatherLeafletMap = this;
      });
      (L.Map as any).__navdashRouteWeatherHookInstalled = true;
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let pollTimer = 0;
    let reconnectTimer = 0;
    let staleTimer = 0;
    let chartRefreshTimer = 0;
    let socket: WebSocket | null = null;
    let map: any = null;
    let chartOverlay: any = null;
    let vesselLayer: any = null;
    let vesselMarker: any = null;
    let lastOwnShip: OwnShip | null = null;
    let baseLayersRemoved = false;

    const removeFallbackTiles = async () => {
      if (!map || baseLayersRemoved) return;
      const leafletModule = await import("leaflet");
      if (disposed) return;
      const L: any = leafletModule.default || leafletModule;
      const remove: any[] = [];
      map.eachLayer((layer: any) => {
        if (layer instanceof L.TileLayer) remove.push(layer);
      });
      remove.forEach((layer) => {
        try { map.removeLayer(layer); } catch {}
      });
      baseLayersRemoved = true;
    };

    const refreshChart = async () => {
      if (disposed || !map) return;
      const leafletModule = await import("leaflet");
      if (disposed) return;
      const L: any = leafletModule.default || leafletModule;
      const bounds = map.getBounds();
      const size = map.getSize();
      const width = Math.max(256, Math.min(2048, Math.round(size.x)));
      const height = Math.max(256, Math.min(2048, Math.round(size.y)));
      const [west, south] = webMercator(bounds.getWest(), bounds.getSouth());
      const [east, north] = webMercator(bounds.getEast(), bounds.getNorth());
      const bbox = [west, south, east, north].join(",");
      const params = new URLSearchParams({
        bbox,
        size: `${width},${height}`,
        dpi: "96",
        transparent: "false",
        layers: "show:0,1,2,3,4,5,6,7",
        f: "image",
      });
      const url = `${NOAA_CHART_EXPORT}?${params.toString()}`;

      const nextOverlay = L.imageOverlay(url, bounds, {
        opacity: 1,
        interactive: false,
        pane: "route-weather-noaa-enc",
        crossOrigin: false,
      });

      nextOverlay.once("load", () => {
        if (disposed || !map) return;
        removeFallbackTiles();
        if (chartOverlay && chartOverlay !== nextOverlay) {
          try { map.removeLayer(chartOverlay); } catch {}
        }
        chartOverlay = nextOverlay;
      });
      nextOverlay.once("error", () => {
        try { map.removeLayer(nextOverlay); } catch {}
      });
      nextOverlay.addTo(map);
    };

    const scheduleChartRefresh = () => {
      window.clearTimeout(chartRefreshTimer);
      chartRefreshTimer = window.setTimeout(refreshChart, 180);
    };

    const install = async () => {
      if (disposed) return;
      const host = document.getElementById(MAP_ID) as any;
      const nextMap = host?.__routeWeatherLeafletMap;
      if (!nextMap) {
        pollTimer = window.setTimeout(install, 100);
        return;
      }
      if (map === nextMap) return;

      const leafletModule = await import("leaflet");
      if (disposed) return;
      const L: any = leafletModule.default || leafletModule;
      map = nextMap;

      if (!map.getPane("route-weather-noaa-enc")) {
        const pane = map.createPane("route-weather-noaa-enc");
        pane.style.zIndex = "250";
        pane.style.pointerEvents = "none";
      }
      if (!map.getPane("route-weather-ownship")) {
        const pane = map.createPane("route-weather-ownship");
        pane.style.zIndex = "690";
      }

      vesselLayer = L.layerGroup([], { pane: "route-weather-ownship" } as any).addTo(map);
      map.on("moveend zoomend resize", scheduleChartRefresh);
      refreshChart();
    };

    const drawOwnShip = async (position: OwnShip | null) => {
      if (!map || !vesselLayer) return;
      const leafletModule = await import("leaflet");
      if (disposed) return;
      const L: any = leafletModule.default || leafletModule;

      if (!position || Date.now() - position.updatedAt > 120000) {
        if (vesselMarker) {
          try { vesselLayer.removeLayer(vesselMarker); } catch {}
          vesselMarker = null;
        }
        return;
      }

      const orientation = position.heading ?? position.cog ?? 0;
      const icon = L.divIcon({
        className: "route-weather-ownship-icon",
        html: vesselIconHtml(orientation),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const latlng: [number, number] = [position.lat, position.lon];
      const tooltip = `<b>CURRENT VESSEL</b><br/>SOG ${position.sog == null ? "--" : `${position.sog.toFixed(1)} kt`}<br/>COG ${position.cog == null ? "--" : `${position.cog.toFixed(0)}°`}`;

      if (!vesselMarker) {
        vesselMarker = L.marker(latlng, { icon, pane: "route-weather-ownship", interactive: true }).addTo(vesselLayer);
        vesselMarker.bindTooltip(tooltip, { direction: "top", opacity: 0.98 });
      } else {
        vesselMarker.setLatLng(latlng);
        vesselMarker.setIcon(icon);
        vesselMarker.setTooltipContent(tooltip);
      }
    };

    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            if (json?.type === "nmea" && typeof json?.line === "string") raw = json.line;
          } catch {}
          const decoded = decodeOwnShip(raw.trim());
          if (!decoded) return;
          lastOwnShip = decoded;
          drawOwnShip(lastOwnShip);
        };
        socket.onclose = () => {
          if (!disposed) reconnectTimer = window.setTimeout(connect, 3500);
        };
        socket.onerror = () => {
          try { socket?.close(); } catch {}
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 3500);
      }
    };

    install();
    connect();
    staleTimer = window.setInterval(() => drawOwnShip(lastOwnShip), 15000);

    return () => {
      disposed = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(chartRefreshTimer);
      window.clearInterval(staleTimer);
      try { socket?.close(); } catch {}
      try { if (map) map.off("moveend zoomend resize", scheduleChartRefresh); } catch {}
      try { if (chartOverlay && map) map.removeLayer(chartOverlay); } catch {}
      try { if (vesselLayer && map) map.removeLayer(vesselLayer); } catch {}
    };
  }, []);

  return null;
}
