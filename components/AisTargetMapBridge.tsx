"use client";

import { useEffect, useRef } from "react";
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

type Target = DecodedTarget & { lastSeen: number };
type FragmentBuffer = { total: number; parts: string[]; fillBits: number; firstSeen: number; raw: string };

const TARGET_STALE_MS = 10 * 60 * 1000;
const FRAGMENT_TTL_MS = 15 * 1000;

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
  return value === null || value === 3600 ? null : value / 10;
}

function normalizeSpeed(value: number | null) {
  return value === null || value === 1023 ? null : value / 10;
}

function normalizeHeading(value: number | null) {
  return value === null || value === 511 ? null : value;
}

function extractNmeaLine(message: any) {
  if (typeof message === "string") return message.trim();
  for (const key of ["line", "sentence", "nmea", "raw", "data", "payload"]) {
    if (typeof message?.[key] === "string") return message[key].trim();
  }
  return "";
}

function parseAivdmSentence(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!AIVDM") && !trimmed.startsWith("$AIVDM")) return null;
  const parts = trimmed.split("*")[0].split(",");
  if (parts.length < 7) return null;

  const total = Number(parts[1]);
  const fragment = Number(parts[2]);
  const sequence = parts[3] || "";
  const channel = parts[4] || "";
  const payload = parts[5] || "";
  const fillBits = Number(parts[6] || 0);

  if (!Number.isFinite(total) || !Number.isFinite(fragment) || !payload) return null;
  return { total, fragment, sequence, channel, payload, fillBits: Number.isFinite(fillBits) ? fillBits : 0, raw: trimmed };
}

function decodePayload(payload: string, fillBits: number): DecodedTarget | null {
  const allBits = aisPayloadToBits(payload);
  const bits = fillBits > 0 ? allBits.slice(0, -fillBits) : allBits;
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
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001)) return base;
    return { ...base, lat, lon, sog: normalizeSpeed(sogRaw), cog: normalizeCourse(cogRaw), heading: normalizeHeading(headingRaw) };
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
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001)) return base;
    const decoded: DecodedTarget = { ...base, lat, lon, sog: normalizeSpeed(sogRaw), cog: normalizeCourse(cogRaw), heading: normalizeHeading(headingRaw) };
    if (type === 19 && bits.length >= 312) decoded.vesselName = readText(bits, 143, 120);
    return decoded;
  }

  if (type === 5 && bits.length >= 424) return { ...base, vesselName: readText(bits, 112, 120) };
  if (type === 24 && bits.length >= 160 && readUnsigned(bits, 38, 2) === 0) return { ...base, vesselName: readText(bits, 40, 120) };
  return base;
}

