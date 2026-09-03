"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type DecodedTarget = {
  type: number;
  mmsi: number;
  lat?: number;
  lon?: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  vesselName?: string;
  source: "AIVDM";
};

type Target = DecodedTarget & {
  lastSeen: number;
};

type FragmentBuffer = {
  total: number;
  parts: string[];
  fillBits: number;
  firstSeen: number;
  raw: string;
};

const TARGET_STALE_MS = 10 * 60 * 1000;
const FRAGMENT_TTL_MS = 15 * 1000;
const MAP_READY_EVENT = "navdash-main-map-ready";

function aisPayloadToBits(payload: string) {
  let bits = "";
  for (const ch of payload) {
    let value = ch.charCodeAt(0) - 48;
    if (value > 40) value -= 8;
    bits += value.toString(2).padStart(6, "0");
  }
  return bits;
}

function readUnsigned(bits: string, start: number, length: number) {
  const chunk = bits.slice(start, start + length);
  if (chunk.length < length) return null;
  return parseInt(chunk, 2);
}

function readSigned(bits: string, start: number, length: number) {
  const chunk = bits.slice(start, start + length);
  if (chunk.length < length) return null;
  const unsigned = parseInt(chunk, 2);
  return chunk[0] === "1" ? unsigned - 2 ** length : unsigned;
}

