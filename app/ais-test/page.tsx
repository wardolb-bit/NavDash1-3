"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type DecodedAis = {
  type: number;
  source: "AIVDO" | "AIVDM";
  mmsi: number;
  lat?: number;
  lon?: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  navStatus?: number;
  rateOfTurn?: number | null;
  positionAccuracy?: number;
  aisSecond?: number | null;
  maneuver?: number;
  raim?: number;
  imo?: number | null;
  vesselName?: string;
  callSign?: string;
  shipType?: number;
  dimensionToBow?: number;
  dimensionToStern?: number;
  dimensionToPort?: number;
  dimensionToStarboard?: number;
  fixType?: number;
  eta?: string;
  draught?: number | null;
  destination?: string;
  dte?: number;
  vendorId?: string;
  raw: string;
  receivedAt: string;
};

type Target = DecodedAis & {
  lastSeen: number;
  staticLastSeen?: number;
  voyageLastSeen?: number;
  messageCount: number;
  messageTypes: number[];
};

type RawLine = {
  id: string;
  line: string;
  receivedAt: string;
  decoded?: DecodedAis | null;
};

type FragmentBuffer = {
  total: number;
  parts: string[];
  fillBits: number;
  firstSeen: number;
  raw: string;
};

const RAW_LIMIT = 80;
const TARGET_STALE_MS = 10 * 60 * 1000;
const FRAGMENT_TTL_MS = 15 * 1000;
const FALLBACK_CENTER: [number, number] = [13.4443, 144.7937];

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

function normalizeRateOfTurn(value: number | null) {
  if (value === null || value === -128) return null;
  if (value === 0) return 0;

  const sign = value < 0 ? -1 : 1;
  return sign * (Math.abs(value) / 4.733) ** 2;
}

