"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

type RouteState = {
  routeName: string;
  waypoints: Waypoint[];
  activeWaypointIndex: number;
};

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type AisTarget = {
  mmsi: number;
  source: "AIVDO" | "AIVDM";
  type: number;
  lat?: number;
  lon?: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  vesselName?: string;
  lastSeen: number;
};

type FragmentBuffer = {
  total: number;
  parts: string[];
  fillBits: number;
  firstSeen: number;
};

const TARGET_STALE_MS = 10 * 60 * 1000;
const FRAGMENT_TTL_MS = 15 * 1000;

function wsUrl() {
  return getAisWebSocketUrl();
}

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

function normalizeSpeed(value: number | null) {
  if (value === null || value === 1023) return null;
  return value / 10;
}

function normalizeCourse(value: number | null) {
  if (value === null || value === 3600) return null;
  return value / 10;
}

function normalizeHeading(value: number | null) {
  if (value === null || value === 511) return null;
  return value;
}

function parseAisSentence(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!AIVDM") && !trimmed.startsWith("!AIVDO") && !trimmed.startsWith("$AIVDM") && !trimmed.startsWith("$AIVDO")) return null;

  const parts = trimmed.split("*")[0].split(",");
  if (parts.length < 7) return null;

  const total = Number(parts[1]);
  const fragment = Number(parts[2]);
  const payload = parts[5] || "";
  const fillBits = Number(parts[6] || 0);
  if (!Number.isFinite(total) || !Number.isFinite(fragment) || !payload) return null;

  return {
    source: trimmed.includes("AIVDO") ? "AIVDO" as const : "AIVDM" as const,
    total,
    fragment,
    sequence: parts[3] || "",
    channel: parts[4] || "",
    payload,
    fillBits: Number.isFinite(fillBits) ? fillBits : 0,
  };
}

function decodePayload(payload: string, fillBits: number, source: "AIVDO" | "AIVDM"): Partial<AisTarget> | null {
  const rawBits = aisPayloadToBits(payload);
  const bits = fillBits > 0 ? rawBits.slice(0, -fillBits) : rawBits;
  const type = readUnsigned(bits, 0, 6);
  const mmsi = readUnsigned(bits, 8, 30);
  if (type === null || mmsi === null) return null;

  const base = { type, source, mmsi };

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

    return {
      ...base,
      lat,
      lon,
      sog: normalizeSpeed(sogRaw),
      cog: normalizeCourse(cogRaw),
      heading: normalizeHeading(headingRaw),
      vesselName: type === 19 ? readText(bits, 143, 120) : undefined,
    };
  }

  if (type === 5 && bits.length >= 424) {
    return {
      ...base,
      vesselName: readText(bits, 112, 120),
    };
  }

  if (type === 24 && bits.length >= 160) {
    const partNumber = readUnsigned(bits, 38, 2);
    if (partNumber === 0) return { ...base, vesselName: readText(bits, 40, 120) };
  }

  return base;
}

function decodeAisLine(line: string, fragments: React.MutableRefObject<Map<string, FragmentBuffer>>) {
  const parsed = parseAisSentence(line);
  if (!parsed) return null;

  const now = Date.now();
  for (const [key, fragment] of Array.from(fragments.current.entries())) {
    if (now - fragment.firstSeen > FRAGMENT_TTL_MS) fragments.current.delete(key);
  }

  if (parsed.total <= 1) return decodePayload(parsed.payload, parsed.fillBits, parsed.source);

  const key = `${parsed.source}-${parsed.sequence || "no-seq"}-${parsed.channel}`;
  const existing = fragments.current.get(key) || {
    total: parsed.total,
    parts: [],
    fillBits: parsed.fillBits,
    firstSeen: now,
  };

  existing.parts[parsed.fragment - 1] = parsed.payload;
  existing.fillBits = parsed.fillBits;
  fragments.current.set(key, existing);

  if (existing.parts.filter(Boolean).length !== existing.total) return null;
  fragments.current.delete(key);
  return decodePayload(existing.parts.join(""), existing.fillBits, parsed.source);
}

function extractNmeaLine(message: any) {
  if (typeof message === "string") return message.trim();
  if (typeof message?.line === "string") return message.line.trim();
  if (typeof message?.sentence === "string") return message.sentence.trim();
  if (typeof message?.nmea === "string") return message.nmea.trim();
  return "";
}

function formatNumber(value?: number | null, suffix = "") {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}${suffix}`;
}

function formatLatLon(value?: number, isLat = true) {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${String(deg).padStart(isLat ? 2 : 3, "0")} ${min.toFixed(3)}' ${hemi}`;
}