function decodeAivdmLine(line: string, fragments: Map<string, FragmentBuffer>) {
  const parsed = parseAivdmSentence(line);
  if (!parsed) return null;

  const now = Date.now();
  for (const [key, fragment] of fragments) {
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
  fragments.set(key, existing);
  if (existing.parts.filter(Boolean).length !== existing.total) return null;
  fragments.delete(key);
  return decodePayload(existing.parts.join(""), existing.fillBits);
}

function formatSpeed(value?: number | null) {
  return value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(1)} kt`;
}

function formatCourse(value?: number | null) {
  return value == null || !Number.isFinite(value) ? "---" : `${value.toFixed(1)}°`;
}

function findLeafletMapFromContainer(container: any) {
  if (!container) return null;
  const events = container._leaflet_events;
  if (!events || typeof events !== "object") return null;

  for (const entry of Object.values(events) as any[]) {
    for (const candidate of [entry?.ctx, entry?.context, entry?._ctx, entry?.handler?.ctx]) {
      if (
        candidate &&
        typeof candidate.addLayer === "function" &&
        typeof candidate.removeLayer === "function" &&
        typeof candidate.latLngToLayerPoint === "function" &&
        typeof candidate.getContainer === "function" &&
        candidate.getContainer() === container
      ) return candidate;
    }
  }
  return null;
}

export function AisTargetMapBridge() {
  const leafletRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const svgRendererRef = useRef<any>(null);
  const targetsRef = useRef<Record<number, Target>>({});
  const fragmentsRef = useRef<Map<string, FragmentBuffer>>(new Map());

  function drawTargets() {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!svgRendererRef.current) {
      svgRendererRef.current = L.svg({ padding: 0.5 });
      svgRendererRef.current.addTo(map);
    }
    if (!targetLayerRef.current) targetLayerRef.current = L.layerGroup().addTo(map);

    const layer = targetLayerRef.current;
    layer.clearLayers();
    const now = Date.now();

    for (const target of Object.values(targetsRef.current)) {
      if (now - target.lastSeen >= TARGET_STALE_MS) continue;
      if (target.lat === undefined || target.lon === undefined) continue;

      const pos: [number, number] = [target.lat, target.lon];

      L.circleMarker(pos, {
        renderer: svgRendererRef.current,
        radius: 11,
        color: "#111827",
        opacity: 1,
        fillColor: "#111827",
        fillOpacity: 0.95,
        weight: 5,
      }).addTo(layer);

      L.circleMarker(pos, {
        renderer: svgRendererRef.current,
        radius: 7,
        color: "#fff200",
        opacity: 1,
        fillColor: "#fff200",
        fillOpacity: 1,
        weight: 3,
      })
        .bindTooltip(
          `${target.vesselName || `MMSI ${target.mmsi}`} · COG ${formatCourse(target.cog)} · SOG ${formatSpeed(target.sog)}`,
          { permanent: false, direction: "top", opacity: 1 },
        )
        .addTo(layer);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attachedMap: any = null;
    const redraw = () => window.requestAnimationFrame(drawTargets);

    import("leaflet").then((leafletModule) => {
      if (cancelled) return;
      leafletRef.current = leafletModule;

      const attach = () => {
        if (cancelled) return;
        const container = document.getElementById("v12-map") as any;
        const nextMap = findLeafletMapFromContainer(container);

        if (nextMap && nextMap !== mapRef.current) {
          if (attachedMap) {
            attachedMap.off?.("zoomend", redraw);
            attachedMap.off?.("moveend", redraw);
          }
          if (targetLayerRef.current && mapRef.current) {
            try { mapRef.current.removeLayer(targetLayerRef.current); } catch {}
          }
          if (svgRendererRef.current && mapRef.current) {
            try { mapRef.current.removeLayer(svgRendererRef.current); } catch {}
          }

          targetLayerRef.current = null;
          svgRendererRef.current = null;
          mapRef.current = nextMap;
          attachedMap = nextMap;
          nextMap.on?.("zoomend", redraw);
          nextMap.on?.("moveend", redraw);
          drawTargets();
        }

        timer = window.setTimeout(attach, nextMap ? 1000 : 150);
      };

      attach();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (attachedMap) {
        attachedMap.off?.("zoomend", redraw);
        attachedMap.off?.("moveend", redraw);
      }
      if (targetLayerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(targetLayerRef.current); } catch {}
      }
      if (svgRendererRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(svgRendererRef.current); } catch {}
      }
      targetLayerRef.current = null;
      svgRendererRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onmessage = (event) => {
      let raw: any = event.data;
      try { raw = JSON.parse(event.data); } catch {}

      const candidates: string[] = [];
      const line = extractNmeaLine(raw);
      if (line) candidates.push(...line.split(/\r?\n/));

      for (const sourceLine of candidates) {
        const trimmed = sourceLine.trim();
        if (!trimmed.startsWith("!AIVDM") && !trimmed.startsWith("$AIVDM")) continue;
        const decoded = decodeAivdmLine(trimmed, fragmentsRef.current);
        if (!decoded) continue;

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
      }

      drawTargets();
    };

    return () => ws.close();
  }, []);

  return null;
}