function normalizeEta(month: number | null, day: number | null, hour: number | null, minute: number | null) {
  if (
    month === null ||
    day === null ||
    hour === null ||
    minute === null ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return "";
  }

  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`;
}

function extractNmeaLine(message: any) {
  if (typeof message === "string") return message.trim();
  if (typeof message?.line === "string") return message.line.trim();
  if (typeof message?.sentence === "string") return message.sentence.trim();
  if (typeof message?.nmea === "string") return message.nmea.trim();
  return "";
}

function parseAisSentence(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!AIVDM") && !trimmed.startsWith("!AIVDO") && !trimmed.startsWith("$AIVDM") && !trimmed.startsWith("$AIVDO")) {
    return null;
  }

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
    source: trimmed.includes("AIVDO") ? "AIVDO" as const : "AIVDM" as const,
    total,
    fragment,
    sequence,
    channel,
    payload,
    fillBits: Number.isFinite(fillBits) ? fillBits : 0,
    raw: trimmed,
  };
}

function decodeAisPayload(payload: string, fillBits: number, source: "AIVDO" | "AIVDM", raw: string): DecodedAis | null {
  const bitsWithFill = aisPayloadToBits(payload);
  const bits = fillBits > 0 ? bitsWithFill.slice(0, -fillBits) : bitsWithFill;
  const type = readUnsigned(bits, 0, 6);
  const mmsi = readUnsigned(bits, 8, 30);

  if (type === null || mmsi === null) return null;

  const base = {
    type,
    source,
    mmsi,
    raw,
    receivedAt: new Date().toISOString(),
  };

  if ([1, 2, 3].includes(type)) {
    const navStatus = readUnsigned(bits, 38, 4);
    const rotRaw = readSigned(bits, 42, 8);
    const sogRaw = readUnsigned(bits, 50, 10);
    const positionAccuracy = readUnsigned(bits, 60, 1);
    const lonRaw = readSigned(bits, 61, 28);
    const latRaw = readSigned(bits, 89, 27);
    const cogRaw = readUnsigned(bits, 116, 12);
    const headingRaw = readUnsigned(bits, 128, 9);
    const aisSecond = readUnsigned(bits, 137, 6);
    const maneuver = readUnsigned(bits, 143, 2);
    const raim = readUnsigned(bits, 148, 1);

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
      navStatus: navStatus ?? undefined,
      rateOfTurn: normalizeRateOfTurn(rotRaw),
      positionAccuracy: positionAccuracy ?? undefined,
      aisSecond: aisSecond === null || aisSecond >= 60 ? null : aisSecond,
      maneuver: maneuver ?? undefined,
      raim: raim ?? undefined,
    };
  }

  if ([18, 19].includes(type)) {
    const sogRaw = readUnsigned(bits, 46, 10);
    const positionAccuracy = readUnsigned(bits, 56, 1);
    const lonRaw = readSigned(bits, 57, 28);
    const latRaw = readSigned(bits, 85, 27);
    const cogRaw = readUnsigned(bits, 112, 12);
    const headingRaw = readUnsigned(bits, 124, 9);
    const aisSecond = readUnsigned(bits, 133, 6);
    const raim = readUnsigned(bits, 147, 1);

    if (latRaw === null || lonRaw === null) return base;

    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return base;

    const classB: DecodedAis = {
      ...base,
      lat,
      lon,
      sog: normalizeSpeed(sogRaw),
      cog: normalizeCourse(cogRaw),
      heading: normalizeHeading(headingRaw),
      positionAccuracy: positionAccuracy ?? undefined,
      aisSecond: aisSecond === null || aisSecond >= 60 ? null : aisSecond,
      raim: raim ?? undefined,
    };

    if (type === 19 && bits.length >= 312) {
      classB.vesselName = readText(bits, 143, 120);
      classB.shipType = readUnsigned(bits, 263, 8) ?? undefined;
    }

    return classB;
  }

  if (type === 5 && bits.length >= 424) {
    const month = readUnsigned(bits, 274, 4);
    const day = readUnsigned(bits, 278, 5);
    const hour = readUnsigned(bits, 283, 5);
    const minute = readUnsigned(bits, 288, 6);
    const draughtRaw = readUnsigned(bits, 294, 8);

    return {
      ...base,
      imo: readUnsigned(bits, 40, 30),
      callSign: readText(bits, 70, 42),
      vesselName: readText(bits, 112, 120),
      shipType: readUnsigned(bits, 232, 8) ?? undefined,
      dimensionToBow: readUnsigned(bits, 240, 9) ?? undefined,
      dimensionToStern: readUnsigned(bits, 249, 9) ?? undefined,
      dimensionToPort: readUnsigned(bits, 258, 6) ?? undefined,
      dimensionToStarboard: readUnsigned(bits, 264, 6) ?? undefined,
      fixType: readUnsigned(bits, 270, 4) ?? undefined,
      eta: normalizeEta(month, day, hour, minute),
      draught: draughtRaw === null || draughtRaw === 0 ? null : draughtRaw / 10,
      destination: readText(bits, 302, 120),
      dte: readUnsigned(bits, 422, 1) ?? undefined,
    };
  }

  if (type === 24 && bits.length >= 160) {
    const partNumber = readUnsigned(bits, 38, 2);

    if (partNumber === 0) {
      return {
        ...base,
        vesselName: readText(bits, 40, 120),
      };
    }

    if (partNumber === 1) {
      return {
        ...base,
        shipType: readUnsigned(bits, 40, 8) ?? undefined,
        vendorId: readText(bits, 48, 42),
        callSign: readText(bits, 90, 42),
        dimensionToBow: readUnsigned(bits, 132, 9) ?? undefined,
        dimensionToStern: readUnsigned(bits, 141, 9) ?? undefined,
        dimensionToPort: readUnsigned(bits, 150, 6) ?? undefined,
        dimensionToStarboard: readUnsigned(bits, 156, 6) ?? undefined,
      };
    }
  }

  return base;
}

function decodeAisLine(line: string, fragmentsRef: React.MutableRefObject<Map<string, FragmentBuffer>>) {
  const parsed = parseAisSentence(line);
  if (!parsed) return null;

  const now = Date.now();
  for (const [key, fragment] of Array.from(fragmentsRef.current.entries())) {
    if (now - fragment.firstSeen > FRAGMENT_TTL_MS) fragmentsRef.current.delete(key);
  }

  if (parsed.total <= 1) {
    return decodeAisPayload(parsed.payload, parsed.fillBits, parsed.source, parsed.raw);
  }

  const key = `${parsed.source}-${parsed.sequence || "no-seq"}-${parsed.channel}`;
  const existing = fragmentsRef.current.get(key) || {
    total: parsed.total,
    parts: [],
    fillBits: parsed.fillBits,
    firstSeen: now,
    raw: parsed.raw,
  };

  existing.parts[parsed.fragment - 1] = parsed.payload;
  existing.fillBits = parsed.fillBits;
  existing.raw = `${existing.raw}\n${parsed.raw}`;
  fragmentsRef.current.set(key, existing);

  if (existing.parts.filter(Boolean).length !== existing.total) return null;

  fragmentsRef.current.delete(key);
  return decodeAisPayload(existing.parts.join(""), existing.fillBits, parsed.source, existing.raw);
}

function formatLatLon(value?: number, isLat = true) {
  if (value === undefined || !Number.isFinite(value)) return "--";

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const width = isLat ? 2 : 3;

  return `${String(deg).padStart(width, "0")} ${min.toFixed(3)}' ${hemi}`;
}

