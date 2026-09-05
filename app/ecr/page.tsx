"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type OwnShip = {
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number | null;
  lastUpdate?: number | null;
};


type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

const FULLSCREEN_PREF_KEY = "navconsole-fullscreen";
const ROUTE_STORAGE_KEY = "navconsole-saved-route";


function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function getUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function getSigned(bits: string, start: number, length: number) {
  const value = getUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}

function decodeAisPosition(sentence: string): OwnShip | null {
  try {
    const parts = sentence.split(",");
    if (parts.length < 6) return null;

    const payload = parts[5];
    if (!payload) return null;

    const bits = payloadToBits(payload);
    const messageType = getUnsigned(bits, 0, 6);

    if (![1, 2, 3].includes(messageType)) return null;

    const sog = getUnsigned(bits, 50, 10) / 10;
    const lon = getSigned(bits, 61, 28) / 600000;
    const lat = getSigned(bits, 89, 27) / 600000;
    const cog = getUnsigned(bits, 116, 12) / 10;
    const headingRaw = getUnsigned(bits, 128, 9);

    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      lat,
      lon,
      sog,
      cog,
      heading: headingRaw === 511 ? null : headingRaw,
      lastUpdate: Date.now(),
    };
  } catch {
    return null;
  }
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const earthRadiusNm = 3440.065;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusNm * Math.asin(Math.sqrt(h));
}

function remainingRouteDistanceNm(
  ownShip: OwnShip,
  waypoints: Waypoint[],
  activeWaypointIndex: number,
) {
  if (
    ownShip.lat === undefined ||
    ownShip.lon === undefined ||
    !waypoints.length ||
    activeWaypointIndex >= waypoints.length
  ) {
    return null;
  }

  let total = distanceNm(
    ownShip.lat,
    ownShip.lon,
    waypoints[activeWaypointIndex].lat,
    waypoints[activeWaypointIndex].lon,
  );

  for (let i = activeWaypointIndex; i < waypoints.length - 1; i += 1) {
    total += distanceNm(
      waypoints[i].lat,
      waypoints[i].lon,
      waypoints[i + 1].lat,
      waypoints[i + 1].lon,
    );
  }

  return total;
}

