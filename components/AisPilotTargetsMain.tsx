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
    if (!line.startsWith("!AIVDM") && !line.startsWith("!AIVDO")) return null;
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
  const stroke = "#38bdf8";
  const fill = "#08131c";
  const accent = "#38bdf8";
  const size = 22;
  const center = size / 2;
  return `<div style="width:${size}px;height:${size}px;transform:rotate(${orientation}deg);transform-origin:${center}px ${center}px;filter:drop-shadow(0 0 4px rgba(34,211,238,.35))"><svg width="${size}" height="${size}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="${accent}" stroke-width="1.4"/><circle cx="15" cy="15" r="2" fill="${stroke}"/></svg></div>`;
}

function findMainMap(container: any) {
  if (!container) return null;
  const events = container._leaflet_events;
  if (!events || typeof events !== "object") return null;

  for (const entry of Object.values(events) as any[]) {
    for (const candidate of [entry?.ctx, entry?.context, entry?._ctx, entry?.handler?.ctx]) {
      if (
        candidate &&
        typeof candidate.addLayer === "function" &&
        typeof candidate.getContainer === "function" &&
        candidate.getContainer() === container
      ) {
        return candidate;
      }
    }
  }
  return null;
}

export function AisPilotTargetsMain() {
  const mapRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const targetMarkersRef = useRef<Map<number, any>>(new Map());
  const targetsRef = useRef<Map<number, Vessel>>(new Map());
  const leafletRef = useRef<any>(null);

  function drawTargets() {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = targetLayerRef.current;
    if (!L || !map || !layer) return;

    const live = new Set<number>();
    const cutoff = Date.now() - 10 * 60 * 1000;

    for (const [mmsi, vessel] of targetsRef.current) {
      if (vessel.updatedAt < cutoff) continue;
      live.add(mmsi);
      const pos: [number, number] = [vessel.lat, vessel.lon];
      const icon = L.divIcon({
        className: "pilot-target-icon",
        html: vesselIconHtml(vessel),
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const popup = `<div style="font-family:ui-monospace,monospace;min-width:150px"><b>MMSI ${mmsi}</b><br/>COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"}<br/>SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}<br/>HDG ${vessel.heading === null ? "---" : vessel.heading.toFixed(0) + "°"}</div>`;
      const existing = targetMarkersRef.current.get(mmsi);

      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
      } else {
        const marker = L.marker(pos, { icon, pane: "pilot-targets" }).bindPopup(popup).addTo(layer);
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
    let timer = 0;

    import("leaflet").then((L) => {
      if (cancelled) return;
      leafletRef.current = L;

      const attach = () => {
        if (cancelled) return;
        const map = findMainMap(document.getElementById("v12-map") as any);
        if (map && map !== mapRef.current) {
          mapRef.current = map;
          if (!map.getPane("pilot-targets")) {
            const pane = map.createPane("pilot-targets");
            pane.style.zIndex = "710";
          }
          targetLayerRef.current = L.layerGroup([], { pane: "pilot-targets" } as any).addTo(map);
          drawTargets();
        }
        timer = window.setTimeout(attach, map ? 1000 : 150);
      };

      attach();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (targetLayerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(targetLayerRef.current); } catch {}
      }
      targetMarkersRef.current.clear();
      targetLayerRef.current = null;
      mapRef.current = null;
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
            if (!decoded || line.startsWith("!AIVDO")) continue;
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
      const cutoff = Date.now() - 10 * 60 * 1000;
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