function formatNumber(value?: number | null, suffix = "") {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}${suffix}`;
}

function formatPlain(value: unknown) {
  if (value === undefined || value === null || value === "") return "--";
  if (typeof value === "number" && !Number.isFinite(value)) return "--";
  return String(value);
}

function staticDataStatus(target?: Target | null) {
  if (!target) return "--";
  if (target.voyageLastSeen) return `Voyage/static received ${ageText(target.voyageLastSeen)} ago`;
  if (target.staticLastSeen) return `Static received ${ageText(target.staticLastSeen)} ago`;
  if (target.source === "AIVDO") return "Own ship position only so far";
  return "Waiting for AIS static message 5 or 24";
}

function voyageFieldValue(target: Target | null, field: "destination" | "eta" | "draught") {
  if (!target) return "--";
  const value = target[field];
  if (value !== undefined && value !== null && value !== "") {
    return field === "draught" && typeof value === "number" ? `${value.toFixed(1)} m` : String(value);
  }

  if (target.messageTypes.includes(5)) return "Not sent / blank in type 5";
  if (target.messageTypes.some((type) => [18, 19, 24].includes(type))) {
    return "Class B static AIS does not send this field";
  }
  return "Waiting for type 5 voyage data";
}

function ageText(lastSeen?: number) {
  if (!lastSeen) return "--";
  const seconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function navStatusLabel(value?: number) {
  const labels: Record<number, string> = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted maneuverability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Fishing",
    8: "Under way sailing",
    11: "Power-driven vessel towing astern",
    12: "Power-driven vessel pushing/towing alongside",
    14: "AIS-SART / MOB / EPIRB",
    15: "Undefined",
  };

  if (value === undefined) return "--";
  return labels[value] || `Status ${value}`;
}

function shipTypeLabel(value?: number) {
  if (value === undefined) return "--";
  if (value >= 20 && value <= 29) return `Wing in ground / special craft (${value})`;
  if (value >= 30 && value <= 39) return `Fishing/towing/special vessel (${value})`;
  if (value >= 40 && value <= 49) return `High speed craft (${value})`;
  if (value >= 50 && value <= 59) return `Special craft (${value})`;
  if (value >= 60 && value <= 69) return `Passenger vessel (${value})`;
  if (value >= 70 && value <= 79) return `Cargo vessel (${value})`;
  if (value >= 80 && value <= 89) return `Tanker (${value})`;
  if (value >= 90 && value <= 99) return `Other type (${value})`;
  return `Type ${value}`;
}

function formatDimensions(target?: Target | null) {
  if (!target) return "--";
  const length =
    typeof target.dimensionToBow === "number" && typeof target.dimensionToStern === "number"
      ? target.dimensionToBow + target.dimensionToStern
      : null;
  const beam =
    typeof target.dimensionToPort === "number" && typeof target.dimensionToStarboard === "number"
      ? target.dimensionToPort + target.dimensionToStarboard
      : null;

  if (length === null && beam === null) return "--";
  return `${length ?? "--"} m x ${beam ?? "--"} m`;
}

export default function AisTestPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const [status, setStatus] = useState("Connecting to AIS WebSocket...");
  const [rawLines, setRawLines] = useState<RawLine[]>([]);
  const [targets, setTargets] = useState<Record<number, Target>>({});
  const [followOwnShip, setFollowOwnShip] = useState(true);
  const [showRaw, setShowRaw] = useState(true);
  const [messageCount, setMessageCount] = useState(0);
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const mapRef = useRef<any>(null);
  const ownMarkerRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const fragmentsRef = useRef<Map<string, FragmentBuffer>>(new Map());
  const programmaticPanRef = useRef(false);

  const ownShip = useMemo(
    () =>
      Object.values(targets)
        .filter((target) => target.source === "AIVDO" && target.lat !== undefined && target.lon !== undefined)
        .sort((a, b) => b.lastSeen - a.lastSeen)[0] || null,
    [targets],
  );

  const targetList = useMemo(
    () =>
      Object.values(targets)
        .filter((target) => Date.now() - target.lastSeen < TARGET_STALE_MS)
        .sort((a, b) => b.lastSeen - a.lastSeen),
    [targets, messageCount],
  );

  const selectedTarget = selectedMmsi ? targets[selectedMmsi] || null : null;

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initMap() {
      if (mapRef.current || cancelled) return;
      const L = await import("leaflet");

      if (!document.querySelector('link[data-navdash-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-navdash-leaflet", "true");
        document.head.appendChild(link);
      }

      const map = L.map("ais-test-map", {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      }).setView(FALLBACK_CENTER, 9);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      targetLayerRef.current = L.layerGroup().addTo(map);
      map.on("dragstart zoomstart", () => {
        if (!programmaticPanRef.current) setFollowOwnShip(false);
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 250);
      const mapElement = document.getElementById("ais-test-map");
      if (mapElement) {
        resizeObserver = new ResizeObserver(() => map.invalidateSize());
        resizeObserver.observe(mapElement);
      }
    }

    initMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        ownMarkerRef.current = null;
        targetLayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    async function updateMarkers() {
      const map = mapRef.current;
      const layer = targetLayerRef.current;
      if (!map || !layer) return;

      const L = await import("leaflet");
      layer.clearLayers();

      for (const target of targetList) {
        if (target.source === "AIVDO" || target.lat === undefined || target.lon === undefined) continue;

        L.circleMarker([target.lat, target.lon], {
          radius: 6,
          color: "#facc15",
          fillColor: "#facc15",
          fillOpacity: 0.75,
          weight: 2,
        })
          .bindTooltip(`${target.vesselName || target.mmsi} ${formatNumber(target.sog, " kt")}`, { permanent: false })
          .addTo(layer);
      }

      if (ownShip?.lat !== undefined && ownShip.lon !== undefined) {
        const position: [number, number] = [ownShip.lat, ownShip.lon];

        if (!ownMarkerRef.current) {
          ownMarkerRef.current = L.circleMarker(position, {
            radius: 10,
            color: "#22d3ee",
            fillColor: "#22d3ee",
            fillOpacity: 0.85,
            weight: 3,
          })
            .bindTooltip("Own Ship", { permanent: false })
            .addTo(map);
        } else {
          ownMarkerRef.current.setLatLng(position);
        }

        if (followOwnShip) {
          programmaticPanRef.current = true;
          map.panTo(position, { animate: true, duration: 0.35 });
          window.setTimeout(() => {
            programmaticPanRef.current = false;
          }, 500);
        }
      }
    }

    updateMarkers();
  }, [followOwnShip, ownShip, targetList]);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onopen = () => setStatus("AIS WebSocket connected");
    ws.onerror = () => setStatus("AIS WebSocket error");
    ws.onclose = () => setStatus("AIS WebSocket closed");
    ws.onmessage = (event) => {
      let parsedMessage: any = event.data;
      try {
        parsedMessage = JSON.parse(event.data);
      } catch {
        // Plain NMEA is acceptable here.
      }

      const line = extractNmeaLine(parsedMessage);
      if (!line) return;

      const decoded = decodeAisLine(line, fragmentsRef);
      const receivedAt = new Date().toISOString();

      setMessageCount((count) => count + 1);
      setRawLines((lines) => [
        {
          id: `${receivedAt}-${Math.random().toString(36).slice(2)}`,
          line,
          receivedAt,
          decoded,
        },
        ...lines,
      ].slice(0, RAW_LIMIT));

      if (!decoded) {
        if (line.includes("AIVDM") || line.includes("AIVDO")) setStatus("AIS feed active, waiting for decodable position");
        return;
      }

      setTargets((current) => {
        const prior = current[decoded.mmsi];
        const now = Date.now();
        const hasStatic =
          !!decoded.vesselName ||
          !!decoded.callSign ||
          decoded.shipType !== undefined ||
          decoded.dimensionToBow !== undefined ||
          decoded.vendorId !== undefined;
        const hasVoyage =
          decoded.type === 5 ||
          !!decoded.destination ||
          !!decoded.eta ||
          decoded.draught !== undefined ||
          decoded.imo !== undefined;
        const next: Target = {
          ...prior,
          ...decoded,
          vesselName: decoded.vesselName || prior?.vesselName,
          callSign: decoded.callSign || prior?.callSign,
          lat: decoded.lat ?? prior?.lat,
          lon: decoded.lon ?? prior?.lon,
          sog: decoded.sog ?? prior?.sog,
          cog: decoded.cog ?? prior?.cog,
          heading: decoded.heading ?? prior?.heading,
          raw: decoded.raw,
          receivedAt: decoded.receivedAt,
          lastSeen: now,
          staticLastSeen: hasStatic ? now : prior?.staticLastSeen,
          voyageLastSeen: hasVoyage ? now : prior?.voyageLastSeen,
          messageCount: (prior?.messageCount || 0) + 1,
          messageTypes: Array.from(new Set([...(prior?.messageTypes || []), decoded.type])).sort((a, b) => a - b),
        };

        return { ...current, [decoded.mmsi]: next };
      });

      setStatus(decoded.source === "AIVDO" ? "Own ship AIS decoded" : "AIS target decoded");
    };

    return () => ws.close();
  }, []);

  const theme = nightMode
    ? {
        page: "min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(242,184,75,.24),transparent_30%),linear-gradient(135deg,#06111f,#101c2b_48%,#06111f)] p-4 text-slate-100 md:p-6",
        panel: "rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-xl shadow-black/25 backdrop-blur-xl",
        card: "rounded-2xl border border-white/10 bg-black/25 p-4",
        button: "rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-slate-100 hover:bg-white/15",
        label: "text-xs font-bold uppercase tracking-[.18em] text-slate-400",
        muted: "text-slate-400",
        value: "text-white",
      }
    : {
        page: "min-h-screen bg-white p-4 text-slate-950 md:p-6",
        panel: "rounded-2xl border border-slate-300 bg-white p-4 shadow-sm",
        card: "rounded-2xl border border-slate-300 bg-slate-50 p-4",
        button: "rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-black text-slate-900 hover:bg-white",
        label: "text-xs font-bold uppercase tracking-[.18em] text-slate-500",
        muted: "text-slate-500",
        value: "text-slate-950",
      };

  return (
    <main className={theme.page}>
      <div className="mx-auto max-w-none">
        <header className={`${theme.panel} mb-4`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.42em] text-[#f2b84b]">NavDash 1.3 AIS</div>
              <h1 className={`text-3xl font-black tracking-tight ${theme.value}`}>AIS Targets</h1>
              <div className={`mt-1 text-sm ${theme.muted}`}>Live NMEA/AIS decoder for the host WebSocket feed.</div>
              <div className={`mt-1 text-xs ${theme.muted}`}>
                Position reports arrive often. Vessel names, destination, ETA, draught, and dimensions only fill after slower static/voyage AIS messages arrive.
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-4 xl:min-w-[760px]">
              <div className={theme.card}>
                <div className={theme.label}>WebSocket</div>
                <div className="mt-1 font-mono text-sm font-black">{status}</div>
              </div>
              <div className={theme.card}>
                <div className={theme.label}>Messages</div>
                <div className="mt-1 font-mono text-xl font-black">{messageCount}</div>
              </div>
              <div className={theme.card}>
                <div className={theme.label}>Targets</div>
                <div className="mt-1 font-mono text-xl font-black">{targetList.filter((t) => t.source === "AIVDM").length}</div>
              </div>
              <div className={theme.card}>
                <div className={theme.label}>Own Ship</div>
                <div className="mt-1 font-mono text-sm font-black">{ownShip ? "DECODED" : "WAITING"}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className={theme.button} onClick={() => setFollowOwnShip((value) => !value)}>
                {followOwnShip ? "Follow On" : "Follow Off"}
              </button>
              <button type="button" className={theme.button} onClick={() => setShowRaw((value) => !value)}>
                {showRaw ? "Raw On" : "Raw Off"}
              </button>
              <button type="button" className={theme.button} onClick={toggleTheme}>
                {nightMode ? "Day Mode" : "Bridge Night"}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
          <div className={theme.panel}>
            <div id="ais-test-map" className="h-[560px] min-h-[54vh] overflow-hidden rounded-xl border border-white/10 bg-slate-900" />
          </div>

          <div className="grid gap-4">
            <div className={theme.panel}>
              <div className={theme.label}>Own Ship</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Metric label="MMSI" value={ownShip?.mmsi ? String(ownShip.mmsi) : "--"} theme={theme} />
                <Metric label="Position" value={`${formatLatLon(ownShip?.lat, true)} / ${formatLatLon(ownShip?.lon, false)}`} theme={theme} />
                <Metric label="SOG" value={formatNumber(ownShip?.sog, " kt")} theme={theme} />
                <Metric label="COG" value={formatNumber(ownShip?.cog, " deg")} theme={theme} />
                <Metric label="Heading" value={formatNumber(ownShip?.heading, " deg")} theme={theme} />
                <Metric label="Age" value={ageText(ownShip?.lastSeen)} theme={theme} />
              </div>
            </div>

            <div className={theme.panel}>
              <div className={theme.label}>Decoded Targets</div>
              <div className="mt-3 max-h-[370px] overflow-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className={nightMode ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-600"}>
                    <tr>
                      <th className="px-3 py-2">MMSI / Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Position</th>
                      <th className="px-3 py-2">SOG</th>
                      <th className="px-3 py-2">COG</th>
                      <th className="px-3 py-2">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetList.map((target) => (
                      <tr key={target.mmsi} className="border-t border-white/10">
                        <td className="px-3 py-2 font-mono">
                          <button
                            type="button"
                            onClick={() => setSelectedMmsi(target.mmsi)}
                            className="text-left hover:text-[#f2b84b]"
                          >
                            <div className="font-black">{target.vesselName || target.mmsi}</div>
                            <div className={theme.muted}>
                              {target.vesselName
                                ? target.callSign || target.mmsi
                                : staticDataStatus(target)}
                            </div>
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono">{target.source} / {target.type}</td>
                        <td className="px-3 py-2 font-mono">{formatLatLon(target.lat, true)} / {formatLatLon(target.lon, false)}</td>
                        <td className="px-3 py-2 font-mono">{formatNumber(target.sog, " kt")}</td>
                        <td className="px-3 py-2 font-mono">{formatNumber(target.cog, " deg")}</td>
                        <td className="px-3 py-2 font-mono">{ageText(target.lastSeen)}</td>
                      </tr>
                    ))}
                    {!targetList.length && (
                      <tr>
                        <td className={`px-3 py-8 text-center ${theme.muted}`} colSpan={6}>Waiting for AIS messages.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={theme.panel}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={theme.label}>Selected AIS Details</div>
                  <div className="mt-1 font-mono text-lg font-black">
                    {selectedTarget ? selectedTarget.vesselName || selectedTarget.mmsi : "Click a target name"}
                  </div>
                </div>
                {selectedTarget && (
                  <button type="button" className={theme.button} onClick={() => setSelectedMmsi(null)}>
                    Close
                  </button>
                )}
              </div>

              {selectedTarget ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Metric label="MMSI" value={String(selectedTarget.mmsi)} theme={theme} />
                  <Metric label="Static / Voyage Status" value={staticDataStatus(selectedTarget)} theme={theme} />
                  <Metric label="Vessel Name" value={formatPlain(selectedTarget.vesselName)} theme={theme} />
                  <Metric label="Call Sign" value={formatPlain(selectedTarget.callSign)} theme={theme} />
                  <Metric label="IMO" value={formatPlain(selectedTarget.imo)} theme={theme} />
                  <Metric label="AIS Message Types" value={selectedTarget.messageTypes.join(", ")} theme={theme} />
                  <Metric label="Ship Type" value={shipTypeLabel(selectedTarget.shipType)} theme={theme} />
                  <Metric label="Nav Status" value={navStatusLabel(selectedTarget.navStatus)} theme={theme} />
                  <Metric label="Position" value={`${formatLatLon(selectedTarget.lat, true)} / ${formatLatLon(selectedTarget.lon, false)}`} theme={theme} />
                  <Metric label="SOG" value={formatNumber(selectedTarget.sog, " kt")} theme={theme} />
                  <Metric label="COG" value={formatNumber(selectedTarget.cog, " deg")} theme={theme} />
                  <Metric label="Heading" value={formatNumber(selectedTarget.heading, " deg")} theme={theme} />
                  <Metric label="Rate Of Turn" value={formatNumber(selectedTarget.rateOfTurn, " deg/min")} theme={theme} />
                  <Metric label="Destination" value={voyageFieldValue(selectedTarget, "destination")} theme={theme} />
                  <Metric label="ETA" value={voyageFieldValue(selectedTarget, "eta")} theme={theme} />
                  <Metric label="Draught" value={voyageFieldValue(selectedTarget, "draught")} theme={theme} />
                  <Metric label="Dimensions" value={formatDimensions(selectedTarget)} theme={theme} />
                  <Metric label="Fix Type" value={formatPlain(selectedTarget.fixType)} theme={theme} />
                  <Metric label="Position Accuracy" value={selectedTarget.positionAccuracy === undefined ? "--" : selectedTarget.positionAccuracy ? "High" : "Low"} theme={theme} />
                  <Metric label="RAIM" value={selectedTarget.raim === undefined ? "--" : selectedTarget.raim ? "In use" : "Not in use"} theme={theme} />
                  <Metric label="AIS Timestamp" value={selectedTarget.aisSecond === undefined || selectedTarget.aisSecond === null ? "--" : `${selectedTarget.aisSecond}s`} theme={theme} />
                  <Metric label="Vendor ID" value={formatPlain(selectedTarget.vendorId)} theme={theme} />
                  <Metric label="Last Seen" value={ageText(selectedTarget.lastSeen)} theme={theme} />
                </div>
              ) : (
                <div className={`mt-3 rounded-xl border border-white/10 p-4 text-sm ${theme.muted}`}>
                  Basic target rows stay compact. Click a vessel name or MMSI to inspect static and voyage fields as they arrive.
                </div>
              )}
            </div>
          </div>
        </section>

        {showRaw && (
          <section className={`${theme.panel} mt-4`}>
            <div className={theme.label}>Raw AIS / NMEA Feed</div>
            <div className="mt-3 max-h-[320px] overflow-auto rounded-xl border border-white/10 font-mono text-xs">
              {rawLines.map((entry) => (
                <div key={entry.id} className="border-b border-white/10 px-3 py-2">
                  <div className={theme.muted}>{entry.receivedAt} {entry.decoded ? `type ${entry.decoded.type} MMSI ${entry.decoded.mmsi}` : "not decoded"}</div>
                  <div className="break-all">{entry.line}</div>
                </div>
              ))}
              {!rawLines.length && <div className={`px-3 py-8 text-center ${theme.muted}`}>Waiting for WebSocket feed.</div>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, theme }: { label: string; value: string; theme: { card: string; label: string } }) {
  return (
    <div className={theme.card}>
      <div className={theme.label}>{label}</div>
      <div className="mt-1 break-words font-mono text-lg font-black">{value}</div>
    </div>
  );
}
