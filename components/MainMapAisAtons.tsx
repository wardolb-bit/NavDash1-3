"use client";

import { useEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const ATON_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type AisAton = {
  mmsi: number;
  name: string;
  aidType: number;
  lat: number;
  lon: number;
  offPosition: boolean;
  virtual: boolean;
  updatedAt: number;
};

type MultipartAssembly = {
  total: number;
  parts: string[];
  fillBits: number;
  updatedAt: number;
};

function sixBitValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string, fillBits = 0) {
  let bits = payload
    .split("")
    .map((char) => sixBitValue(char).toString(2).padStart(6, "0"))
    .join("");
  if (fillBits > 0 && fillBits < 6) bits = bits.slice(0, -fillBits);
  return bits;
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
    text += String.fromCharCode(value < 32 ? value + 64 : value);
  }
  return text.replace(/@+$/g, "").replace(/\s+/g, " ").trim();
}

function decodeAtonBits(bits: string): AisAton | null {
  try {
    if (bits.length < 272 || unsigned(bits, 0, 6) !== 21) return null;
    const mmsi = unsigned(bits, 8, 30);
    const aidType = unsigned(bits, 38, 5);
    const baseName = decodeSixBitText(bits, 43, 120);
    const lon = signed(bits, 164, 28) / 600000;
    const lat = signed(bits, 192, 27) / 600000;
    const offPosition = unsigned(bits, 259, 1) === 1;
    const virtual = unsigned(bits, 269, 1) === 1;
    const extension = bits.length > 272 ? decodeSixBitText(bits, 272, bits.length - 272) : "";
    const name = `${baseName}${extension ? ` ${extension}` : ""}`.replace(/\s+/g, " ").trim();

    if (!Number.isFinite(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;

    return { mmsi, name, aidType, lat, lon, offPosition, virtual, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

function atonTypeLabel(type: number) {
  const labels = [
    "AtoN type not specified",
    "Reference point",
    "RACON",
    "Fixed offshore structure",
    "Reserved",
    "Light, no sectors",
    "Light, with sectors",
    "Leading light, front",
    "Leading light, rear",
    "Beacon, cardinal north",
    "Beacon, cardinal east",
    "Beacon, cardinal south",
    "Beacon, cardinal west",
    "Beacon, port hand",
    "Beacon, starboard hand",
    "Beacon, preferred channel port",
    "Beacon, preferred channel starboard",
    "Beacon, isolated danger",
    "Beacon, safe water",
    "Beacon, special mark",
    "Cardinal mark, north",
    "Cardinal mark, east",
    "Cardinal mark, south",
    "Cardinal mark, west",
    "Port-hand mark",
    "Starboard-hand mark",
    "Preferred channel, port hand",
    "Preferred channel, starboard hand",
    "Isolated danger",
    "Safe water",
    "Special mark",
    "Light vessel / LANBY / rig",
  ];
  return labels[type] || `AtoN type ${type}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function atonIconHtml(aton: AisAton) {
  const stroke = aton.virtual ? "#e879f9" : "#fbbf24";
  const dash = aton.virtual ? ' stroke-dasharray="3 2"' : "";
  const label = aton.virtual ? "V" : "A";
  return `<div style="width:24px;height:24px;filter:drop-shadow(0 0 3px rgba(0,0,0,.75))"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#071019" stroke="${stroke}" stroke-width="2"${dash}/><text x="12" y="15" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="${stroke}">${label}</text>${aton.offPosition ? `<circle cx="19" cy="5" r="3" fill="#ef4444" stroke="#071019" stroke-width="1"/>` : ""}</svg></div>`;
}

function atonTooltip(aton: AisAton) {
  const title = aton.name ? escapeHtml(aton.name) : `AIS AtoN ${aton.mmsi}`;
  const status = aton.offPosition ? "OFF POSITION" : "ON POSITION";
  const mode = aton.virtual ? "VIRTUAL" : "PHYSICAL";
  return `<strong>${title}</strong><br>MMSI ${aton.mmsi}<br>TYPE ${escapeHtml(atonTypeLabel(aton.aidType))}<br>STATUS ${status}<br>AIS AtoN ${mode}`;
}

function normalizeTime(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeAtonObject(value: any): AisAton | null {
  const mmsi = Number(value?.mmsi);
  const lat = Number(value?.lat ?? value?.latitude ?? value?.position?.lat ?? value?.position?.latitude);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude ?? value?.position?.lon ?? value?.position?.lng ?? value?.position?.longitude);
  const aidType = Number(value?.aidType ?? value?.atonType ?? value?.typeOfAid ?? 0);
  if (!Number.isFinite(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    mmsi,
    lat,
    lon,
    aidType: Number.isFinite(aidType) ? aidType : 0,
    name: typeof value?.name === "string" ? value.name.trim() : "",
    offPosition: Boolean(value?.offPosition ?? value?.off_position),
    virtual: Boolean(value?.virtual ?? value?.virtualAton ?? value?.virtual_aton),
    updatedAt: normalizeTime(value?.updatedAt ?? value?.lastSeen),
  };
}

export function MainMapAisAtons() {
  const atonsRef = useRef<Map<number, AisAton>>(new Map());
  const markersRef = useRef<Map<number, any>>(new Map());
  const fragmentsRef = useRef<Map<string, MultipartAssembly>>(new Map());
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let ageTimer = 0;

    const drawAton = (aton: AisAton, leaflet?: any) => {
      if (!mapRef.current || !layerRef.current) return;
      const update = (L: any) => {
        if (disposed || !layerRef.current) return;
        const icon = L.divIcon({
          className: "navmap-main-ais-aton-icon",
          html: atonIconHtml(aton),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const position: [number, number] = [aton.lat, aton.lon];
        const tooltip = atonTooltip(aton);
        let marker = markersRef.current.get(aton.mmsi);
        if (!marker) {
          marker = L.marker(position, { icon, pane: "navmap-main-ais-atons-v1", interactive: true }).addTo(layerRef.current);
          marker.bindTooltip(tooltip, {
            direction: "top",
            opacity: 0.97,
            pane: "navmap-main-ais-info-v1",
          });
          markersRef.current.set(aton.mmsi, marker);
        } else {
          marker.setLatLng(position);
          marker.setIcon(icon);
          marker.setTooltipContent(tooltip);
        }
      };
      if (leaflet) update(leaflet);
      else void import("leaflet").then(update);
    };

    const ensureLayer = async () => {
      if (disposed) return;
      const element = document.getElementById("navmap-main-isolated-v2") as any;
      const map = element?.__navdashLeafletMap;
      if (!map) {
        reconnectTimer = window.setTimeout(ensureLayer, 250);
        return;
      }
      if (mapRef.current === map && layerRef.current) return;

      if (layerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch {}
      }
      markersRef.current.clear();

      const L = await import("leaflet");
      if (disposed) return;
      mapRef.current = map;
      if (!map.getPane("navmap-main-ais-atons-v1")) {
        const pane = map.createPane("navmap-main-ais-atons-v1");
        pane.style.zIndex = "716";
      }
      if (!map.getPane("navmap-main-ais-info-v1")) {
        const pane = map.createPane("navmap-main-ais-info-v1");
        pane.style.zIndex = "760";
        pane.style.pointerEvents = "none";
      }
      layerRef.current = L.layerGroup([], { pane: "navmap-main-ais-atons-v1" } as any).addTo(map);
      for (const aton of atonsRef.current.values()) drawAton(aton, L);
    };

    const applyAton = (aton: AisAton | null) => {
      if (!aton) return;
      atonsRef.current.set(aton.mmsi, aton);
      drawAton(aton);
    };

    const processAivdm = (line: string) => {
      if (!line.startsWith("!AIVDM")) return;
      const parts = line.split(",");
      if (parts.length < 7 || !parts[5]) return;
      const total = Number(parts[1]);
      const number = Number(parts[2]);
      const sequence = parts[3] || "";
      const channel = parts[4] || "";
      const payload = parts[5];
      const fillBits = Number(parts[6]?.split("*")[0] || 0);
      if (!Number.isFinite(total) || !Number.isFinite(number) || total < 1 || number < 1 || number > total) return;

      if (total === 1) {
        applyAton(decodeAtonBits(payloadToBits(payload, fillBits)));
        return;
      }

      const key = `${sequence}|${channel}|${total}`;
      const current = fragmentsRef.current.get(key) || {
        total,
        parts: new Array(total).fill(""),
        fillBits: 0,
        updatedAt: Date.now(),
      };
      current.parts[number - 1] = payload;
      if (number === total) current.fillBits = fillBits;
      current.updatedAt = Date.now();
      fragmentsRef.current.set(key, current);
      if (!current.parts.every(Boolean)) return;

      fragmentsRef.current.delete(key);
      applyAton(decodeAtonBits(payloadToBits(current.parts.join(""), current.fillBits)));
    };

    const removeStale = () => {
      const cutoff = Date.now() - ATON_MAX_AGE_MS;
      for (const [mmsi, aton] of atonsRef.current) {
        if (aton.updatedAt >= cutoff) continue;
        atonsRef.current.delete(mmsi);
        const marker = markersRef.current.get(mmsi);
        if (marker && layerRef.current) {
          try { layerRef.current.removeLayer(marker); } catch {}
        }
        markersRef.current.delete(mmsi);
      }
      const fragmentCutoff = Date.now() - 60_000;
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
        socket.onopen = () => {
          try { socket?.send(JSON.stringify({ type: "ais-aton-snapshot-request" })); } catch {}
        };
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          let json: any = null;
          try { json = JSON.parse(raw); } catch {}

          if (json?.type === "ais-aton-update" || json?.type === "ais-aton") {
            applyAton(normalizeAtonObject(json.aton || json.target || json));
            return;
          }
          if (json?.type === "ais-aton-snapshot") {
            const atons = Array.isArray(json.atons) ? json.atons : Array.isArray(json.targets) ? json.targets : [];
            for (const item of atons) applyAton(normalizeAtonObject(item));
            return;
          }

          raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            if (line) processAivdm(line);
          }
        };
        socket.onclose = () => {
          if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();
    ageTimer = window.setInterval(removeStale, 60_000);

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
      atonsRef.current.clear();
      fragmentsRef.current.clear();
    };
  }, []);

  return null;
}