function normalizeRouteStatePayload(parsed: any) {
  try {
    const rawWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];

    const waypoints = rawWaypoints
      .map((wp: any, index: number) => {
        const lat = Number(wp?.lat ?? wp?.latitude);
        const lon = Number(wp?.lon ?? wp?.lng ?? wp?.longitude);

        return {
          id: typeof wp?.id === "string" && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, "0")}`,
          name: typeof wp?.name === "string" && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
          lat,
          lon,
        };
      })
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

    if (waypoints.length < 2) return null;

    return {
      routeName: typeof parsed?.routeName === "string" && parsed.routeName.trim() ? parsed.routeName : "Loaded RTZ Route",
      waypoints,
      activeWaypointIndex: Number.isFinite(Number(parsed?.activeWaypointIndex))
        ? Math.max(1, Math.min(Number(parsed.activeWaypointIndex), waypoints.length - 1))
        : 1,
    };
  } catch {
    return null;
  }
}

function loadSavedRouteState() {
  try {
    const raw = localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;

    return normalizeRouteStatePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadSharedRouteState() {
  try {
    const response = await fetch("/api/route-state", { cache: "no-store" });
    if (!response.ok) return null;

    return normalizeRouteStatePayload(await response.json());
  } catch {
    return null;
  }
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number) {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLon = toRad(bLon - aLon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}


type NearestCoastline = {
  distance: number;
  bearing: number;
  lat: number;
  lon: number;
  name: string;
  source: "coastline" | "reference" | "regional-segment";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  method: string;
};

type LandReferenceAnchor = {
  name: string;
  lat: number;
  lon: number;
  radiusNm: number;
  group: string;
};

type RegionalCoastlineSegment = {
  name: string;
  points: Array<[number, number]>;
};

type CoastlineDataPayload = {
  metadata?: {
    source?: string;
    polylineCount?: number;
    pointCount?: number;
    spacingNm?: number;
  };
  coastlines?: Array<Array<[number, number]>>;
};

const LAND_REFERENCE_ANCHORS: LandReferenceAnchor[] = [
  { name: "Guam / Apra Harbor", lat: 13.4443, lon: 144.7937, radiusNm: 16, group: "Marianas" },
  { name: "Guam North Coast", lat: 13.62, lon: 144.86, radiusNm: 7, group: "Marianas" },
  { name: "Guam South Coast", lat: 13.25, lon: 144.72, radiusNm: 8, group: "Marianas" },
  { name: "Rota", lat: 14.153, lon: 145.203, radiusNm: 8, group: "Marianas" },
  { name: "Aguijan", lat: 14.85, lon: 145.55, radiusNm: 3, group: "Marianas" },
  { name: "Tinian", lat: 14.999, lon: 145.619, radiusNm: 8, group: "Marianas" },
  { name: "Saipan", lat: 15.177, lon: 145.751, radiusNm: 13, group: "Marianas" },
  { name: "Farallon de Medinilla", lat: 16.019, lon: 146.058, radiusNm: 2, group: "Marianas" },
  { name: "Anatahan", lat: 16.36, lon: 145.67, radiusNm: 5, group: "Marianas" },
  { name: "Pagan", lat: 18.13, lon: 145.78, radiusNm: 6, group: "Marianas" },
  { name: "Agrihan", lat: 18.77, lon: 145.67, radiusNm: 5, group: "Marianas" },
  { name: "Asuncion", lat: 19.68, lon: 145.40, radiusNm: 3, group: "Marianas" },
  { name: "Maug Islands", lat: 20.02, lon: 145.22, radiusNm: 4, group: "Marianas" },
  { name: "Farallon de Pajaros", lat: 20.55, lon: 144.90, radiusNm: 3, group: "Marianas" },

  { name: "Yap", lat: 9.515, lon: 138.129, radiusNm: 12, group: "Caroline Islands" },
  { name: "Ulithi", lat: 9.967, lon: 139.667, radiusNm: 11, group: "Caroline Islands" },
  { name: "Fais", lat: 9.766, lon: 140.517, radiusNm: 4, group: "Caroline Islands" },
  { name: "Woleai", lat: 7.37, lon: 143.90, radiusNm: 10, group: "Caroline Islands" },
  { name: "Satawal", lat: 7.38, lon: 147.03, radiusNm: 4, group: "Caroline Islands" },
  { name: "Puluwat", lat: 7.35, lon: 149.20, radiusNm: 6, group: "Caroline Islands" },
  { name: "Chuuk Lagoon", lat: 7.452, lon: 151.846, radiusNm: 20, group: "Caroline Islands" },
  { name: "Pohnpei", lat: 6.854, lon: 158.214, radiusNm: 14, group: "Caroline Islands" },
  { name: "Ant Atoll", lat: 6.78, lon: 157.98, radiusNm: 7, group: "Caroline Islands" },
  { name: "Pingelap", lat: 6.22, lon: 160.70, radiusNm: 5, group: "Caroline Islands" },
  { name: "Kosrae", lat: 5.316, lon: 162.982, radiusNm: 9, group: "Caroline Islands" },

  { name: "Palau / Koror", lat: 7.342, lon: 134.478, radiusNm: 18, group: "Palau" },
  { name: "Babeldaob", lat: 7.55, lon: 134.58, radiusNm: 22, group: "Palau" },
  { name: "Sonsorol", lat: 5.33, lon: 132.22, radiusNm: 5, group: "Palau" },
  { name: "Helen Reef", lat: 2.97, lon: 131.82, radiusNm: 8, group: "Palau" },

  { name: "Majuro", lat: 7.117, lon: 171.185, radiusNm: 22, group: "Marshall Islands" },
  { name: "Kwajalein", lat: 8.72, lon: 167.73, radiusNm: 34, group: "Marshall Islands" },
  { name: "Enewetak", lat: 11.35, lon: 162.33, radiusNm: 22, group: "Marshall Islands" },
  { name: "Bikini Atoll", lat: 11.60, lon: 165.38, radiusNm: 20, group: "Marshall Islands" },
  { name: "Rongelap", lat: 11.16, lon: 166.89, radiusNm: 18, group: "Marshall Islands" },
  { name: "Wotje", lat: 9.45, lon: 170.23, radiusNm: 18, group: "Marshall Islands" },
  { name: "Mili", lat: 6.08, lon: 171.73, radiusNm: 16, group: "Marshall Islands" },
  { name: "Jaluit", lat: 5.92, lon: 169.65, radiusNm: 18, group: "Marshall Islands" },

  { name: "Wake Island", lat: 19.29, lon: 166.62, radiusNm: 6, group: "North Pacific" },
  { name: "Marcus Island / Minami-Torishima", lat: 24.29, lon: 153.98, radiusNm: 4, group: "North Pacific" },
  { name: "Iwo Jima", lat: 24.78, lon: 141.32, radiusNm: 6, group: "North Pacific" },
  { name: "Ogasawara / Chichijima", lat: 27.09, lon: 142.19, radiusNm: 8, group: "North Pacific" },

  { name: "Luzon West Coast", lat: 15.0, lon: 119.9, radiusNm: 0, group: "Philippines" },
  { name: "Luzon East Coast", lat: 16.4, lon: 122.2, radiusNm: 0, group: "Philippines" },
  { name: "Samar / Leyte", lat: 11.2, lon: 125.1, radiusNm: 0, group: "Philippines" },
  { name: "Mindanao East Coast", lat: 7.1, lon: 126.55, radiusNm: 0, group: "Philippines" },
  { name: "Palawan", lat: 10.2, lon: 119.1, radiusNm: 0, group: "Philippines" },

  { name: "Okinawa", lat: 26.212, lon: 127.681, radiusNm: 20, group: "Ryukyu / Japan" },
  { name: "Miyakojima", lat: 24.80, lon: 125.28, radiusNm: 8, group: "Ryukyu / Japan" },
  { name: "Ishigaki", lat: 24.34, lon: 124.16, radiusNm: 9, group: "Ryukyu / Japan" },
  { name: "Taiwan South Coast", lat: 21.95, lon: 120.75, radiusNm: 0, group: "Taiwan" },
  { name: "Japan / Kyushu South", lat: 31.0, lon: 130.6, radiusNm: 0, group: "Japan" },

  { name: "Papua New Guinea North Coast", lat: -3.5, lon: 143.0, radiusNm: 0, group: "PNG / Solomons" },
  { name: "New Ireland", lat: -3.3, lon: 151.6, radiusNm: 0, group: "PNG / Solomons" },
  { name: "New Britain", lat: -5.8, lon: 150.8, radiusNm: 0, group: "PNG / Solomons" },
  { name: "Bougainville", lat: -6.2, lon: 155.4, radiusNm: 0, group: "PNG / Solomons" },
  { name: "Solomon Islands", lat: -9.43, lon: 159.95, radiusNm: 0, group: "PNG / Solomons" },

  { name: "Hawaii / Oahu", lat: 21.31, lon: -157.86, radiusNm: 25, group: "Hawaii" },
  { name: "Hawaii / Big Island", lat: 19.60, lon: -155.50, radiusNm: 45, group: "Hawaii" },
  { name: "Kauai", lat: 22.05, lon: -159.50, radiusNm: 18, group: "Hawaii" },
];

const REGIONAL_COASTLINE_SEGMENTS: RegionalCoastlineSegment[] = [
  {
    name: "Mariana Islands regional chain",
    points: [
      [13.22, 144.60],
      [13.62, 144.95],
      [14.15, 145.20],
      [15.18, 145.75],
      [16.36, 145.67],
      [18.13, 145.78],
      [20.55, 144.90],
    ],
  },
  {
    name: "Caroline Islands regional chain",
    points: [
      [7.34, 134.48],
      [9.52, 138.13],
      [9.97, 139.67],
      [7.37, 143.90],
      [7.45, 151.85],
      [6.85, 158.21],
      [5.32, 162.98],
    ],
  },
  {
    name: "Marshall Islands regional chain",
    points: [
      [11.35, 162.33],
      [8.72, 167.73],
      [9.45, 170.23],
      [7.12, 171.19],
      [5.92, 169.65],
    ],
  },
  {
    name: "Philippines eastern coastline arc",
    points: [
      [18.5, 122.2],
      [16.4, 122.2],
      [14.6, 123.4],
      [11.2, 125.1],
      [7.1, 126.55],
      [5.9, 125.1],
    ],
  },
  {
    name: "Ryukyu / Taiwan coastline arc",
    points: [
      [31.0, 130.6],
      [28.2, 129.4],
      [26.2, 127.7],
      [24.8, 125.28],
      [24.34, 124.16],
      [21.95, 120.75],
    ],
  },
  {
    name: "PNG / Solomons coastline arc",
    points: [
      [-3.5, 143.0],
      [-3.3, 151.6],
      [-5.8, 150.8],
      [-6.2, 155.4],
      [-9.43, 159.95],
      [-10.8, 162.1],
    ],
  },
];

function normalizeLon(value: number) {
  return ((value + 540) % 360) - 180;
}

function deltaLonDegrees(fromLon: number, toLon: number) {
  return ((toLon - fromLon + 540) % 360) - 180;
}

function nearestPointOnSegmentNm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) {
  const cosLat = Math.max(0.01, Math.cos(toRad(pLat)));
  const ax = deltaLonDegrees(pLon, aLon) * 60 * cosLat;
  const ay = (aLat - pLat) * 60;
  const bx = deltaLonDegrees(pLon, bLon) * 60 * cosLat;
  const by = (bLat - pLat) * 60;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const x = ax + t * dx;
  const y = ay + t * dy;
  const lat = pLat + y / 60;
  const lon = normalizeLon(pLon + x / (60 * cosLat));

  return {
    distance: Math.sqrt(x * x + y * y),
    lat,
    lon,
  };
}

function pushCoastlineCandidate(
  candidates: NearestCoastline[],
  ownLat: number,
  ownLon: number,
  candidate: Omit<NearestCoastline, "bearing">,
) {
  if (!Number.isFinite(candidate.distance) || candidate.distance < 0) return;

  candidates.push({
    ...candidate,
    bearing: bearingDeg(ownLat, ownLon, candidate.lat, candidate.lon),
  });
}

function findNearestCoastlineCandidates(lat: number, lon: number, importedCoastlines: Array<Array<[number, number]>> = []) {
  const candidates: NearestCoastline[] = [];

  for (const coast of importedCoastlines) {
    for (let i = 0; i < coast.length - 1; i += 1) {
      const [aLat, aLon] = coast[i];
      const [bLat, bLon] = coast[i + 1];
      const candidate = nearestPointOnSegmentNm(lat, lon, aLat, aLon, bLat, bLon);

      pushCoastlineCandidate(candidates, lat, lon, {
        distance: candidate.distance,
        lat: candidate.lat,
        lon: candidate.lon,
        name: "GSHHG coastline geometry",
        source: "coastline",
        confidence: "HIGH",
        method: "Nearest point on imported coastline segment",
      });
    }
  }

  for (const regional of REGIONAL_COASTLINE_SEGMENTS) {
    for (let i = 0; i < regional.points.length - 1; i += 1) {
      const [aLat, aLon] = regional.points[i];
      const [bLat, bLon] = regional.points[i + 1];
      const candidate = nearestPointOnSegmentNm(lat, lon, aLat, aLon, bLat, bLon);

      pushCoastlineCandidate(candidates, lat, lon, {
        distance: candidate.distance,
        lat: candidate.lat,
        lon: candidate.lon,
        name: regional.name,
        source: "regional-segment",
        confidence: "MEDIUM",
        method: "Regional coastline / island-chain safety segment",
      });
    }
  }

  for (const ref of LAND_REFERENCE_ANCHORS) {
    const centerDistance = distanceNm(lat, lon, ref.lat, ref.lon);
    const estimatedCoastDistance = Math.max(0, centerDistance - ref.radiusNm);

    pushCoastlineCandidate(candidates, lat, lon, {
      distance: estimatedCoastDistance,
      lat: ref.lat,
      lon: ref.lon,
      name: ref.name,
      source: "reference",
      confidence: ref.radiusNm > 0 ? "MEDIUM" : "LOW",
      method: ref.radiusNm > 0 ? `${ref.group} anchor with radius allowance` : `${ref.group} landmass reference point`,
    });
  }

  return candidates
    .sort((a, b) => a.distance - b.distance)
    .filter((candidate, index, sorted) => {
      const firstSameName = sorted.findIndex((other) => other.name === candidate.name);
      return firstSameName === index;
    });
}

function findNearestCoastline(lat: number, lon: number, importedCoastlines: Array<Array<[number, number]>> = []): NearestCoastline | null {
  return findNearestCoastlineCandidates(lat, lon, importedCoastlines)[0] || null;
}

function sourceLabel(source?: NearestCoastline["source"]) {
  if (source === "reference") return "Island reference anchor";
  if (source === "regional-segment") return "Regional coastline safety segment";
  if (source === "coastline") return "Imported coastline geometry";
  return "Waiting on source";
}

function decimalToDdm(value?: number, type: "lat" | "lon" = "lat") {
  if (value === undefined || Number.isNaN(value)) return "—";

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi =
    type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";

  const width = type === "lat" ? 2 : 3;

  return `${deg.toString().padStart(width, "0")}° ${min
    .toFixed(3)
    .padStart(6, "0")}' ${hemi}`;
}

function formatCourse(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value).toString().padStart(3, "0")}°T`;
}

function formatSpeed(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} kt`;
}

function parseNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatClockUtc(date: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}

function formatClockWithOffset(date: Date | null, offset: number | null) {
  if (!date || Number.isNaN(date.getTime()) || offset === null) return "—";
  const adjusted = new Date(date.getTime() + offset * 3600000);
  return `${adjusted.getUTCHours().toString().padStart(2, "0")}:${adjusted
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} Local`;
}

function formatAge(timestamp?: number | null) {
  if (!timestamp) return "No live update";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}

function classifyLandDistance(distance: number | null) {
  if (distance === null) {
    return {
      label: "Waiting on position",
      tone: "border-slate-500/30 bg-slate-500/10 text-slate-200",
    };
  }

  if (distance < 3) {
    return {
      label: "NO DISCHARGE",
      tone: "border-red-500 bg-red-500 text-black",
    };
  }

  if (distance < 12) {
    return {
      label: "NO DISCHARGE",
      tone: "border-red-500 bg-red-500 text-black",
    };
  }

  if (distance < 25) {
    return {
      label: "CHECK RESTRICTIONS",
      tone: "border-yellow-400 bg-yellow-400 text-black",
    };
  }

  return {
    label: "DISCHARGE DISTANCE OK",
    tone: "border-green-500 bg-green-500 text-black",
  };
}

function collectForecastText(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return "";

  if (Array.isArray(value)) {
    return value.map((item) => collectForecastText(item, depth + 1)).join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/url|href|id|time|date|issued|updated|expires|geometry|coordinates/i.test(key))
      .map(([, item]) => collectForecastText(item, depth + 1))
      .join("\n");
  }

  return "";
}

function parseNumberGroups(text: string, pattern: RegExp) {
  const values: number[] = [];
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    for (let i = 1; i < match.length; i += 1) {
      if (!match[i]) continue;
      const value = Number(match[i]);
      if (Number.isFinite(value)) values.push(value);
    }
  }

  return values;
}

function maxOrNull(values: number[]) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  return cleanValues.length ? Math.max(...cleanValues) : null;
}

function maxMetersAsFeetOrNull(values: number[]) {
  const maxMeters = maxOrNull(values);
  return maxMeters === null ? null : Math.round(maxMeters * 3.28084);
}