function ageText(lastSeen?: number) {
  if (!lastSeen) return "--";
  const seconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusNm = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routePointToXY(lat: number, lon: number, refLat: number, refLon: number) {
  const x = (lon - refLon) * 60 * Math.cos(toRadians(refLat));
  const y = (lat - refLat) * 60;
  return { x, y };
}

function distancePointToSegmentNm(
  shipLat: number,
  shipLon: number,
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
) {
  const refLat = (shipLat + startLat + endLat) / 3;
  const refLon = (shipLon + startLon + endLon) / 3;
  const ship = routePointToXY(shipLat, shipLon, refLat, refLon);
  const start = routePointToXY(startLat, startLon, refLat, refLon);
  const end = routePointToXY(endLat, endLon, refLat, refLon);

  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = ship.x - start.x;
  const wy = ship.y - start.y;
  const legLengthSquared = vx * vx + vy * vy;

  if (legLengthSquared <= 0) {
    return {
      distance: distanceNm(shipLat, shipLon, startLat, startLon),
      projectionRatio: 0,
    };
  }

  const rawRatio = (wx * vx + wy * vy) / legLengthSquared;
  const projectionRatio = Math.max(0, Math.min(1, rawRatio));
  const closestX = start.x + projectionRatio * vx;
  const closestY = start.y + projectionRatio * vy;
  const dx = ship.x - closestX;
  const dy = ship.y - closestY;

  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    projectionRatio,
  };
}

function liveRouteLeg(route: RouteState | null, ownShip: AisTarget | null) {
  if (!route || !ownShip?.lat || !ownShip?.lon || route.waypoints.length < 2) return null;

  const savedIndex = Math.max(1, Math.min(route.activeWaypointIndex, route.waypoints.length - 1));
  let best: { index: number; start: Waypoint; end: Waypoint; score: number } | null = null;

  for (let index = 1; index < route.waypoints.length; index += 1) {
    const start = route.waypoints[index - 1];
    const end = route.waypoints[index];
    const result = distancePointToSegmentNm(ownShip.lat, ownShip.lon, start.lat, start.lon, end.lat, end.lon);
    const jumpPenalty = Math.abs(index - savedIndex) * 0.35;
    const endPenalty = result.projectionRatio <= 0 || result.projectionRatio >= 1 ? 0.25 : 0;
    const score = result.distance + jumpPenalty + endPenalty;

    if (!best || score < best.score) best = { index, start, end, score };
  }

  return best;
}

function normalizeRoute(data: any): RouteState | null {
  const waypoints = Array.isArray(data?.waypoints) ? data.waypoints : [];
  if (waypoints.length < 2) return null;
  return {
    routeName: String(data.routeName || "Shared Route"),
    waypoints,
    activeWaypointIndex: Number.isFinite(Number(data.activeWaypointIndex)) ? Number(data.activeWaypointIndex) : 1,
  };
}

