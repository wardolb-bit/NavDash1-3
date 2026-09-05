"use client";

import { useEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type Vessel = {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updatedAt: number;
};

const MAP_READY_EVENT = "navdash-main-map-ready";
const TARGET_STALE_MS = 10 * 60 * 1000;

let leafletPromise: Promise<any> | null = null;

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
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

function decodeAisPosition(line: string): Vessel | null {
  try {
    if (!line.startsWith("!AIVDM") && !line.startsWith("$AIVDM")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;

    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    const mmsi = unsigned(bits, 8, 30);

    let sog: number | null = null;
    let cog: number | null = null;
    let heading: number | null = null;
    let lon = 0;
    let lat = 0;

    if ([1, 2, 3].includes(type)) {
      const sogRaw = unsigned(bits, 50, 10);
      lon = signed(bits, 61, 28) / 600000;
      lat = signed(bits, 89, 27) / 600000;
      const cogRaw = unsigned(bits, 116, 12);
      const headingRaw = unsigned(bits, 128, 9);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
      heading = headingRaw === 511 ? null : headingRaw;
    } else if (type === 18) {
      const sogRaw = unsigned(bits, 46, 10);
      lon = signed(bits, 57, 28) / 600000;
      lat = signed(bits, 85, 27) / 600000;
      const cogRaw = unsigned(bits, 112, 12);
      const headingRaw = unsigned(bits, 124, 9);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
      heading = headingRaw === 511 ? null : headingRaw;
    } else {
      return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;

    return { mmsi, lat, lon, sog, cog, heading, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

function vesselIconHtml(vessel: Vessel) {
  const orientation = vessel.heading ?? vessel.cog ?? 0;
  return `<div style="width:24px;height:24px;transform:rotate(${orientation}deg);transform-origin:12px 12px;filter:drop-shadow(0 0 3px rgba(250,204,21,.6))"><svg width="24" height="24" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#06111f" stroke="#facc15" stroke-width="2" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#facc15" stroke-width="1.4"/><circle cx="15" cy="15" r="2" fill="#facc15"/></svg></div>`;
}

function installMapCapture(L: any) {
  const w = window as any;
  if (w.__navdashMainMapCaptureInstalledV2) return;
  w.__navdashMainMapCaptureInstalledV2 = true;

  const proto = L?.Map?.prototype;
  const originalInitialize = proto?.initialize;
  if (typeof originalInitialize !== "function") return;

  proto.initialize = function (...args: any[]) {
    const result = originalInitialize.apply(this, args);
    const container = args[0];
    const containerId = typeof container === "string" ? container : container?.id;
    if (containerId === "v12-map") {
      w.__navdashMainMap = this;
      window.dispatchEvent(new CustomEvent(MAP_READY_EVENT, { detail: this }));
    }
    return result;
  };
}

function getLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import("leaflet").then((module) => {
      const L: any = module;
      installMapCapture(L);
      return L;
    });
  }
  return leafletPromise;
}

if (typeof window !== "undefined") {
  void getLeaflet();
}

export function AisTargetMapBridgeV2() {
  const leafletRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const targetMarkersRef = useRef<Map<number, any>>(new Map());
  const targetsRef = useRef<Map<number, Vessel>>(new Map());

  function attachMap(nextMap: any) {
    if (!nextMap) return;
    mapRef.current = nextMap;

    const L = leafletRef.current;
    if (!L) return;

    if (!nextMap.getPane("navdash-ais-targets")) {
      const pane = nextMap.createPane("navdash-ais-targets");
      pane.style.zIndex = "715";
    }

    if (!targetLayerRef.current) {
      targetLayerRef.current = L.layerGroup([], { pane: "navdash-ais-targets" } as any).addTo(nextMap);
    } else if (!nextMap.hasLayer(targetLayerRef.current)) {
      targetLayerRef.current.addTo(nextMap);
    }
  }

  function drawTargets() {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = targetLayerRef.current;
    if (!L || !map || !layer) return;

    const now = Date.now();
    const live = new Set<number>();

    for (const [mmsi, vessel] of targetsRef.current) {
      if (now - vessel.updatedAt >= TARGET_STALE_MS) continue;
      live.add(mmsi);

      const pos: [number, number] = [vessel.lat, vessel.lon];
      const icon = L.divIcon({
        className: "navdash-ais-target-icon",
        html: vesselIconHtml(vessel),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const popup = `<div style="font-family:ui-monospace,monospace;min-width:150px"><b>MMSI ${mmsi}</b><br/>COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"}<br/>SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}<br/>HDG ${vessel.heading === null ? "---" : vessel.heading.toFixed(0) + "°"}</div>`;
      const existing = targetMarkersRef.current.get(mmsi);

      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
      } else {
        const marker = L.marker(pos, { icon, pane: "navdash-ais-targets" })
          .bindPopup(popup)
          .addTo(layer);
        targetMarkersRef.current.set(mmsi, marker);
      }
    }

    for (const [mmsi, marker] of targetMarkersRef.current) {
      if (!live.has(mmsi)) {
        layer.removeLayer(marker);
        targetMarkersRef.current.delete(mmsi);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    getLeaflet().then((L) => {
      if (cancelled) return;
      leafletRef.current = L;
      const w = window as any;
      if (w.__navdashMainMap) {
        attachMap(w.__navdashMainMap);
        drawTargets();
      }
    });

    const handleMapReady = (event: Event) => {
      attachMap((event as CustomEvent).detail);
      drawTargets();
    };

    window.addEventListener(MAP_READY_EVENT, handleMapReady);
    return () => {
      cancelled = true;
      window.removeEventListener(MAP_READY_EVENT, handleMapReady);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}

          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            const decoded = decodeAisPosition(line);
            if (!decoded) continue;
            targetsRef.current.set(decoded.mmsi, decoded);
          }
          drawTargets();
        };
        socket.onclose = () => {
          if (!closed) retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        retryTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - TARGET_STALE_MS;
      let changed = false;
      for (const [mmsi, vessel] of targetsRef.current) {
        if (vessel.updatedAt < cutoff) {
          targetsRef.current.delete(mmsi);
          changed = true;
        }
      }
      if (changed) drawTargets();
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