function parseMaxWindKt(text: string) {
  const windWords = "(?:wind|winds)";
  const number = "(\\d{1,3}(?:\\.\\d+)?)";
  const range = `${number}(?:\\s*(?:to|-|–|through)\\s*${number})?`;
  const ktUnit = "(?:kt|kts|knots)\\b";
  const mphUnit = "(?:mph)\\b";
  const msUnit = "(?:m/s|mps|meters\\s+per\\s+second|metres\\s+per\\s+second)\\b";

  const ktValues = [
    ...parseNumberGroups(
      text,
      new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${windWords}[^\\n\\r.]{0,120}\\b(?:less\\s+than|below|under|to)\\s+${number}\\s*${ktUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?[^\\n\\r.]{0,80}${windWords}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?`, "gi"),
    ),
  ];

  const mphValues = [
    ...parseNumberGroups(
      text,
      new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${mphUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${mphUnit}[^\\n\\r.]{0,80}${windWords}`, "gi"),
    ),
  ];

  const msValues = [
    ...parseNumberGroups(
      text,
      new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${msUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${msUnit}[^\\n\\r.]{0,80}${windWords}`, "gi"),
    ),
  ];

  const maxKt = maxOrNull(ktValues);
  const maxMph = maxOrNull(mphValues);
  const maxMs = maxOrNull(msValues);

  const convertedValues = [
    maxKt,
    maxMph === null ? null : Math.round(maxMph * 0.868976),
    maxMs === null ? null : Math.round(maxMs * 1.94384),
  ].filter((value): value is number => value !== null && Number.isFinite(value));

  return convertedValues.length ? Math.max(...convertedValues) : null;
}

function parseWindRangeKt(text: string) {
  const patterns = [
    /(?:wind|winds)[^\d\n\r]{0,80}(\d{1,3}(?:\.\d+)?)\s*(?:to|-|–|through)\s*(\d{1,3}(?:\.\d+)?)\s*(?:kt|kts|knots)\b/gi,
    /(\d{1,3}(?:\.\d+)?)\s*(?:to|-|–|through)\s*(\d{1,3}(?:\.\d+)?)\s*(?:kt|kts|knots)\b/gi,
  ];

  let bestRange: { low: number; high: number } | null = null;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);

      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      const low = Math.min(a, b);
      const high = Math.max(a, b);

      if (!bestRange || high > bestRange.high) {
        bestRange = { low, high };
      }
    }
  }

  if (!bestRange) return null;

  const low = Number.isInteger(bestRange.low)
    ? bestRange.low.toFixed(0)
    : bestRange.low.toFixed(1);
  const high = Number.isInteger(bestRange.high)
    ? bestRange.high.toFixed(0)
    : bestRange.high.toFixed(1);

  return `${low} to ${high} kt`;
}

function parseWindDisplayKt(text: string) {
  const range = parseWindRangeKt(text);
  if (range) return range;

  const maxWindKt = parseMaxWindKt(text);
  return maxWindKt !== null ? `${maxWindKt} kt` : null;
}

function parseMaxSeasFt(text: string) {
  const seaWords = "(?:combined\\s+seas|seas|sea|significant\\s+wave\\s+height|wave\\s+heights?|wind\\s+waves?|waves?|swell|surf)";
  const number = "(\\d{1,2}(?:\\.\\d+)?)";
  const range = `${number}(?:\\s*(?:to|-|–|through)\\s*${number})?`;
  const feetUnit = "(?:ft|feet|foot)";
  const meterUnit = "(?:m|meter|meters|metre|metres)\\b";

  const feetValues = [
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${range}\\s*${feetUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\n\\r.]{0,140}(?:building|subsiding|rising|lowering|increasing|decreasing|becoming|less\\s+than)[^\\d\\n\\r]{0,60}${range}\\s*${feetUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\n\\r.]{0,140}\\b(?:to|less\\s+than)\\s+${number}\\s*${feetUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${feetUnit}[^\\n\\r.]{0,90}${seaWords}`, "gi"),
    ),
  ];

  const meterValues = [
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${range}\\s*${meterUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\n\\r.]{0,140}(?:building|subsiding|rising|lowering|increasing|decreasing|becoming|less\\s+than)[^\\d\\n\\r]{0,60}${range}\\s*${meterUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${seaWords}[^\\n\\r.]{0,140}\\b(?:to|less\\s+than)\\s+${number}\\s*${meterUnit}`, "gi"),
    ),
    ...parseNumberGroups(
      text,
      new RegExp(`${range}\\s*${meterUnit}[^\\n\\r.]{0,90}${seaWords}`, "gi"),
    ),
  ];

  const maxFeet = maxOrNull(feetValues);
  const maxMeters = maxOrNull(meterValues);
  const maxMetersAsFeet = maxMeters === null ? null : Math.round(maxMeters * 3.28084);

  if (maxFeet === null) return maxMetersAsFeet;
  if (maxMetersAsFeet === null) return maxFeet;
  return Math.max(maxFeet, maxMetersAsFeet);
}

function formatNumberForDisplay(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function parseSeasRange(text: string) {
  const seaWords = "(?:combined\\s+seas|seas|sea|significant\\s+wave\\s+height|wave\\s+heights?|wind\\s+waves?|waves?|swell|surf)";
  const number = "(\\d{1,2}(?:\\.\\d+)?)";

  const meterPatterns = [
    new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${number}\\s*(?:to|-|–|through)\\s*${number}\\s*(?:m|meter|meters|metre|metres)\\b`, "gi"),
    new RegExp(`${number}\\s*(?:to|-|–|through)\\s*${number}\\s*(?:m|meter|meters|metre|metres)\\b[^\\n\\r.]{0,90}${seaWords}`, "gi"),
  ];

  const feetPatterns = [
    new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${number}\\s*(?:to|-|–|through)\\s*${number}\\s*(?:ft|feet|foot)`, "gi"),
    new RegExp(`${number}\\s*(?:to|-|–|through)\\s*${number}\\s*(?:ft|feet|foot)[^\\n\\r.]{0,90}${seaWords}`, "gi"),
  ];

  let best:
    | { low: number; high: number; unit: "m" | "ft" }
    | null = null;

  for (const pattern of meterPatterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      const low = Math.min(a, b);
      const high = Math.max(a, b);

      if (!best || high * 3.28084 > (best.unit === "m" ? best.high * 3.28084 : best.high)) {
        best = { low, high, unit: "m" };
      }
    }
  }

  for (const pattern of feetPatterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      const low = Math.min(a, b);
      const high = Math.max(a, b);

      if (!best || high > (best.unit === "m" ? best.high * 3.28084 : best.high)) {
        best = { low, high, unit: "ft" };
      }
    }
  }

  return best;
}

function parseSeasDisplay(text: string) {
  const range = parseSeasRange(text);

  if (range) {
    if (range.unit === "m") {
      const lowFt = Math.round(range.low * 3.28084);
      const highFt = Math.round(range.high * 3.28084);

      return `${formatNumberForDisplay(range.low)} to ${formatNumberForDisplay(
        range.high,
      )} m / ${lowFt} to ${highFt} ft`;
    }

    return `${formatNumberForDisplay(range.low)} to ${formatNumberForDisplay(
      range.high,
    )} ft`;
  }

  const maxSeasFt = parseMaxSeasFt(text);
  return maxSeasFt !== null ? `${maxSeasFt} ft` : null;
}

function extractSeasPhrase(text: string) {
  const match =
    text.match(/(?:combined\s+seas|seas|sea|significant\s+wave\s+height|wave\s+heights?|wind\s+waves?|waves?|swell|surf)[^\n\r.]{0,140}(?:ft|feet|foot|m|meter|meters|metre|metres)\b/i) ||
    text.match(/(?:combined\s+seas|seas|sea|significant\s+wave\s+height|wave\s+heights?|wind\s+waves?|waves?|swell|surf)[^\n\r.]{0,140}/i);

  return match?.[0]?.trim() || "";
}

function deriveWeatherStatus(text: string, wind: unknown, seas: unknown) {
  const combined = `${text}\n${String(wind ?? "")}\n${String(seas ?? "")}`;

  if (!combined.trim()) {
    return {
      label: "WAITING",
      detail: "Forecast not loaded",
    };
  }

  const maxWindKt = parseMaxWindKt(combined);
  const maxSeasFt = parseMaxSeasFt(combined);
  const seasPhrase = extractSeasPhrase(combined);

  const redWords = /\b(storm|hurricane|typhoon|gale warning|storm warning|hurricane force|typhoon warning)\b/i;
  const amberWords = /\b(gale|small craft|advisory|rough|squall|squalls|fresh to strong|strong breeze|combined seas)\b/i;

  const detail = `Wind ${maxWindKt ?? "—"} kt / Seas ${maxSeasFt ?? "—"} ft${
    maxSeasFt === null && seasPhrase ? ` / ${seasPhrase}` : ""
  }`;

  if (redWords.test(combined) || (maxWindKt !== null && maxWindKt >= 34) || (maxSeasFt !== null && maxSeasFt >= 15)) {
    return {
      label: "RED",
      detail,
    };
  }

  if (amberWords.test(combined) || (maxWindKt !== null && maxWindKt >= 25) || (maxSeasFt !== null && maxSeasFt >= 10)) {
    return {
      label: "AMBER",
      detail,
    };
  }

  return {
    label: "NORMAL",
    detail,
  };
}

function extractWeatherSummary(data: any) {
  const highSeas =
    data?.pacific?.highSeasText ||
    data?.pacific?.highSeas?.text ||
    data?.highSeas?.text ||
    data?.highSeasText ||
    data?.officialPacific?.text ||
    "";

  const localForecast =
    data?.pacific?.summaryText ||
    data?.nws?.forecastText ||
    data?.nws?.shortForecast ||
    data?.nws?.detailedForecast ||
    data?.nws?.marineForecast ||
    data?.pacific?.localText ||
    data?.pacific?.regionalText ||
    "";

  // Important: WX status must be derived from the active forecast source only.
  // High Seas may be loaded as a fallback/reference product, but it should not
  // make a LOCAL forecast look AMBER/RED unless High Seas is the active source.
  const sourceModeRaw =
    data?.summary?.mode ||
    data?.mode ||
    data?.routingMode ||
    data?.forecastMode ||
    data?.pacific?.summaryMode ||
    (data?.nws?.forecastText || data?.nws?.detailedForecast || data?.pacific?.localText
      ? "LOCAL"
      : data?.pacific?.highSeasSource
        ? "OFFSHORE"
        : "POSITION");
  const sourceMode = String(sourceModeRaw || "POSITION").toUpperCase();
  const highSeasIsActive = sourceMode === "OFFSHORE" || !localForecast;

  const activeForecastText = [
    typeof localForecast === "string" ? localForecast : "",
    !localForecast ? collectForecastText(data) : "",
    highSeasIsActive && typeof highSeas === "string" ? highSeas : "",
  ]
    .filter(Boolean)
    .join("\n");

  const wind =
    data?.pacific?.parsed?.windDisplayText ||
    data?.pacific?.parsed?.windText ||
    data?.pacific?.parsed?.maxWindKt ||
    data?.nws?.forecastWindKt ||
    data?.ndbc?.windKt ||
    data?.parsed?.wind ||
    data?.parsed?.maxWindKt ||
    (highSeasIsActive ? data?.highSeas?.wind : undefined) ||
    data?.summary?.wind ||
    data?.wind ||
    "See forecast text";

  const seas =
    data?.pacific?.parsed?.seasDisplayText ||
    data?.pacific?.parsed?.seasText ||
    data?.pacific?.parsed?.maxSeasFt ||
    data?.ndbc?.waveFt ||
    data?.parsed?.seas ||
    data?.parsed?.maxSeasFt ||
    (highSeasIsActive ? data?.highSeas?.seas : undefined) ||
    data?.summary?.seas ||
    data?.seas ||
    "See forecast text";

  const weatherStatus = deriveWeatherStatus(activeForecastText, wind, seas);

  const forecastSource =
    data?.summary?.forecastSource ||
    data?.nearestForecast?.source ||
    data?.nws?.source ||
    data?.nws?.city ||
    data?.nws?.office ||
    data?.pacific?.localSource ||
    data?.pacific?.regionalSource ||
    data?.pacific?.highSeasSource ||
    data?.pacific?.title ||
    data?.highSeas?.title ||
    data?.productTitle ||
    "Forecast source pending";

  const observationSource =
    data?.summary?.observationSource ||
    data?.nearestObservation?.source ||
    data?.ndbc?.source ||
    data?.ndbc?.station ||
    data?.ndbc?.stationName ||
    data?.observation?.source ||
    "Observation source pending";

  // sourceMode is computed above before deriving status so fallback text cannot contaminate LOCAL status.

  const fallbackSource =
    data?.summary?.fallbackSource ||
    data?.fallbackSource ||
    data?.pacific?.highSeasSource ||
    data?.highSeas?.title ||
    "NOAA High Seas if local forecast is unavailable";

  const productTitle = forecastSource || "Nearest Forecast Guidance";

  const parsedWindDisplay = parseWindDisplayKt(`${activeForecastText}\n${String(wind ?? "")}`);
  const displayWind =
    parsedWindDisplay !== null && String(wind).toLowerCase().includes("see forecast")
      ? parsedWindDisplay
      : wind;

  const parsedSeasDisplay = parseSeasDisplay(`${activeForecastText}\n${String(seas ?? "")}`);
  const displaySeas =
    parsedSeasDisplay !== null && String(seas).toLowerCase().includes("see forecast")
      ? parsedSeasDisplay
      : seas;

  const statusLines = [
    forecastSource ? `Forecast: ${forecastSource}` : "",
    observationSource ? `Observation: ${observationSource}` : "",
    sourceMode ? `Mode: ${sourceMode}` : "",
    fallbackSource ? `Fallback: ${fallbackSource}` : "",
  ].filter(Boolean);

  const displayText = [
    statusLines.join("\n"),
    activeForecastText,
    !highSeasIsActive && typeof highSeas === "string" && highSeas.trim()
      ? "High Seas loaded as fallback/reference only. It is not used for LOCAL WX status."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    weatherStatus,
    wind: displayWind,
    seas: displaySeas,
    productTitle,
    forecastSource,
    observationSource,
    sourceMode,
    fallbackSource,
    text: displayText,
  };
}
export default function EcrTestPage() {
  const { nightMode: bridgeNightMode, toggleTheme } = useBridgeTheme();
  const [localNightMode, setLocalNightMode] = useState(bridgeNightMode);

  useEffect(() => {
    setLocalNightMode(bridgeNightMode);
  }, [bridgeNightMode]);

  const toggleNightMode = () => {
    const nextMode = !localNightMode;
    setLocalNightMode(nextMode);

    if (nextMode !== bridgeNightMode) {
      toggleTheme();
    }
  };

  const [ownShip, setOwnShip] = useState<OwnShip>({});
  const [wsStatus, setWsStatus] = useState("Connecting");
  const [fullscreen, setFullscreen] = useState(false);
  const [weather, setWeather] = useState<any>(null);
  const [weatherStatus, setWeatherStatus] = useState("Waiting on position");
  const [lastWeatherFetch, setLastWeatherFetch] = useState<Date | null>(null);

  const [destination, setDestination] = useState("Guam / Apra");
  const [distanceToGo, setDistanceToGo] = useState("");
  const [etaOffset, setEtaOffset] = useState("10");
  const [ecrNote, setEcrNote] = useState("Monitor distance from land thresholds and weather status.");
  const [routeName, setRouteName] = useState("");
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [activeWaypointIndex, setActiveWaypointIndex] = useState(0);
  const [coastlineData, setCoastlineData] = useState<Array<Array<[number, number]>>>([]);
  const [coastlineMeta, setCoastlineMeta] = useState<CoastlineDataPayload["metadata"] | null>(null);
  const [coastlineStatus, setCoastlineStatus] = useState("Loading coastline data");

  useEffect(() => {
    const saved = localStorage.getItem(FULLSCREEN_PREF_KEY);
    if (saved === "true") setFullscreen(true);

    const applyRoute = (routeState: ReturnType<typeof loadSavedRouteState>) => {
      if (!routeState) return;
      setRouteName(routeState.routeName);
      setWaypoints(routeState.waypoints);
      setActiveWaypointIndex(routeState.activeWaypointIndex);
    };

    applyRoute(loadSavedRouteState());

    let cancelled = false;
    loadSharedRouteState().then((sharedRoute) => {
      if (!cancelled) applyRoute(sharedRoute);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCoastlineData() {
      try {
        setCoastlineStatus("Loading coastline data");
        const response = await fetch("/data/gshhg-pacific-full.json", { cache: "force-cache" });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as CoastlineDataPayload;
        const lines = Array.isArray(payload?.coastlines) ? payload.coastlines : [];

        if (!cancelled) {
          setCoastlineData(lines);
          setCoastlineMeta(payload?.metadata || null);
          setCoastlineStatus(lines.length ? "GSHHG Pacific loaded" : "Fallback anchors only");
        }
      } catch {
        if (!cancelled) {
          setCoastlineData([]);
          setCoastlineMeta(null);
          setCoastlineStatus("Fallback anchors only");
        }
      }
    }

    loadCoastlineData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(FULLSCREEN_PREF_KEY, fullscreen ? "true" : "false");
  }, [fullscreen]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;

    const connect = () => {
      ws = new WebSocket(getAisWebSocketUrl());

      ws.onopen = () => setWsStatus("Connected");

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          const parsedLat = Number(msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude);
          const parsedLon = Number(
            msg?.lon ??
              msg?.lng ??
              msg?.longitude ??
              msg?.position?.lon ??
              msg?.position?.lng ??
              msg?.position?.longitude,
          );

          if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
            setOwnShip({
              lat: parsedLat,
              lon: parsedLon,
              sog: Number.isFinite(Number(msg?.sog ?? msg?.speed)) ? Number(msg?.sog ?? msg?.speed) : 0,
              cog: Number.isFinite(Number(msg?.cog ?? msg?.course)) ? Number(msg?.cog ?? msg?.course) : 0,
              heading: Number.isFinite(Number(msg?.heading ?? msg?.hdg)) ? Number(msg?.heading ?? msg?.hdg) : null,
              lastUpdate: Date.now(),
            });
          }

          if (msg?.type === "route-state") {
            const normalizedRoute = normalizeRouteStatePayload(msg);
            if (normalizedRoute) {
              setRouteName(normalizedRoute.routeName);
              setWaypoints(normalizedRoute.waypoints);
              setActiveWaypointIndex(normalizedRoute.activeWaypointIndex);
            }
          }

          const line =
            msg?.type === "nmea" && typeof msg.line === "string"
              ? msg.line
              : msg?.type === "nmea" && typeof msg.sentence === "string"
                ? msg.sentence
                : "";

          if (line.startsWith("!AIVDO")) {
            const decoded = decodeAisPosition(line);
            if (decoded) {
              setOwnShip(decoded);
            }
          }
        } catch {
          // Ignore non-JSON WebSocket traffic.
        }
      };

      ws.onerror = () => setWsStatus("Error");

      ws.onclose = () => {
        setWsStatus("Disconnected");
        if (!closedByEffect) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  const coastlineCandidates = useMemo(() => {
    if (ownShip.lat === undefined || ownShip.lon === undefined) return [];
    return findNearestCoastlineCandidates(ownShip.lat, ownShip.lon, coastlineData);
  }, [ownShip.lat, ownShip.lon, coastlineData]);

  const nearestCoastline = coastlineCandidates[0] || null;

  const landStatus = classifyLandDistance(nearestCoastline?.distance ?? null);

  const etaOffsetHours = parseNumber(etaOffset);
  const finalWaypoint = waypoints.length ? waypoints[waypoints.length - 1] : null;
  const nextWaypoint =
    waypoints.length && activeWaypointIndex < waypoints.length
      ? waypoints[activeWaypointIndex]
      : null;
  const routeRemainingDistance = useMemo(
    () => remainingRouteDistanceNm(ownShip, waypoints, activeWaypointIndex),
    [ownShip.lat, ownShip.lon, waypoints, activeWaypointIndex],
  );
  const manualDtg = parseNumber(distanceToGo);
  const activeDtg = routeRemainingDistance ?? manualDtg;
  const displayedDestination = finalWaypoint?.name || destination;
  const etaHours =
    activeDtg !== null && ownShip.sog && ownShip.sog > 0
      ? activeDtg / ownShip.sog
      : null;
  const etaUtc =
    etaHours !== null ? new Date(Date.now() + etaHours * 3600000) : null;

  const weatherLatKey = ownShip.lat !== undefined ? ownShip.lat.toFixed(1) : "";
  const weatherLonKey = ownShip.lon !== undefined ? ownShip.lon.toFixed(1) : "";

  useEffect(() => {
    if (ownShip.lat === undefined || ownShip.lon === undefined) return;

    let cancelled = false;

    async function fetchWeather() {
      try {
        setWeatherStatus("Updating");
        const response = await fetch(
          `/api/wx?lat=${ownShip.lat?.toFixed(5)}&lon=${ownShip.lon?.toFixed(5)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!cancelled) {
          setWeather(data);
          setWeatherStatus("Updated");
          setLastWeatherFetch(new Date());
        }
      } catch (error) {
        if (!cancelled) {
          setWeatherStatus(
            error instanceof Error ? `WX unavailable: ${error.message}` : "WX unavailable",
          );
        }
      }
    }

    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [weatherLatKey, weatherLonKey]);

  const wx = extractWeatherSummary(weather);
  const weatherStatusBoxClass =
    wx.weatherStatus.label === "RED"
      ? "border-red-400/60 bg-red-500/25 text-red-950"
      : wx.weatherStatus.label === "AMBER"
        ? "border-amber-300/60 bg-amber-400/25 text-amber-950"
        : wx.weatherStatus.label === "NORMAL"
          ? "border-emerald-300/60 bg-emerald-400/25 text-emerald-950"
          : "border-slate-300/40 bg-slate-400/20 text-slate-950";

  const theme = localNightMode
    ? {
        page: "min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(242,184,75,.28),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.12),transparent_28%),linear-gradient(135deg,#06111f,#101c2b_48%,#06111f)] p-6 text-slate-100",
        panel:
          "rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl",
        card: "rounded-3xl border border-white/10 bg-black/25 p-5",
        input:
          "w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-xl text-white outline-none focus:border-[#f2b84b]",
        button:
          "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xl font-bold text-slate-100 hover:bg-white/15",
        label: "text-xl font-bold uppercase tracking-[.18em] text-slate-400",
        muted: "text-slate-400",
        value: "text-white",
      }
    : {
        page: "min-h-screen bg-white p-6 text-slate-950",
        panel: "rounded-[2rem] border border-slate-300 bg-white p-6 shadow-sm",
        card: "rounded-3xl border border-slate-300 bg-slate-50 p-5",
        input:
          "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-xl text-slate-950 outline-none focus:border-[#f2b84b]",
        button:
          "rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-xl font-bold text-slate-900 hover:bg-white",
        label: "text-xl font-bold uppercase tracking-[.18em] text-slate-500",
        muted: "text-slate-500",
        value: "text-slate-950",
      };

  const compact = fullscreen ? "max-w-none" : "max-w-7xl";

  function goToNavConsole() {
    if (fullscreen || (typeof document !== "undefined" && document.fullscreenElement)) {
      window.localStorage.setItem(FULLSCREEN_PREF_KEY, "true");
    }
    window.location.href = "/";
  }

  return (
    <main className={theme.page}>
      <div className={`mx-auto ${compact}`}>
        <header className={`${theme.panel} mb-6`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className={theme.label}>ECR Remote Display </div>
              <h1 className={`mt-2 text-4xl font-black tracking-tight ${theme.value}`}>
                Engine Room Display
              </h1>
              <p className={`mt-2 max-w-3xl text-xl ${theme.muted}`}>
                Live bridge data display. Distance-from-land loads Coastline Pro data at runtime for awareness, not legal boundary determination.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={theme.card}>
                <div className={theme.label}>AIS Feed</div>
                <div className="mt-2 text-xl font-black">{wsStatus}</div>
                <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                  {formatAge(ownShip.lastUpdate)}
                </div>
              </div>

              <div className={theme.card}>
                <div className={theme.label}>Position</div>
                <div className="mt-2 font-mono text-xl">
                  {decimalToDdm(ownShip.lat, "lat")}
                </div>
                <div className="mt-1 font-mono text-xl">
                  {decimalToDdm(ownShip.lon, "lon")}
                </div>
              </div>

              <div className={theme.card}>
                <div className={theme.label}>Motion</div>
                <div className="mt-2 font-mono text-xl">
                  COG {formatCourse(ownShip.cog)}
                </div>
                <div className="mt-1 font-mono text-xl">
                  SOG {formatSpeed(ownShip.sog)}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button type="button" onClick={goToNavConsole} className={`${theme.button} flex items-center justify-center text-center`}>
                  Nav Console
                </button>
                <button className={`${theme.button} flex items-center justify-center text-center`} onClick={toggleNightMode}>
                  {localNightMode ? "Day Mode" : "Night Mode"}
                </button>
                <button className={`${theme.button} flex items-center justify-center text-center`} onClick={() => setFullscreen(!fullscreen)}>
                  {fullscreen ? "Exit Fullscreen Layout" : "Fullscreen Layout"}
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className={`${theme.card} lg:col-span-2`}>
            <div className={theme.label}>Distance From Land</div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <div className={`text-5xl font-black ${theme.value}`}>
                  {nearestCoastline ? nearestCoastline.distance.toFixed(1) : "—"}
                </div>
                <div className={theme.muted}>NM to nearest land / coastline</div>
              </div>

              <div>
                <div className={theme.label}>Nearest Land</div>
                <div className="mt-2 text-2xl font-black">
                  {nearestCoastline ? nearestCoastline.name : "Waiting on AIS"}
                </div>
                <div className={`mt-1 text-xl uppercase tracking-[.16em] ${theme.muted}`}>
                  {sourceLabel(nearestCoastline?.source)}
                </div>
                <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                  Bearing {nearestCoastline ? formatCourse(nearestCoastline.bearing) : "—"}
                </div>
                <div className={`mt-1 text-xl ${theme.muted}`}>
                  {nearestCoastline ? `${nearestCoastline.confidence} confidence • ${nearestCoastline.method}` : "Waiting on AIS"}
                </div>
              </div>

              <div className={`rounded-3xl border p-4 text-center ${landStatus.tone}`}>
                <div className="text-xl font-black uppercase tracking-[.18em] opacity-80">
                  Threshold Status
                </div>
                <div className="mt-3 text-2xl font-black text-black">
                  {landStatus.label}
                </div>
                <div className="mt-3 font-mono text-xl">
                  Outside 12 NM:{" "}
                  {nearestCoastline ? (nearestCoastline.distance >= 12 ? "YES" : "NO") : "—"}
                </div>
                <div className="mt-1 font-mono text-xl">
                  Outside 25 NM:{" "}
                  {nearestCoastline ? (nearestCoastline.distance >= 25 ? "YES" : "NO") : "—"}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-3xl bg-black/10 p-3">
              <div className={theme.label}>Closest Coastline Candidates</div>
              <div className="mt-3 grid gap-2">
                {coastlineCandidates.length ? coastlineCandidates.slice(0, 5).map((candidate, index) => (
                  <div key={`${candidate.name}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[.04] px-3 py-2 text-xl">
                    <div>
                      <div className="font-black">{index + 1}. {candidate.name}</div>
                      <div className={theme.muted}>{sourceLabel(candidate.source)} • {candidate.confidence} • {candidate.method}</div>
                    </div>
                    <div className="text-right font-mono">
                      <div>{candidate.distance.toFixed(1)} NM</div>
                      <div className={theme.muted}>{formatCourse(candidate.bearing)}</div>
                    </div>
                  </div>
                )) : (
                  <div className={`rounded-2xl bg-white/[.04] px-3 py-2 text-xl ${theme.muted}`}>
                    Waiting on live AIS position.
                  </div>
                )}
              </div>
            </div>

            <p className={`mt-4 text-xl ${theme.muted}`}>
              Distance-based awareness only. This is not a legal discharge authorization. This card loads GSHHG Pacific coastline JSON at runtime first, then regional coastline safety segments and expanded Pacific island reference anchors so small islands are less likely to be missed; it is not a MARPOL baseline calculation.
            </p>
          </div>

          <div className={theme.card}>
            <div className={theme.label}>Connection Health</div>
            <div className="mt-4 space-y-3 font-mono text-xl">
              <div className="flex justify-between gap-4">
                <span className={theme.muted}>WebSocket</span>
                <span>{wsStatus}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={theme.muted}>WX API</span>
                <span>{weatherStatus}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={theme.muted}>WX Updated</span>
                <span>{formatClockUtc(lastWeatherFetch)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={theme.muted}>Heading</span>
                <span>{formatCourse(ownShip.heading)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-4 xl:grid-cols-3">
          <div className={theme.card}>
            <div className={theme.label}>Voyage Status</div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className={theme.label}>Route Source</div>
              <div className="mt-1 text-xl font-black">
                {waypoints.length ? "Loaded RTZ Route" : "Manual Fallback"}
              </div>
              <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                {waypoints.length
                  ? routeName || "Route loaded"
                  : "No loaded route detected"}
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {!waypoints.length && (
                <>
                  <label className="grid gap-2">
                    <span className={theme.label}>Manual Destination</span>
                    <input
                      className={theme.input}
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className={theme.label}>Manual Distance To Go, NM</span>
                    <input
                      className={theme.input}
                      value={distanceToGo}
                      onChange={(e) => setDistanceToGo(e.target.value)}
                      inputMode="decimal"
                      placeholder="Example: 420"
                    />
                  </label>
                </>
              )}

              <label className="grid gap-2">
                <span className={theme.label}>Destination UTC Offset</span>
                <input
                  className={theme.input}
                  value={etaOffset}
                  onChange={(e) => setEtaOffset(e.target.value)}
                  inputMode="decimal"
                  placeholder="Example: +10"
                />
              </label>
            </div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className={theme.label}>Destination</div>
              <div className="mt-1 text-2xl font-black">
                {displayedDestination || "—"}
              </div>

              {waypoints.length ? (
                <div className={`mt-2 font-mono text-xl ${theme.muted}`}>
                  Next: {nextWaypoint ? `${nextWaypoint.id} ${nextWaypoint.name}` : "—"}
                </div>
              ) : null}

              <div className={`${theme.label} mt-4`}>Distance To Go</div>
              <div className="mt-1 font-mono text-xl">
                {activeDtg !== null ? `${activeDtg.toFixed(1)} NM` : "—"}
              </div>

              <div className={`${theme.label} mt-4`}>ETA at Current SOG</div>
              <div className="mt-1 font-mono text-xl">{formatClockUtc(etaUtc)}</div>
              <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                {formatClockWithOffset(etaUtc, etaOffsetHours)}
              </div>
            </div>
          </div>

          <div className={`${theme.card} flex min-h-[360px] flex-col xl:col-span-2`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className={theme.label}>Weather Snapshot</div>
                <h2 className="mt-2 text-2xl font-black">
                  {wx.productTitle || "Pacific Forecast"}
                </h2>
              </div>
              <div className={`rounded-2xl border px-4 py-3 text-xl font-black uppercase tracking-[.16em] ${weatherStatusBoxClass}`}>
                {weatherStatus}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className={`${theme.panel} ${weatherStatusBoxClass} p-4`}>
                <div className={theme.label}>Weather Status</div>
                <div className="mt-2 text-2xl font-black uppercase">
                  {wx.weatherStatus.label}
                </div>
                <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                  {wx.weatherStatus.detail}
                </div>
              </div>

              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>Wind</div>
                <div className="mt-2 text-xl font-black">{String(wx.wind)}</div>
              </div>

              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>Seas</div>
                <div className="mt-2 text-xl font-black">{String(wx.seas)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>Forecast Source</div>
                <div className="mt-2 text-lg font-black">{String(wx.forecastSource)}</div>
              </div>

              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>Observation Source</div>
                <div className="mt-2 text-lg font-black">{String(wx.observationSource)}</div>
              </div>

              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>WX Mode</div>
                <div className="mt-2 text-lg font-black uppercase">{String(wx.sourceMode)}</div>
              </div>

              <div className={`${theme.panel} p-4`}>
                <div className={theme.label}>Fallback</div>
                <div className="mt-2 text-lg font-black">{String(wx.fallbackSource)}</div>
              </div>
            </div>

            <pre
              className={`mt-4 flex-1 overflow-auto whitespace-pre-wrap rounded-3xl border p-4 text-xl leading-relaxed ${
                localNightMode
                  ? "border-white/10 bg-black/25 text-slate-300"
                  : "border-slate-300 bg-white text-slate-950"
              }`}
            >
              {wx.text || "Weather text will appear here when /api/wx is available and AIS position is live."}
            </pre>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className={theme.card}>
            <div className={theme.label}>ECR Notes</div>
            <textarea
              className={`${theme.input} mt-4 flex-1 min-h-[260px]`}
              value={ecrNote}
              onChange={(e) => setEcrNote(e.target.value)}
            />
          </div>

          <div className={theme.card}>
            <div className={theme.label}>Display Intent</div>
            <div className="mt-4 space-y-3 text-xl leading-relaxed">
              <p>
                This page is built for an ECR screen: position, motion, weather status,
                distance-from-land awareness, and connection health without chart clutter.
              </p>
              <p className={theme.muted}>
                Distance-from-land v1 is a practical reference-card test. It uses onboard GSHHG coastline geometry plus Pacific island reference anchors to avoid missing small islands; it is not a MARPOL baseline calculation and does not determine legal discharge authorization. Future iterations may add configurable thresholds, more detailed weather parsing, and additional voyage data elements as needed, but the focus will remain on clear, concise information for engine room awareness.
              </p>
              <div className="grid gap-2 pt-2 font-mono text-xl">
                <div>Primary source: AIS WebSocket ws://host:8081</div>
                <div></div>
                <div></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
