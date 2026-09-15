"use client";

import { useEffect, useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

const NOAA_ENC_WMS = "/api/noaa-charts/wms";
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

export default function WeatherChartLayer() {
  const { nightMode } = useBridgeTheme();

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
    const host = document.getElementById(MAP_ID);
    const pane = host?.querySelector<HTMLElement>(".leaflet-route-weather-enc-pane");
    if (!host || !pane) return;
    host.style.background = nightMode ? "#02070b" : "#dbe7ed";
    pane.style.filter = nightMode
      ? "brightness(.40) contrast(1.35) saturate(.72)"
      : "none";
  }, [nightMode]);

  useEffect(() => {
    let disposed = false;
    let pollTimer = 0;
    let reconnectTimer = 0;
    let staleTimer = 0;
    let socket: WebSocket | null = null;
    let map: any = null;
    let chartLayer: any = null;
    let vesselLayer: any = null;
    let vesselMarker: any = null;
    let lastOwnShip: OwnShip | null = null;

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

      try {
        if (!map.getPane("route-weather-enc")) {
          const encPane = map.createPane("route-weather-enc");
          encPane.style.zIndex = "250";
          encPane.style.filter = nightMode
            ? "brightness(.40) contrast(1.35) saturate(.72)"
            : "none";
        }
        host.style.background = nightMode ? "#02070b" : "#dbe7ed";

        chartLayer = L.tileLayer.wms(NOAA_ENC_WMS, {
          pane: "route-weather-enc",
          layers: "1,2,3,4,5,6,7",
          format: "image/png",
          transparent: false,
          version: "1.1.1",
          opacity: 1,
          tileSize: 256,
        } as any).addTo(map);
      } catch {}

      if (!map.getPane("route-weather-ownship")) {
        const pane = map.createPane("route-weather-ownship");
        pane.style.zIndex = "690";
      }
      vesselLayer = L.layerGroup([], { pane: "route-weather-ownship" } as any).addTo(map);
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
      window.clearInterval(staleTimer);
      try { socket?.close(); } catch {}
      try { if (chartLayer && map) map.removeLayer(chartLayer); } catch {}
      try { if (vesselLayer && map) map.removeLayer(vesselLayer); } catch {}
    };
  }, []);

  return null;
}
