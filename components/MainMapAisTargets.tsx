"use client";

import { useEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const AIS_NAME_CACHE_KEY = "navdash-ais-name-cache-v1";
const LIVE_TARGET_MAX_AGE_MS = 30 * 60 * 1000;
const OWN_SHIP_MAX_AGE_MS = 2 * 60 * 1000;
const NAME_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Vessel = {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updatedAt: number;
};

type OwnShip = {
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

type CachedName = { name: string; updatedAt: number };

type AisSnapshotTarget = Partial<Vessel> & {
  mmsi?: number | string;
  name?: string | null;
  lastSeen?: number | string;
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

function decodePosition(line: string, ownShip: boolean): Vessel | OwnShip | null {
  try {
    if (ownShip ? !/^[$!]AIVDO/.test(line) : !line.startsWith("!AIVDM")) return null;
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
    } else if (!ownShip && type === 18) {
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

    const common = { lat, lon, sog, cog, heading, updatedAt: Date.now() };
    return ownShip ? common : { mmsi, ...common };
  } catch {
    return null;
  }
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

function normalizeSnapshotTarget(value: AisSnapshotTarget): Vessel | null {
  const mmsi = Number(value?.mmsi);
  const lat = Number(value?.lat);
  const lon = Number(value?.lon);
  if (!Number.isFinite(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const numberOrNull = (input: unknown) => {
    const number = Number(input);
    return Number.isFinite(number) ? number : null;
  };
  return {
    mmsi,
    lat,
    lon,
    sog: numberOrNull(value.sog),
    cog: numberOrNull(value.cog),
    heading: numberOrNull(value.heading),
    updatedAt: normalizeTime(value.updatedAt ?? value.lastSeen),
  };
}

function velocity(sog: number | null, cog: number | null) {
  if (sog === null || !Number.isFinite(sog)) return null;
  if (sog <= 0.2) return { east: 0, north: 0 };
  if (cog === null || !Number.isFinite(cog)) return null;
  const radians = cog * Math.PI / 180;
  return { east: sog * Math.sin(radians), north: sog * Math.cos(radians) };
}

function cpaTcpa(own: OwnShip | null, target: Vessel) {
  if (!own || Date.now() - own.updatedAt > OWN_SHIP_MAX_AGE_MS) return null;
  if (Date.now() - target.updatedAt > LIVE_TARGET_MAX_AGE_MS) return null;
  const ownVelocity = velocity(own.sog, own.cog);
  const targetVelocity = velocity(target.sog, target.cog);
  if (!ownVelocity || !targetVelocity) return null;

  const meanLat = (own.lat + target.lat) * 0.5 * Math.PI / 180;
  const east = (target.lon - own.lon) * 60 * Math.cos(meanLat);
  const north = (target.lat - own.lat) * 60;
  const relativeEast = targetVelocity.east - ownVelocity.east;
  const relativeNorth = targetVelocity.north - ownVelocity.north;
  const relativeSpeedSquared = relativeEast ** 2 + relativeNorth ** 2;
  if (relativeSpeedSquared < 0.0001) return null;

  const tcpaHours = -((east * relativeEast) + (north * relativeNorth)) / relativeSpeedSquared;
  if (!Number.isFinite(tcpaHours) || tcpaHours < 0) return null;
  const cpaEast = east + relativeEast * tcpaHours;
  const cpaNorth = north + relativeNorth * tcpaHours;
  const cpaNm = Math.hypot(cpaEast, cpaNorth);
  if (!Number.isFinite(cpaNm)) return null;
  return { cpaNm, tcpaMinutes: tcpaHours * 60 };
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

function targetTooltip(vessel: Vessel, name: string | undefined, ownShip: OwnShip | null) {
  const sog = vessel.sog === null ? "--" : `${vessel.sog.toFixed(1)} kt`;
  const cog = vessel.cog === null ? "--" : `${vessel.cog.toFixed(1)}°`;
  const title = name ? escapeHtml(name) : `AIS ${vessel.mmsi}`;
  const mmsiLine = name ? `<br>MMSI ${vessel.mmsi}` : "";
  const approach = cpaTcpa(ownShip, vessel);
  const cpaLine = approach ? `<br>CPA ${approach.cpaNm.toFixed(2)} NM` : `<br>CPA --`;
  const tcpaLine = approach ? `<br>TCPA ${approach.tcpaMinutes < 60 ? `${Math.round(approach.tcpaMinutes)} min` : `${(approach.tcpaMinutes / 60).toFixed(1)} hr`}` : `<br>TCPA --`;
  return `<strong>${title}</strong>${mmsiLine}<br>SOG ${sog}<br>COG ${cog}${cpaLine}${tcpaLine}`;
}

function readNameCache() {
  const result = new Map<number, CachedName>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AIS_NAME_CACHE_KEY) || "{}");
    const cutoff = Date.now() - NAME_CACHE_MAX_AGE_MS;
    for (const [key, value] of Object.entries(parsed || {})) {
      const mmsi = Number(key);
      const entry = value as CachedName;
      if (!Number.isFinite(mmsi) || !entry?.name || normalizeTime(entry.updatedAt) < cutoff) continue;
      result.set(mmsi, { name: String(entry.name), updatedAt: normalizeTime(entry.updatedAt) });
    }
  } catch {}
  return result;
}

function writeNameCache(cache: Map<number, CachedName>) {
  try {
    const object: Record<string, CachedName> = {};
    const cutoff = Date.now() - NAME_CACHE_MAX_AGE_MS;
    for (const [mmsi, entry] of cache) {
      if (entry.updatedAt >= cutoff) object[String(mmsi)] = entry;
    }
    window.localStorage.setItem(AIS_NAME_CACHE_KEY, JSON.stringify(object));
  } catch {}
}

export function MainMapAisTargets() {
  const targetsRef = useRef<Map<number, Vessel>>(new Map());
  const namesRef = useRef<Map<number, string>>(new Map());
  const nameCacheRef = useRef<Map<number, CachedName>>(new Map());
  const ownShipRef = useRef<OwnShip | null>(null);
  const fragmentsRef = useRef<Map<string, FragmentAssembly>>(new Map());
  const markersRef = useRef<Map<number, any>>(new Map());
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let ageTimer = 0;
    let redrawTimer = 0;

    nameCacheRef.current = readNameCache();
    for (const [mmsi, entry] of nameCacheRef.current) namesRef.current.set(mmsi, entry.name);

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

      for (const vessel of targetsRef.current.values()) drawTarget(vessel, L);
    };

    const drawTarget = (vessel: Vessel, leaflet?: any) => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;

      const update = (L: any) => {
        if (disposed || !layerRef.current) return;
        const icon = L.divIcon({
          className: "navmap-main-ais-target-icon",
          html: targetIconHtml(vessel),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const position: [number, number] = [vessel.lat, vessel.lon];
        const tooltip = targetTooltip(vessel, namesRef.current.get(vessel.mmsi), ownShipRef.current);
        let marker = markersRef.current.get(vessel.mmsi);
        if (!marker) {
          marker = L.marker(position, {
            icon,
            pane: "navmap-main-ais-targets-v1",
            interactive: true,
          }).addTo(layerRef.current);
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

    const scheduleRedraw = () => {
      window.clearTimeout(redrawTimer);
      redrawTimer = window.setTimeout(() => {
        for (const vessel of targetsRef.current.values()) drawTarget(vessel);
      }, 400);
    };

    const updateName = (mmsi: number, name: string, updatedAt = Date.now()) => {
      const cleanName = name.replace(/\s+/g, " ").trim();
      if (!cleanName) return;
      namesRef.current.set(mmsi, cleanName);
      nameCacheRef.current.set(mmsi, { name: cleanName, updatedAt });
      writeNameCache(nameCacheRef.current);
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

    const applySnapshotTarget = (item: AisSnapshotTarget) => {
      const vessel = normalizeSnapshotTarget(item);
      if (!vessel || Date.now() - vessel.updatedAt > LIVE_TARGET_MAX_AGE_MS) return;
      targetsRef.current.set(vessel.mmsi, vessel);
      if (typeof item.name === "string" && item.name.trim()) updateName(vessel.mmsi, item.name, vessel.updatedAt);
      drawTarget(vessel);
    };

    const applySnapshot = (message: any) => {
      const targets = Array.isArray(message?.targets) ? message.targets : Array.isArray(message?.vessels) ? message.vessels : [];
      for (const item of targets) applySnapshotTarget(item);

      const identities = Array.isArray(message?.identities) ? message.identities : [];
      for (const identity of identities) {
        const mmsi = Number(identity?.mmsi);
        if (Number.isFinite(mmsi) && typeof identity?.name === "string") updateName(mmsi, identity.name, normalizeTime(identity.updatedAt ?? identity.lastSeen));
      }

      const own = message?.ownShip || message?.ownship;
      if (own && Number.isFinite(Number(own.lat)) && Number.isFinite(Number(own.lon))) {
        ownShipRef.current = {
          lat: Number(own.lat),
          lon: Number(own.lon),
          sog: Number.isFinite(Number(own.sog)) ? Number(own.sog) : null,
          cog: Number.isFinite(Number(own.cog)) ? Number(own.cog) : null,
          heading: Number.isFinite(Number(own.heading)) ? Number(own.heading) : null,
          updatedAt: normalizeTime(own.updatedAt ?? own.lastSeen),
        };
        scheduleRedraw();
      }
    };

    const removeStaleTargets = () => {
      const cutoff = Date.now() - LIVE_TARGET_MAX_AGE_MS;
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
        socket.onopen = () => {
          try { socket?.send(JSON.stringify({ type: "ais-target-snapshot-request" })); } catch {}
        };
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          let json: any = null;
          try { json = JSON.parse(raw); } catch {}

          if (json?.type === "ais-target-snapshot") {
            applySnapshot(json);
            return;
          }
          if (json?.type === "ais-target-update" || json?.type === "ais-target") {
            applySnapshotTarget(json.target || json.vessel || json);
            return;
          }
          if (json?.type === "ais-identity-update") {
            const mmsi = Number(json.mmsi);
            if (Number.isFinite(mmsi) && typeof json.name === "string") updateName(mmsi, json.name, normalizeTime(json.updatedAt ?? json.lastSeen));
            return;
          }
          if (json?.type === "ownship-state" || json?.type === "own-ship-state") {
            const own = json.ownShip || json.ownship || json;
            if (Number.isFinite(Number(own.lat)) && Number.isFinite(Number(own.lon))) {
              ownShipRef.current = {
                lat: Number(own.lat),
                lon: Number(own.lon),
                sog: Number.isFinite(Number(own.sog)) ? Number(own.sog) : null,
                cog: Number.isFinite(Number(own.cog)) ? Number(own.cog) : null,
                heading: Number.isFinite(Number(own.heading)) ? Number(own.heading) : null,
                updatedAt: normalizeTime(own.updatedAt ?? own.lastSeen),
              };
              scheduleRedraw();
            }
            return;
          }

          raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            if (!line) continue;

            const ownShip = decodePosition(line, true) as OwnShip | null;
            if (ownShip) {
              ownShipRef.current = ownShip;
              scheduleRedraw();
              continue;
            }

            processStaticData(line);
            const vessel = decodePosition(line, false) as Vessel | null;
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
      window.clearTimeout(redrawTimer);
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
      nameCacheRef.current.clear();
      ownShipRef.current = null;
      fragmentsRef.current.clear();
    };
  }, []);

  return null;
}