function readText(bits: string, start: number, length: number) {
  const alphabet = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";
  let text = "";
  for (let offset = start; offset < start + length; offset += 6) {
    const value = readUnsigned(bits, offset, 6);
    if (value === null) break;
    text += alphabet[value] || " ";
  }
  return text.replace(/@/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCourse(value: number | null) {
  if (value === null || value === 3600) return null;
  return value / 10;
}

function normalizeSpeed(value: number | null) {
  if (value === null || value === 1023) return null;
  return value / 10;
}

function normalizeHeading(value: number | null) {
  if (value === null || value === 511) return null;
  return value;
}

function extractNmeaLine(message: any) {
  if (typeof message === "string") return message.trim();
  if (typeof message?.line === "string") return message.line.trim();
  if (typeof message?.sentence === "string") return message.sentence.trim();
  if (typeof message?.nmea === "string") return message.nmea.trim();
  return "";
}

function parseAivdmSentence(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!AIVDM") && !trimmed.startsWith("$AIVDM")) return null;

  const withoutChecksum = trimmed.split("*")[0];
  const parts = withoutChecksum.split(",");
  if (parts.length < 7) return null;

  const total = Number(parts[1]);
  const fragment = Number(parts[2]);
  const sequence = parts[3] || "";
  const channel = parts[4] || "";
  const payload = parts[5] || "";
  const fillBits = Number(parts[6] || 0);

  if (!Number.isFinite(total) || !Number.isFinite(fragment) || !payload) return null;

  return {
    total,
    fragment,
    sequence,
    channel,
    payload,
    fillBits: Number.isFinite(fillBits) ? fillBits : 0,
    raw: trimmed,
  };
}

function decodePayload(payload: string, fillBits: number): DecodedTarget | null {
  const bitsWithFill = aisPayloadToBits(payload);
  const bits = fillBits > 0 ? bitsWithFill.slice(0, -fillBits) : bitsWithFill;
  const type = readUnsigned(bits, 0, 6);
  const mmsi = readUnsigned(bits, 8, 30);

  if (type === null || mmsi === null) return null;

  const base: DecodedTarget = { type, mmsi, source: "AIVDM" };

  if ([1, 2, 3].includes(type)) {
    const sogRaw = readUnsigned(bits, 50, 10);
    const lonRaw = readSigned(bits, 61, 28);
    const latRaw = readSigned(bits, 89, 27);
    const cogRaw = readUnsigned(bits, 116, 12);
    const headingRaw = readUnsigned(bits, 128, 9);

    if (latRaw === null || lonRaw === null) return base;
    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return base;

    return {
      ...base,
      lat,
      lon,
      sog: normalizeSpeed(sogRaw),
      cog: normalizeCourse(cogRaw),
      heading: normalizeHeading(headingRaw),
    };
  }

  if ([18, 19].includes(type)) {
    const sogRaw = readUnsigned(bits, 46, 10);
    const lonRaw = readSigned(bits, 57, 28);
    const latRaw = readSigned(bits, 85, 27);
    const cogRaw = readUnsigned(bits, 112, 12);
    const headingRaw = readUnsigned(bits, 124, 9);

    if (latRaw === null || lonRaw === null) return base;
    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return base;

    const decoded: DecodedTarget = {
      ...base,
      lat,
      lon,
      sog: normalizeSpeed(sogRaw),
      cog: normalizeCourse(cogRaw),
      heading: normalizeHeading(headingRaw),
    };

    if (type === 19 && bits.length >= 312) decoded.vesselName = readText(bits, 143, 120);
    return decoded;
  }

  if (type === 5 && bits.length >= 424) {
    return { ...base, vesselName: readText(bits, 112, 120) };
  }

  if (type === 24 && bits.length >= 160) {
    const partNumber = readUnsigned(bits, 38, 2);
    if (partNumber === 0) return { ...base, vesselName: readText(bits, 40, 120) };
  }

  return base;
}

function decodeAivdmLine(line: string, fragments: Map<string, FragmentBuffer>) {
  const parsed = parseAivdmSentence(line);
  if (!parsed) return null;

  const now = Date.now();
  for (const [key, fragment] of Array.from(fragments.entries())) {
    if (now - fragment.firstSeen > FRAGMENT_TTL_MS) fragments.delete(key);
  }

  if (parsed.total <= 1) return decodePayload(parsed.payload, parsed.fillBits);

  const key = `${parsed.sequence || "no-seq"}-${parsed.channel}`;
  const existing = fragments.get(key) || {
    total: parsed.total,
    parts: [],
    fillBits: parsed.fillBits,
    firstSeen: now,
    raw: parsed.raw,
  };

  existing.parts[parsed.fragment - 1] = parsed.payload;
  existing.fillBits = parsed.fillBits;
  existing.raw = `${existing.raw}\n${parsed.raw}`;
  fragments.set(key, existing);

  if (existing.parts.filter(Boolean).length !== existing.total) return null;

  fragments.delete(key);
  return decodePayload(existing.parts.join(""), existing.fillBits);
}

function formatSpeed(value?: number | null) {
  return value === undefined || value === null || !Number.isFinite(value) ? "--" : `${value.toFixed(1)} kt`;
}

export function AisTargetMapBridge() {
  const leafletRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const targetsRef = useRef<Record<number, Target>>({});
  const fragmentsRef = useRef<Map<string, FragmentBuffer>>(new Map());

  function drawTargets() {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!targetLayerRef.current) targetLayerRef.current = L.layerGroup().addTo(map);
    const layer = targetLayerRef.current;
    layer.clearLayers();

    const now = Date.now();
    for (const target of Object.values(targetsRef.current)) {
      if (now - target.lastSeen >= TARGET_STALE_MS) continue;
      if (target.lat === undefined || target.lon === undefined) continue;

      L.circleMarker([target.lat, target.lon], {
        radius: 6,
        color: "#facc15",
        fillColor: "#facc15",
        fillOpacity: 0.75,
        weight: 2,
      })
        .bindTooltip(`${target.vesselName || target.mmsi} ${formatSpeed(target.sog)}`, { permanent: false })
        .addTo(layer);
    }
  }

  useLayoutEffect(() => {
    let cancelled = false;

    import("leaflet").then((leafletModule) => {
      if (cancelled) return;
      const L: any = leafletModule;
      leafletRef.current = L;

      const w = window as any;
      if (!w.__navdashMainMapCaptureInstalled) {
        w.__navdashMainMapCaptureInstalled = true;
        const originalInitialize = L.Map.prototype.initialize;

        L.Map.prototype.initialize = function (...args: any[]) {
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

      if (w.__navdashMainMap) {
        mapRef.current = w.__navdashMainMap;
        drawTargets();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleMapReady = (event: Event) => {
      const nextMap = (event as CustomEvent).detail;
      if (!nextMap) return;

      if (targetLayerRef.current && mapRef.current && mapRef.current !== nextMap) {
        try {
          mapRef.current.removeLayer(targetLayerRef.current);
        } catch {
          // Ignore stale map cleanup errors during route changes.
        }
        targetLayerRef.current = null;
      }

      mapRef.current = nextMap;
      drawTargets();
    };

    window.addEventListener(MAP_READY_EVENT, handleMapReady);
    return () => window.removeEventListener(MAP_READY_EVENT, handleMapReady);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onmessage = (event) => {
      let message: any = event.data;
      try {
        message = JSON.parse(event.data);
      } catch {
        // Plain NMEA is acceptable.
      }

      const line = extractNmeaLine(message);
      if (!line || (!line.startsWith("!AIVDM") && !line.startsWith("$AIVDM"))) return;

      const decoded = decodeAivdmLine(line, fragmentsRef.current);
      if (!decoded) return;

      const prior = targetsRef.current[decoded.mmsi];
      targetsRef.current = {
        ...targetsRef.current,
        [decoded.mmsi]: {
          ...prior,
          ...decoded,
          vesselName: decoded.vesselName || prior?.vesselName,
          lat: decoded.lat ?? prior?.lat,
          lon: decoded.lon ?? prior?.lon,
          sog: decoded.sog ?? prior?.sog,
          cog: decoded.cog ?? prior?.cog,
          heading: decoded.heading ?? prior?.heading,
          lastSeen: Date.now(),
        },
      };

      drawTargets();
    };

    return () => ws.close();
  }, []);

  return null;
}
