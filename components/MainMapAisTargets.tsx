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

type FragmentAssembly = {
  total: number;
  parts: string[];
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

function decodeSixBitText(bits: string, start: number, length: number) {
  let text = "";
  const end = Math.min(bits.length, start + length);
  for (let offset = start; offset + 6 <= end; offset += 6) {
    const value = unsigned(bits, offset, 6);
    const code = value < 32 ? value + 64 : value;
    text += String.fromCharCode(code);
  }
  return text.replace(/@+$/g, "").trim();
}

function decodeStaticNameFromPayload(payload: string): { mmsi: number; name: string } | null {
  try {
    const bits = payloadToBits(payload);
    if (bits.length < 40) return null;
    const type = unsigned(bits, 0, 6);
    const mmsi = unsigned(bits, 8, 30);

    if (type === 5) {
      if (bits.length < 232) return null;
      const name = decodeSixBitText(bits, 112, 120);
      return name ? { mmsi, name } : null;
    }

    if (type === 24) {
      const partNumber = unsigned(bits, 38, 2);
      if (partNumber !== 0 || bits.length < 160) return null;
      const name = decodeSixBitText(bits, 40, 120);
      return name ? { mmsi, name } : null;
    }

    return null;
  } catch {
    return null;
  }
}

// Intentionally mirrors the proven Pilot-page position decoder.
function decodeAisTarget(line: string): Vessel | null {
  try {
    if (!line.startsWith("!AIVDM")) return null;
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

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;

    return { mmsi, lat, lon, sog, cog, heading, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

function targetIconHtml(vessel: Vessel) {
  const orientation = vessel.heading ?? vessel.cog ?? 0;
  return `<div style="width:22px;height:22px;transform:rotate(${orientation}deg);transform-origin:11px 11px;filter:drop-shadow(0 0 3px rgba(56,189,248,.35))"><svg width="22" height="22" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#08131c" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#38bdf8" stroke-width="1.4"/><circle cx="15" cy="15" r="2" fill="#38bdf8"/></svg></div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function targetTooltip(vessel: Vessel, name?: string) {
  const sog = vessel.sog === null ? "--" : `${vessel.sog.toFixed(1)} kt`;
  const cog = vessel.cog === null ? "--" : `${vessel.cog.toFixed(1)}°`;
  const title = name ? escapeHtml(name) : `AIS ${vessel.mmsi}`;
  const mmsiLine = name ? `<br>MMSI ${vessel.mmsi}` : "";
  return `<strong>${title}</strong>${mmsiLine}<br>SOG ${sog}<br>COG ${cog}`;
}

export function MainMapAisTargets() {
  const targetsRef = useRef<Map<number, Vessel>>(new Map());
  const namesRef = useRef<Map<number, string>>(new Map());
  const fragmentsRef = useRef<Map<string, FragmentAssembly>>(new Map());
  const markersRef = useRef<Map<number, any>>(new Map());
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let ageTimer = 0;

    const ensureLayer = async () => {
      if (disposed) return;
      const element = document.getElementById("navmap-main-isolated-v2") as any;
      const map = element?.__navdashLeafletMap;
      if (!map) return;
      if (mapRef.current === map && layerRef.current) return;

      if (layerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch {}
      }
      markersRef.current.clear();

      const L = await import("leaflet");
      if (disposed) return;
      mapRef.current = map;
      if (!map.getPane("navmap-main-ais-targets-v1")) {
        const pane = map.createPane("navmap-main-ais-targets-v1");
        pane.style.zIndex = "715";
      }
      layerRef.current = L.layerGroup([], { pane: "navmap-main-ais-targets-v1" } as any).addTo(map);

      for (const vessel of targetsRef.current.values()) {
        drawTarget(vessel, L);
      }
    };

    const drawTarget = (vessel: Vessel, leaflet?: any) => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;

      const update = (L: any) => {
        const icon = L.divIcon({
          className: "navmap-main-ais-target-icon",
          html: targetIconHtml(vessel),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const position: [number, number] = [vessel.lat, vessel.lon];
        const tooltip = targetTooltip(vessel, namesRef.current.get(vessel.mmsi));
        let marker = markersRef.current.get(vessel.mmsi);
        if (!marker) {
          marker = L.marker(position, {
            icon,
            pane: "navmap-main-ais-targets-v1",
            interactive: true,
          }).addTo(layer);
          marker.bindTooltip(tooltip, {
            direction: "top",
            opacity: 0.96,
            pane: "navmap-main-ais-targets-v1",
          });
          markersRef.current.set(vessel.mmsi, marker);
        } else {
          marker.setLatLng(position);
          marker.setIcon(icon);
          marker.setTooltipContent(tooltip);
        }
      };

      if (leaflet) update(leaflet);
      else void import("leaflet").then(update);
    };

    const updateName = (mmsi: number, name: string) => {
      const cleanName = name.replace(/\s+/g, " ").trim();
      if (!cleanName) return;
      if (namesRef.current.get(mmsi) === cleanName) return;
      namesRef.current.set(mmsi, cleanName);
      const vessel = targetsRef.current.get(mmsi);
      if (vessel) drawTarget(vessel);
    };

    const processStaticData = (line: string) => {
      if (!line.startsWith("!AIVDM")) return;
      const parts = line.split(",");
      if (parts.length < 6 || !parts[5]) return;

      const total = Number(parts[1]);
      const number = Number(parts[2]);
      const sequence = parts[3] || "";
      const channel = parts[4] || "";
      const payload = parts[5];
      if (!Number.isFinite(total) || !Number.isFinite(number) || total < 1 || number < 1 || number > total) return;

      if (total === 1) {
        const decoded = decodeStaticNameFromPayload(payload);
        if (decoded) updateName(decoded.mmsi, decoded.name);
        return;
      }

      const key = `${sequence}|${channel}|${total}`;
      const current = fragmentsRef.current.get(key) || {
        total,
        parts: new Array(total).fill(""),
        updatedAt: Date.now(),
      };
      current.parts[number - 1] = payload;
      current.updatedAt = Date.now();
      fragmentsRef.current.set(key, current);

      if (current.parts.every(Boolean)) {
        fragmentsRef.current.delete(key);
        const decoded = decodeStaticNameFromPayload(current.parts.join(""));
        if (decoded) updateName(decoded.mmsi, decoded.name);
      }
    };

    const removeStaleTargets = () => {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [mmsi, vessel] of targetsRef.current) {
        if (vessel.updatedAt >= cutoff) continue;
        targetsRef.current.delete(mmsi);
        const marker = markersRef.current.get(mmsi);
        if (marker && layerRef.current) {
          try { layerRef.current.removeLayer(marker); } catch {}
        }
        markersRef.current.delete(mmsi);
      }

      const fragmentCutoff = Date.now() - 60 * 1000;
      for (const [key, assembly] of fragmentsRef.current) {
        if (assembly.updatedAt < fragmentCutoff) fragmentsRef.current.delete(key);
      }
    };

    const onMapReady = () => { void ensureLayer(); };
    window.addEventListener("navdash-leaflet-map-ready", onMapReady);
    void ensureLayer();

    const connect = () => {
      if (disposed) return;
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
            if (!line) continue;
            processStaticData(line);
            const vessel = decodeAisTarget(line);
            if (!vessel) continue;
            targetsRef.current.set(vessel.mmsi, vessel);
            drawTarget(vessel);
          }
        };
        socket.onclose = () => {
          if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();
    ageTimer = window.setInterval(removeStaleTargets, 30000);

    return () => {
      disposed = true;
      window.removeEventListener("navdash-leaflet-map-ready", onMapReady);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(ageTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      if (layerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch {}
      }
      layerRef.current = null;
      mapRef.current = null;
      markersRef.current.clear();
      targetsRef.current.clear();
      namesRef.current.clear();
      fragmentsRef.current.clear();
    };
  }, []);

  return null;
}