export default function PhonePage() {
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routeStatus, setRouteStatus] = useState("No route loaded");
  const [connection, setConnection] = useState("Connecting");
  const [targets, setTargets] = useState<Record<number, AisTarget>>({});
  const [messageCount, setMessageCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"status" | "ais">("status");
  const fragments = useRef<Map<string, FragmentBuffer>>(new Map());

  const targetList = useMemo(
    () =>
      Object.values(targets)
        .filter((target) => Date.now() - target.lastSeen < TARGET_STALE_MS)
        .sort((a, b) => b.lastSeen - a.lastSeen),
    [targets, messageCount],
  );

  const ownShip = useMemo(
    () => targetList.filter((target) => target.source === "AIVDO" && target.lat !== undefined && target.lon !== undefined)[0] || null,
    [targetList],
  );

  const activeLeg = useMemo(() => {
    if (!route || route.waypoints.length < 2) return "--";
    const leg = liveRouteLeg(route, ownShip);
    const endIndex = leg?.index ?? Math.max(1, Math.min(route.activeWaypointIndex, route.waypoints.length - 1));
    return `${route.waypoints[endIndex - 1].id} to ${route.waypoints[endIndex].id}`;
  }, [route, ownShip]);

  useEffect(() => {
    fetch("/api/route-state", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const normalized = normalizeRoute(data);
        setRoute(normalized);
        setRouteStatus(normalized ? normalized.routeName : "No route loaded");
      })
      .catch(() => setRouteStatus("Route unavailable"));

    let closed = false;
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => setConnection("Connected");
    ws.onerror = () => setConnection("AIS error");
    ws.onclose = () => {
      if (!closed) setConnection("Disconnected");
    };
    ws.onmessage = (event) => {
      let parsed: any = event.data;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        // Plain NMEA is expected.
      }

      if (parsed?.type === "route-state") {
        const normalized = normalizeRoute(parsed);
        setRoute(normalized);
        setRouteStatus(normalized ? normalized.routeName : "No route loaded");
        return;
      }

      const line = extractNmeaLine(parsed);
      if (!line) return;
      const decoded = decodeAisLine(line, fragments);
      setMessageCount((count) => count + 1);
      if (!decoded?.mmsi) return;

      setTargets((current) => {
        const prior = current[decoded.mmsi!];
        return {
          ...current,
          [decoded.mmsi!]: {
            ...prior,
            ...decoded,
            vesselName: decoded.vesselName || prior?.vesselName,
            lat: decoded.lat ?? prior?.lat,
            lon: decoded.lon ?? prior?.lon,
            sog: decoded.sog ?? prior?.sog,
            cog: decoded.cog ?? prior?.cog,
            heading: decoded.heading ?? prior?.heading,
            lastSeen: Date.now(),
          } as AisTarget,
        };
      });
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#06111f] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col px-4 pb-24 pt-[max(16px,env(safe-area-inset-top))]">
        <header className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.32em] text-[#f2b84b]">NavDash 1.3</div>
              <h1 className="mt-1 text-2xl font-black leading-tight text-white">Watch Pocket View</h1>
            </div>
            <Link href="/" className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-slate-100">
              Console
            </Link>
          </div>
        </header>

        <section className="mb-3 grid grid-cols-2 gap-2">
          <PhoneStat label="AIS" value={connection} />
          <PhoneStat label="Route" value={route ? "Loaded" : "None"} />
        </section>

        <nav className="sticky top-0 z-10 mb-3 grid grid-cols-2 gap-2 bg-[#06111f]/95 py-2 backdrop-blur">
          {[
            ["status", "Status"],
            ["ais", "AIS"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as "status" | "ais")}
              className={activeTab === key ? "rounded-xl bg-[#f2b84b] px-3 py-3 text-sm font-black text-[#111827]" : "rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-black text-slate-100"}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "status" && (
          <section className="grid gap-3">
            <PhoneCard title="Own Ship">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Position" value={`${formatLatLon(ownShip?.lat, true)} / ${formatLatLon(ownShip?.lon, false)}`} wide />
                <Metric label="SOG" value={formatNumber(ownShip?.sog, " kt")} />
                <Metric label="COG" value={formatNumber(ownShip?.cog, " deg")} />
                <Metric label="Heading" value={formatNumber(ownShip?.heading, " deg")} />
                <Metric label="Age" value={ageText(ownShip?.lastSeen)} />
              </div>
            </PhoneCard>

            <PhoneCard title="Route">
              <div className="grid gap-3">
                <Metric label="Route" value={routeStatus} wide />
                <Metric label="Active Leg" value={activeLeg} wide />
              </div>
            </PhoneCard>
          </section>
        )}

        {activeTab === "ais" && (
          <section className="grid gap-3">
            <PhoneCard title="AIS Targets">
              <div className="grid gap-2">
                {targetList.filter((target) => target.source === "AIVDM").slice(0, 30).map((target) => (
                  <article key={target.mmsi} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-white">{target.vesselName || target.mmsi}</div>
                        <div className="mt-1 text-xs font-bold text-slate-400">MMSI {target.mmsi}</div>
                      </div>
                      <div className="text-right font-mono text-xs text-slate-300">{ageText(target.lastSeen)}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Metric label="SOG" value={formatNumber(target.sog, " kt")} />
                      <Metric label="COG" value={formatNumber(target.cog, " deg")} />
                      <Metric label="HDG" value={formatNumber(target.heading, " deg")} />
                    </div>
                  </article>
                ))}
                {!targetList.filter((target) => target.source === "AIVDM").length && <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-sm text-slate-400">Waiting for AIS targets.</div>}
              </div>
            </PhoneCard>
          </section>
        )}
      </div>
    </main>
  );
}

function PhoneStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
    </div>
  );
}

function PhoneCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-black/25">
      <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">{title}</div>
      {children}
    </section>
  );
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 rounded-xl border border-white/10 bg-black/20 p-3" : "rounded-xl border border-white/10 bg-black/20 p-3"}>
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 break-words font-mono text-sm font-black text-slate-100">{value}</div>
    </div>
  );
}
