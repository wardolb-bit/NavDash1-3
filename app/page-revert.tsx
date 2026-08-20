"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBridgeTheme } from "../lib/useBridgeTheme";

const FULLSCREEN_PREF_KEY = "navconsole-fullscreen";
const WATCH_LOG_KEY = "navdash-v12-watch-log";

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type WatchLogRow = {
  id: string;
  timeUtc: string;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number;
  activeLeg: string;
  dtg: number;
  xte: number;
  weather: string;
};

type WeatherSnapshot = {
  status: "NORMAL" | "AMBER" | "RED" | "UNKNOWN";
  summary: string;
  wind: string;
  seas: string;
  source: string;
  updated: string;
  error?: string;
};

function textFromUnknown(value: any, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function numOrNull(value: any) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeMax(values: Array<number | null | undefined>) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? Math.max(...nums) : null;
}

function stableWeatherTone(windKt: number | null, seasFt: number | null) {
  if ((windKt ?? 0) >= 35 || (seasFt ?? 0) >= 15) return "RED";
  if ((windKt ?? 0) >= 25 || (seasFt ?? 0) >= 10) return "AMBER";
  return "NORMAL";
}

function findFirstString(source: any, keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc?.[part], source);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizeWeatherSnapshot(data: any): WeatherSnapshot {
  const forecastWind = numOrNull(data?.nws?.forecastWindKt);
  const pacificWind = numOrNull(data?.pacific?.parsed?.maxWindKt);
  const pacificSeas = numOrNull(data?.pacific?.parsed?.maxSeasFt);
  const ndbcWind = numOrNull(data?.ndbc?.windKt);
  const ndbcGust = numOrNull(data?.ndbc?.gustKt);
  const ndbcSeas = numOrNull(data?.ndbc?.waveFt);

  const operationalWind = safeMax([pacificWind, ndbcWind, ndbcGust, forecastWind]);
  const operationalSeas = safeMax([pacificSeas, ndbcSeas]);
  const status = stableWeatherTone(operationalWind, operationalSeas);

  const pacificWindDisplay =
    data?.pacific?.parsed?.windDisplayText ??
    data?.pacific?.parsed?.windText ??
    (pacificWind !== null ? `${pacificWind} kt` : "");

  const pacificSeasDisplay =
    data?.pacific?.parsed?.seasDisplayText ??
    data?.pacific?.parsed?.seasText ??
    (pacificSeas !== null ? `${pacificSeas} ft` : "");

  const wind =
    pacificWindDisplay ||
    (operationalWind !== null ? `${operationalWind} kt max` : "") ||
    findFirstString(data, [
      "wind.display",
      "wind.text",
      "wind",
      "conditions.wind",
      "marine.wind",
      "highSeas.wind",
      "forecast.wind",
      "windRange",
      "nws.windSpeedText",
    ]) ||
    "--";

  const seas =
    pacificSeasDisplay ||
    (operationalSeas !== null ? `${operationalSeas} ft max` : "") ||
    findFirstString(data, [
      "seas.display",
      "seas.text",
      "seas",
      "waves",
      "conditions.seas",
      "marine.seas",
      "highSeas.seas",
      "forecast.seas",
      "seaRange",
    ]) ||
    "--";

  const summary =
    findFirstString(data, [
      "summary.text",
      "bridgeSummary.text",
      "bridgeSummary.summary",
      "marine.summary",
      "highSeas.summary",
      "forecast.summary",
      "discussion",
      "headline",
    ]) ||
    `Stable WX thresholds applied: wind ${operationalWind ?? "--"} kt / seas ${operationalSeas ?? "--"} ft.`;

  const source =
    data?.pacific?.highSeasSource ||
    data?.pacific?.localSource ||
    findFirstString(data, [
      "source",
      "sourceName",
      "primarySource",
      "highSeas.source",
      "marine.source",
      "forecast.source",
    ]) ||
    "NavDash / NOAA weather API";

  return {
    status,
    summary,
    wind,
    seas,
    source,
    updated: new Date().toISOString(),
  };
}




type LandAnchor = {
  name: string;
  lat: number;
  lon: number;
  radiusNm: number;
  source: "Island anchor" | "Major landmass anchor" | "Port anchor";
};

type CoastlineSegment = {
  name: string;
  source: "Simplified coastline segment";
  points: Array<{ lat: number; lon: number }>;
};

const LAND_REFERENCE_ANCHORS: LandAnchor[] = [
  { name: "Guam / Apra Harbor", lat: 13.4443, lon: 144.7937, radiusNm: 16, source: "Port anchor" },
  { name: "Rota", lat: 14.153, lon: 145.203, radiusNm: 8, source: "Island anchor" },
  { name: "Tinian", lat: 14.999, lon: 145.619, radiusNm: 8, source: "Island anchor" },
  { name: "Saipan", lat: 15.177, lon: 145.751, radiusNm: 13, source: "Island anchor" },
  { name: "Yap", lat: 9.515, lon: 138.129, radiusNm: 12, source: "Island anchor" },
  { name: "Ulithi", lat: 9.967, lon: 139.667, radiusNm: 11, source: "Island anchor" },
  { name: "Palau / Koror", lat: 7.342, lon: 134.478, radiusNm: 18, source: "Island anchor" },
  { name: "Chuuk Lagoon", lat: 7.452, lon: 151.846, radiusNm: 20, source: "Island anchor" },
  { name: "Pohnpei", lat: 6.854, lon: 158.214, radiusNm: 14, source: "Island anchor" },
  { name: "Kosrae", lat: 5.316, lon: 162.982, radiusNm: 9, source: "Island anchor" },
  { name: "Majuro", lat: 7.117, lon: 171.185, radiusNm: 22, source: "Island anchor" },
  { name: "Kwajalein", lat: 8.72, lon: 167.73, radiusNm: 34, source: "Island anchor" },
  { name: "Wake Island", lat: 19.29, lon: 166.62, radiusNm: 6, source: "Island anchor" },
  { name: "Okinawa", lat: 26.212, lon: 127.681, radiusNm: 20, source: "Island anchor" },
  { name: "Luzon West Coast", lat: 15.0, lon: 119.9, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Samar / Leyte", lat: 11.2, lon: 125.1, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Mindanao East Coast", lat: 7.1, lon: 126.55, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Taiwan South Coast", lat: 21.95, lon: 120.75, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Japan / Kyushu South", lat: 31.0, lon: 130.6, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Papua New Guinea North Coast", lat: -3.5, lon: 143.0, radiusNm: 0, source: "Major landmass anchor" },
  { name: "Solomon Islands", lat: -9.43, lon: 159.95, radiusNm: 0, source: "Major landmass anchor" },
];

const SIMPLIFIED_COASTLINE_SEGMENTS: CoastlineSegment[] = [
  {
    name: "Mariana Islands Chain",
    source: "Simplified coastline segment",
    points: [
      { lat: 13.25, lon: 144.55 },
      { lat: 13.55, lon: 144.95 },
      { lat: 14.15, lon: 145.20 },
      { lat: 15.0, lon: 145.62 },
      { lat: 15.25, lon: 145.82 },
    ],
  },
  {
    name: "Caroline Islands West",
    source: "Simplified coastline segment",
    points: [
      { lat: 7.34, lon: 134.48 },
      { lat: 9.52, lon: 138.13 },
      { lat: 9.97, lon: 139.67 },
      { lat: 7.45, lon: 151.85 },
    ],
  },
  {
    name: "Caroline Islands East",
    source: "Simplified coastline segment",
    points: [
      { lat: 7.45, lon: 151.85 },
      { lat: 6.85, lon: 158.21 },
      { lat: 5.32, lon: 162.98 },
    ],
  },
  {
    name: "Marshall Islands Chain",
    source: "Simplified coastline segment",
    points: [
      { lat: 8.72, lon: 167.73 },
      { lat: 7.12, lon: 171.19 },
      { lat: 5.92, lon: 169.65 },
    ],
  },
  {
    name: "Philippines East / South",
    source: "Simplified coastline segment",
    points: [
      { lat: 18.5, lon: 122.2 },
      { lat: 14.6, lon: 123.4 },
      { lat: 11.2, lon: 125.1 },
      { lat: 7.1, lon: 126.55 },
      { lat: 5.9, lon: 125.1 },
    ],
  },
  {
    name: "Japan / Ryukyu Arc",
    source: "Simplified coastline segment",
    points: [
      { lat: 31.0, lon: 130.6 },
      { lat: 28.2, lon: 129.4 },
      { lat: 26.2, lon: 127.7 },
      { lat: 24.3, lon: 124.2 },
      { lat: 22.0, lon: 121.0 },
    ],
  },
  {
    name: "Papua New Guinea / Solomons",
    source: "Simplified coastline segment",
    points: [
      { lat: -3.5, lon: 143.0 },
      { lat: -4.2, lon: 150.2 },
      { lat: -6.2, lon: 155.5 },
      { lat: -9.43, lon: 159.95 },
      { lat: -10.8, lon: 162.1 },
    ],
  },
];

type AisOwnShip = {
  mmsi?: number;
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number | null;
  source?: string;
  lastSeen: number;
};

type Multipart = { total: number; parts: string[]; fillBits: number };

const multipartCache = new Map<string, Multipart>();

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

function getUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function getSigned(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}

function getAisBits(sentence: string): { bits: string; source: string } | null {
  const parts = sentence.split(",");
  if (parts.length < 7) return null;

  const source = parts[0];
  const total = Number(parts[1]);
  const number = Number(parts[2]);
  const seq = parts[3] || "0";
  const channel = parts[4] || "0";
  const payload = parts[5];
  const fillBits = Number(parts[6]?.split("*")[0] || 0);

  if (!payload) return null;

  if (total <= 1) {
    let bits = payloadToBits(payload);
    if (fillBits > 0) bits = bits.slice(0, -fillBits);
    return { bits, source };
  }

  const key = `${source}-${seq}-${channel}`;
  const cached = multipartCache.get(key) || { total, parts: [], fillBits: 0 };
  cached.parts[number - 1] = payload;
  cached.fillBits = fillBits;
  multipartCache.set(key, cached);

  if (cached.parts.filter(Boolean).length !== total) return null;

  multipartCache.delete(key);
  let bits = payloadToBits(cached.parts.join(""));
  if (cached.fillBits > 0) bits = bits.slice(0, -cached.fillBits);
  return { bits, source };
}

function decodeOwnShip(sentence: string): AisOwnShip | null {
  try {
    if (!sentence.startsWith("!AIVDO")) return null;

    const result = getAisBits(sentence);
    if (!result) return null;

    const { bits, source } = result;
    const msgType = getUnsigned(bits, 0, 6);
    if (![1, 2, 3].includes(msgType)) return null;

    const mmsi = getUnsigned(bits, 8, 30);
    const sog = getUnsigned(bits, 50, 10) / 10;
    const lon = getSigned(bits, 61, 28) / 600000;
    const lat = getSigned(bits, 89, 27) / 600000;
    const cog = getUnsigned(bits, 116, 12) / 10;
    const headingRaw = getUnsigned(bits, 128, 9);

    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      mmsi,
      lat,
      lon,
      sog,
      cog,
      heading: headingRaw === 511 ? null : headingRaw,
      source,
      lastSeen: Date.now(),
    };
  } catch {
    return null;
  }
}

function parseRtzRoute(xmlText: string): { routeName: string; waypoints: Waypoint[] } {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Could not parse RTZ/XML route.");

  const routeNode = doc.querySelector("route");
  const routeName =
    routeNode?.getAttribute("routeName") ||
    routeNode?.getAttribute("name") ||
    doc.querySelector("routeInfo")?.getAttribute("routeName") ||
    "Loaded RTZ Route";

  const waypointNodes = Array.from(doc.getElementsByTagName("waypoint"));

  const waypoints = waypointNodes
    .map((wp, index) => {
      const position = wp.getElementsByTagName("position")[0];
      const latRaw =
        position?.getAttribute("lat") ||
        position?.getAttribute("latitude") ||
        wp.getAttribute("lat") ||
        wp.getAttribute("latitude");
      const lonRaw =
        position?.getAttribute("lon") ||
        position?.getAttribute("longitude") ||
        wp.getAttribute("lon") ||
        wp.getAttribute("longitude");

      const lat = Number(latRaw);
      const lon = Number(lonRaw);

      return {
        id: wp.getAttribute("id") || wp.getAttribute("revision") || `WP${String(index + 1).padStart(2, "0")}`,
        name:
          wp.getAttribute("name") ||
          wp.getAttribute("waypointName") ||
          wp.querySelector("name")?.textContent?.trim() ||
          `Waypoint ${index + 1}`,
        lat,
        lon,
      };
    })
    .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

  if (waypoints.length < 2) throw new Error("RTZ route must contain at least two usable waypoints.");

  return { routeName, waypoints };
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function toDeg(value: number) {
  return (value * 180) / Math.PI;
}

function normalize360(value: number) {
  return ((value % 360) + 360) % 360;
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lambda1 = toRad(lon1);
  const lambda2 = toRad(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalize360(toDeg(Math.atan2(y, x)));
}

function routePointToXY(lat: number, lon: number, refLat: number, refLon: number) {
  const nmPerDegLat = 60;
  const nmPerDegLon = 60 * Math.cos(toRad(refLat));
  return {
    x: (lon - refLon) * nmPerDegLon,
    y: (lat - refLat) * nmPerDegLat,
  };
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
      alongTrack: 0,
      legLength: 0,
      side: "--",
      projectionRatio: 0,
    };
  }

  const rawRatio = (wx * vx + wy * vy) / legLengthSquared;
  const projectionRatio = Math.max(0, Math.min(1, rawRatio));
  const closestX = start.x + projectionRatio * vx;
  const closestY = start.y + projectionRatio * vy;
  const dx = ship.x - closestX;
  const dy = ship.y - closestY;
  const signedCross = vx * wy - vy * wx;

  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    alongTrack: Math.sqrt(legLengthSquared) * projectionRatio,
    legLength: Math.sqrt(legLengthSquared),
    side: signedCross > 0 ? "STBD" : signedCross < 0 ? "PORT" : "--",
    projectionRatio,
  };
}

function nearestPointOnSegmentForBearing(
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
  const ratio = legLengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / legLengthSquared));

  return {
    lat: startLat + (endLat - startLat) * ratio,
    lon: startLon + (endLon - startLon) * ratio,
    ratio,
  };
}

function coastlineRiskLabel(distanceNmValue: number | null) {
  if (distanceNmValue === null) return "WAITING";
  if (distanceNmValue < 12) return "NO DISCHARGE";
  if (distanceNmValue < 25) return "CHECK RESTRICTIONS";
  return "DISTANCE OK";
}

function coastlineRiskStatus(distanceNmValue: number | null) {
  if (distanceNmValue === null) return "AMBER";
  if (distanceNmValue < 12) return "RED";
  if (distanceNmValue < 25) return "AMBER";
  return "NORMAL";
}

function computeCoastlinePro(
  ownShip: AisOwnShip | null,
  mode: string,
  route: Waypoint[],
) {
  if (!ownShip) return null;

  const candidates: Array<{
    name: string;
    distance: number;
    bearing: number;
    lat: number;
    lon: number;
    source: string;
  }> = [];

  const useAnchors = mode !== "True coastline geometry only";
  const useSegments = mode !== "Reference anchors only";

  if (useAnchors) {
    for (const anchor of LAND_REFERENCE_ANCHORS) {
      const centerDistance = distanceNm(ownShip.lat, ownShip.lon, anchor.lat, anchor.lon);
      const estimatedDistance = Math.max(0, centerDistance - anchor.radiusNm);
      candidates.push({
        name: anchor.name,
        distance: estimatedDistance,
        bearing: bearingDeg(ownShip.lat, ownShip.lon, anchor.lat, anchor.lon),
        lat: anchor.lat,
        lon: anchor.lon,
        source: anchor.source,
      });
    }
  }

  if (useSegments) {
    for (const segment of SIMPLIFIED_COASTLINE_SEGMENTS) {
      for (let i = 0; i < segment.points.length - 1; i += 1) {
        const start = segment.points[i];
        const end = segment.points[i + 1];
        const nearest = distancePointToSegmentNm(ownShip.lat, ownShip.lon, start.lat, start.lon, end.lat, end.lon);
        const point = nearestPointOnSegmentForBearing(ownShip.lat, ownShip.lon, start.lat, start.lon, end.lat, end.lon);
        candidates.push({
          name: segment.name,
          distance: nearest.distance,
          bearing: bearingDeg(ownShip.lat, ownShip.lon, point.lat, point.lon),
          lat: point.lat,
          lon: point.lon,
          source: segment.source,
        });
      }
    }
  }

  for (const wp of route) {
    const wpDistance = distanceNm(ownShip.lat, ownShip.lon, wp.lat, wp.lon);
    candidates.push({
      name: `Route waypoint: ${wp.id} ${wp.name}`,
      distance: wpDistance,
      bearing: bearingDeg(ownShip.lat, ownShip.lon, wp.lat, wp.lon),
      lat: wp.lat,
      lon: wp.lon,
      source: "Loaded RTZ waypoint context",
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0] || null;

  return {
    nearest,
    top: candidates.slice(0, 5),
    risk: coastlineRiskLabel(nearest?.distance ?? null),
    status: coastlineRiskStatus(nearest?.distance ?? null),
    sources: {
      anchors: LAND_REFERENCE_ANCHORS.length,
      segments: SIMPLIFIED_COASTLINE_SEGMENTS.length,
      routePoints: route.length,
      encLayer: "Display only",
      seamarks: "Display only",
    },
  };
}

function logicalRouteLeg(route: Waypoint[], ownShip: AisOwnShip | null, currentLegIndex: number) {
  if (!ownShip || route.length < 2) return null;

  let best:
    | {
        index: number;
        start: Waypoint;
        end: Waypoint;
        distance: number;
        alongTrack: number;
        legLength: number;
        side: string;
        projectionRatio: number;
      }
    | null = null;

  for (let i = 1; i < route.length; i += 1) {
    const start = route[i - 1];
    const end = route[i];
    const result = distancePointToSegmentNm(
      ownShip.lat,
      ownShip.lon,
      start.lat,
      start.lon,
      end.lat,
      end.lon,
    );

    const jumpPenalty = Math.abs(i - currentLegIndex) * 0.35;
    const endPenalty = result.projectionRatio <= 0 || result.projectionRatio >= 1 ? 0.25 : 0;
    const score = result.distance + jumpPenalty + endPenalty;

    if (!best || score < best.distance + Math.abs(best.index - currentLegIndex) * 0.35) {
      best = {
        index: i,
        start,
        end,
        distance: result.distance,
        alongTrack: result.alongTrack,
        legLength: result.legLength,
        side: result.side,
        projectionRatio: result.projectionRatio,
      };
    }
  }

  return best;
}

function selectedRouteLeg(route: Waypoint[], ownShip: AisOwnShip | null, selectedLegIndex: number) {
  if (!ownShip || route.length < 2) return null;

  const clampedIndex = Math.min(Math.max(selectedLegIndex, 1), route.length - 1);
  const start = route[clampedIndex - 1];
  const end = route[clampedIndex];
  const result = distancePointToSegmentNm(
    ownShip.lat,
    ownShip.lon,
    start.lat,
    start.lon,
    end.lat,
    end.lon,
  );

  return {
    index: clampedIndex,
    start,
    end,
    distance: result.distance,
    alongTrack: result.alongTrack,
    legLength: result.legLength,
    side: result.side,
    projectionRatio: result.projectionRatio,
  };
}

function remainingRouteDistanceNm(route: Waypoint[], leg: ReturnType<typeof selectedRouteLeg>) {
  if (!leg || route.length < 2) return null;

  let total = Math.max(0, leg.legLength - leg.alongTrack);

  for (let i = leg.index; i < route.length - 1; i += 1) {
    total += distanceNm(route[i].lat, route[i].lon, route[i + 1].lat, route[i + 1].lon);
  }

  return total;
}

function formatNm(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function formatDdm(value: number, isLat: boolean) {
  const hemisphere = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  const degreeText = isLat ? String(degrees).padStart(2, "0") : String(degrees).padStart(3, "0");
  return `${degreeText}°${minutes.toFixed(2).padStart(5, "0")}'${hemisphere}`;
}

function formatPositionDdm(lat: number, lon: number) {
  return `${formatDdm(lat, true)} / ${formatDdm(lon, false)}`;
}

function watchLogHourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function extractNmeaLine(msg: any) {
  const candidates = [msg?.line, msg?.sentence, msg?.nmea, msg?.raw, msg?.data, msg?.payload];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.startsWith("!AIVDO")) return trimmed;
  }

  if (typeof msg === "string") {
    const trimmed = msg.trim();
    if (trimmed.startsWith("!AIVDO")) return trimmed;
  }

  return "";
}

function ownShipFromParsedMessage(msg: any): AisOwnShip | null {
  const lat = Number(msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude);
  const lon = Number(msg?.lon ?? msg?.lng ?? msg?.longitude ?? msg?.position?.lon ?? msg?.position?.lng ?? msg?.position?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    mmsi: Number.isFinite(Number(msg?.mmsi)) ? Number(msg.mmsi) : undefined,
    lat,
    lon,
    sog: Number.isFinite(Number(msg?.sog ?? msg?.speed)) ? Number(msg?.sog ?? msg?.speed) : 0,
    cog: Number.isFinite(Number(msg?.cog ?? msg?.course)) ? Number(msg?.cog ?? msg?.course) : 0,
    heading: Number.isFinite(Number(msg?.heading ?? msg?.hdg)) ? Number(msg?.heading ?? msg?.hdg) : null,
    source: String(msg?.source || msg?.type || "parsed"),
    lastSeen: Date.now(),
  };
}

function formatHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function csvEscape(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default function NavDashV12LabPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const dayMode = !nightMode;
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const ownMarkerRef = useRef<any>(null);
  const encLayerRef = useRef<any>(null);
  const seamarkLayerRef = useRef<any>(null);
  const weatherLoadedFromLiveAisRef = useRef(false);
  const lastAutoLogHourRef = useRef("");
  const sectionIds = {
    chart: "v12-section-chart",
    route: "v12-section-route",
    watch: "v12-section-watch",
    weather: "v12-section-weather",
    status: "v12-section-status",
    offline: "v12-section-offline",
    coast: "v12-section-coast",
    build: "v12-section-build",
  };

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState("chart");
  const [encLayerOn, setEncLayerOn] = useState(true);
  const [seamarksOn, setSeamarksOn] = useState(true);
  const [corridorNm, setCorridorNm] = useState(2);
  const [watchLog, setWatchLog] = useState<WatchLogRow[]>([]);
  const [autoLogEnabled, setAutoLogEnabled] = useState(true);
  const [lastAutoLogText, setLastAutoLogText] = useState("No automatic log entry yet");
  const [offlineCacheArmed, setOfflineCacheArmed] = useState(true);
  const [coastlineMode, setCoastlineMode] = useState("Hybrid geometry + island anchors");
  const [routeName, setRouteName] = useState("No route loaded");
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [activeWaypointIndex, setActiveWaypointIndex] = useState(1);
  const [legMode, setLegMode] = useState<"auto" | "manual">("auto");
  const [routeLoadStatus, setRouteLoadStatus] = useState("No route loaded. Import an RTZ/XML route when ready.");
  const [ownShip, setOwnShip] = useState<AisOwnShip | null>(null);
  const [aisStatus, setAisStatus] = useState("Waiting for AIS WebSocket…");
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherStatusText, setWeatherStatusText] = useState("Weather not loaded yet");

  const safeActiveIndex = Math.min(Math.max(activeWaypointIndex, 1), Math.max(route.length - 1, 1));
  const autoLeg = logicalRouteLeg(route, ownShip, safeActiveIndex);
  const manualLeg = selectedRouteLeg(route, ownShip, safeActiveIndex);
  const activeLeg = legMode === "auto" ? autoLeg || manualLeg : manualLeg || autoLeg;
  const routeFallback: Waypoint = route[0] || {
    id: "--",
    name: "No route loaded",
    lat: ownShip?.lat ?? 0,
    lon: ownShip?.lon ?? 0,
  };
  const activeLegStart = activeLeg?.start || route[safeActiveIndex - 1] || routeFallback;
  const activeLegEnd = activeLeg?.end || route[safeActiveIndex] || routeFallback;
  const absXte = activeLeg?.distance ?? null;
  const side = activeLeg?.side ?? "--";
  const dtg = remainingRouteDistanceNm(route, activeLeg);
  const etaHours = dtg && ownShip?.sog ? dtg / Math.max(ownShip.sog, 0.1) : null;
  const legBearing = activeLeg ? bearingDeg(activeLegStart.lat, activeLegStart.lon, activeLegEnd.lat, activeLegEnd.lon) : null;
  const destination = route[route.length - 1] || routeFallback;
  const coastlinePro = computeCoastlinePro(ownShip, coastlineMode, route);

  const statusItems = useMemo(() => {
    const xteStatus = absXte === null ? "AMBER" : absXte > corridorNm ? "RED" : absXte > corridorNm * 0.65 ? "AMBER" : "NORMAL";
    const aisHealthy = !!ownShip && Date.now() - ownShip.lastSeen < 15000;
    return [
      { label: "AIS Feed", value: aisHealthy ? "LIVE AIS" : "WAITING", status: aisHealthy ? "NORMAL" : "AMBER" },
      { label: "Route Loaded", value: `${route.length} WPTS`, status: "NORMAL" },
      { label: "Weather Current", value: weather ? weather.status : "WAITING", status: weather?.status === "RED" ? "RED" : weather?.status === "AMBER" ? "AMBER" : weather ? "NORMAL" : "AMBER" },
      { label: "XTE Monitor", value: absXte === null ? "WAITING FOR AIS" : `${formatNm(absXte)} NM ${side}`, status: xteStatus },
      { label: "ENC Layer", value: encLayerOn ? "ON" : "OFF", status: encLayerOn ? "NORMAL" : "AMBER" },
      { label: "Coastline Pro", value: coastlinePro?.risk || "WAITING", status: coastlinePro?.status || "AMBER" },
      { label: "Offline Cache", value: offlineCacheArmed ? "ARMED" : "OFF", status: offlineCacheArmed ? "NORMAL" : "AMBER" },
    ];
  }, [absXte, aisStatus, coastlinePro, corridorNm, encLayerOn, offlineCacheArmed, ownShip, route.length, side, weather]);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(!!document.fullscreenElement);
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);

    try {
      const saved = window.localStorage.getItem(WATCH_LOG_KEY);
      if (saved) {
        const parsedRows = JSON.parse(saved);
        setWatchLog(parsedRows);
        if (parsedRows?.[0]?.timeUtc) {
          lastAutoLogHourRef.current = String(parsedRows[0].timeUtc).slice(0, 13);
          setLastAutoLogText(`Last saved entry: ${parsedRows[0].timeUtc}`);
        }
      }
    } catch {
      setWatchLog([]);
    }

    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WATCH_LOG_KEY, JSON.stringify(watchLog.slice(0, 36)));
  }, [watchLog]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.hostname}:8081`);

    ws.onopen = () => setAisStatus("AIS WebSocket connected");
    ws.onerror = () => setAisStatus("AIS WebSocket error");
    ws.onclose = () => setAisStatus("AIS WebSocket closed");
    ws.onmessage = (event) => {
      try {
        let msg: any = event.data;

        try {
          msg = JSON.parse(event.data);
        } catch {
          // Some feeds may send plain NMEA text instead of JSON.
        }

        const line = extractNmeaLine(msg);
        const decoded = line ? decodeOwnShip(line) : ownShipFromParsedMessage(msg);

        if (!decoded) {
          if (line && !line.startsWith("!AIVDO")) setAisStatus("AIS feed active, waiting for own ship AIVDO");
          return;
        }

        setOwnShip(decoded);
        setAisStatus("Live AIS position active");
      } catch {
        // Ignore malformed WebSocket messages.
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    if (legMode !== "auto" || !autoLeg) return;
    if (autoLeg.index !== activeWaypointIndex) {
      setActiveWaypointIndex(autoLeg.index);
    }
  }, [activeWaypointIndex, autoLeg?.index, legMode]);

  async function refreshWeather() {
    setWeatherLoading(true);
    setWeatherStatusText("Refreshing weather…");

    try {
      const wxUrl = ownShip
        ? `/api/wx?lat=${encodeURIComponent(ownShip.lat)}&lon=${encodeURIComponent(ownShip.lon)}`
        : "/api/wx";
      const response = await fetch(wxUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Weather API returned ${response.status}`);

      const data = await response.json();
      const snapshot = normalizeWeatherSnapshot(data);
      setWeather(snapshot);
      setWeatherStatusText(`Weather updated ${new Date(snapshot.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Weather API unavailable";
      setWeather({
        status: "UNKNOWN",
        summary: "Weather is unavailable on this test page. Confirm /api/wx is running.",
        wind: "--",
        seas: "--",
        source: "NavDash /api/wx",
        updated: new Date().toISOString(),
        error: message,
      });
      setWeatherStatusText(message);
    } finally {
      setWeatherLoading(false);
    }
  }

  useEffect(() => {
    refreshWeather();
    const timer = window.setInterval(refreshWeather, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ownShip || weatherLoadedFromLiveAisRef.current) return;

    weatherLoadedFromLiveAisRef.current = true;
    refreshWeather();
  }, [ownShip?.lat, ownShip?.lon]);

  useEffect(() => {
    let cancelled = false;

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

      const map = L.map("v12-map", {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      }).setView([13.4443, 144.7937], 8);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      seamarkLayerRef.current = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      encLayerRef.current = L.tileLayer.wms(
        "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer",
        {
          layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
          format: "image/png",
          transparent: true,
          version: "1.1.1",
          opacity: 0.9,
          attribution: "NOAA ENC Display Service",
        } as any,
      ).addTo(map);

      const routeLatLngs = route.map((wp) => [wp.lat, wp.lon]);
      routeLayerRef.current = L.polyline(routeLatLngs as any, {
        color: "#c9a227",
        weight: 4,
        opacity: 0.95,
      }).addTo(map);

      route.forEach((wp) => {
        L.circleMarker([wp.lat, wp.lon], {
          radius: 5,
          color: "#c9a227",
          fillColor: "#c9a227",
          fillOpacity: 0.85,
          weight: 2,
        })
          .bindTooltip(`${wp.id} ${wp.name}`, { permanent: false })
          .addTo(map);
      });

      try {
        const bounds = L.latLngBounds(routeLatLngs as any);
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: 10 });
      } catch {
        map.setView([13.4443, 144.7937], 8);
      }

      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 300);
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        ownMarkerRef.current = null;
      }
    };
  }, [route]);

  useEffect(() => {
    async function updateOwnShipMarker() {
      const map = mapRef.current;
      if (!map || !ownShip) return;

      const L = await import("leaflet");
      const position: [number, number] = [ownShip.lat, ownShip.lon];

      if (!ownMarkerRef.current) {
        ownMarkerRef.current = L.circleMarker(position, {
          radius: 9,
          color: "#22d3ee",
          fillColor: "#22d3ee",
          fillOpacity: 0.85,
          weight: 2,
        })
          .bindTooltip("Own Ship AIS", { permanent: false })
          .addTo(map);
      } else {
        ownMarkerRef.current.setLatLng(position);
      }

      // Do not auto-pan here. The watch should be able to freely inspect the chart.
      // Use the Center Own Ship button when recentering is desired.
    }

    updateOwnShipMarker();
  }, [ownShip?.lat, ownShip?.lon, route.length, routeName]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !encLayerRef.current) return;

    if (encLayerOn && !map.hasLayer(encLayerRef.current)) {
      encLayerRef.current.addTo(map);
    }

    if (!encLayerOn && map.hasLayer(encLayerRef.current)) {
      map.removeLayer(encLayerRef.current);
    }
  }, [encLayerOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !seamarkLayerRef.current) return;

    if (seamarksOn && !map.hasLayer(seamarkLayerRef.current)) {
      seamarkLayerRef.current.addTo(map);
    }

    if (!seamarksOn && map.hasLayer(seamarkLayerRef.current)) {
      map.removeLayer(seamarkLayerRef.current);
    }
  }, [seamarksOn]);

  async function handleRtzLoad(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const xmlText = await file.text();
      const parsed = parseRtzRoute(xmlText);
      setRoute(parsed.waypoints);
      setRouteName(parsed.routeName || file.name.replace(/\.(rtz|xml)$/i, ""));
      setActiveWaypointIndex(1);
      setLegMode("auto");
      setRouteLoadStatus(`Loaded ${parsed.waypoints.length} waypoints from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load RTZ route.";
      setRouteLoadStatus(message);
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        window.localStorage.setItem(FULLSCREEN_PREF_KEY, "true");
        await document.documentElement.requestFullscreen?.();
      } else {
        window.localStorage.setItem(FULLSCREEN_PREF_KEY, "false");
        await document.exitFullscreen?.();
      }
    } catch {
      // Browser may block fullscreen unless triggered by a user gesture.
    } finally {
      setTimeout(() => mapRef.current?.invalidateSize(), 400);
    }
  }

  function preserveFullscreenPreference() {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      window.localStorage.setItem(FULLSCREEN_PREF_KEY, "true");
    }
  }

  function centerOwnShip() {
    if (!ownShip || !mapRef.current) return;
    mapRef.current.panTo([ownShip.lat, ownShip.lon], { animate: true, duration: 0.5 });
  }

  function createWatchLogEntry(reason: "manual" | "auto") {
    if (!ownShip || absXte === null) {
      setAisStatus("Waiting for live AIS before logging position");
      return false;
    }

    const now = new Date();
    const row: WatchLogRow = {
      id: crypto.randomUUID?.() || String(Date.now()),
      timeUtc: now.toISOString().slice(0, 19).replace("T", " ") + " UTC",
      lat: ownShip.lat,
      lon: ownShip.lon,
      cog: ownShip.cog,
      sog: ownShip.sog,
      heading: ownShip.heading ?? 0,
      activeLeg: `${activeLegStart.id} → ${activeLegEnd.id}`,
      dtg: dtg || 0,
      xte: absXte,
      weather: weather?.status || "UNKNOWN",
    };

    setWatchLog((rows) => [row, ...rows].slice(0, 36));

    if (reason === "auto") {
      lastAutoLogHourRef.current = watchLogHourKey(now);
      setLastAutoLogText(`Last automatic entry: ${row.timeUtc}`);
    }

    return true;
  }

  function addWatchLogEntry() {
    createWatchLogEntry("manual");
  }

  useEffect(() => {
    if (!autoLogEnabled || !ownShip || absXte === null) return;

    const currentHour = watchLogHourKey();
    if (lastAutoLogHourRef.current === currentHour) return;

    createWatchLogEntry("auto");
  }, [autoLogEnabled, ownShip?.lat, ownShip?.lon, absXte, activeLegStart.id, activeLegEnd.id, weather?.status]);

  function exportWatchLogCsv() {
    const header = ["Time UTC", "Lat", "Lon", "COG", "SOG", "Heading", "Active Leg", "DTG NM", "XTE NM", "Weather"];
    const rows = watchLog.map((row) => [
      row.timeUtc,
      formatDdm(row.lat, true),
      formatDdm(row.lon, false),
      row.cog.toFixed(1),
      row.sog.toFixed(1),
      row.heading.toFixed(1),
      row.activeLeg,
      row.dtg.toFixed(2),
      row.xte.toFixed(2),
      row.weather,
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `navdash-watch-log-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const pageClass = dayMode
    ? "min-h-screen bg-white text-slate-950"
    : "min-h-screen bg-[#071019] text-slate-100";
  const panelClass = dayMode
    ? "rounded-[2rem] border border-slate-300 bg-white p-5 shadow-xl shadow-slate-900/10"
    : "rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl";
  const softPanelClass = dayMode
    ? "rounded-3xl border border-slate-300 bg-slate-50 p-4"
    : "rounded-3xl border border-white/10 bg-black/25 p-4";
  const labelClass = dayMode
    ? "text-xs font-black uppercase tracking-[0.22em] text-slate-500"
    : "text-xs font-black uppercase tracking-[0.22em] text-slate-400";
  const mutedClass = dayMode ? "text-slate-600" : "text-slate-400";

  function goToPanel(key: string) {
    setActivePanel(key);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionIds[key as keyof typeof sectionIds])?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function statusClass(status: string) {
    if (status === "RED") return "border-red-500 bg-red-500 text-black";
    if (status === "AMBER") return "border-amber-500 bg-amber-400 text-black";
    return "border-emerald-500 bg-emerald-400 text-black";
  }

  return (
    <main className={pageClass}>
      <div
        className={
          dayMode
            ? "absolute inset-0 bg-white"
            : "absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(201,162,39,.28),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.12),transparent_28%),linear-gradient(135deg,#071019,#101c2b_48%,#071019)]"
        }
      />

      <style jsx global>{`
        .navdash-v12-day .leaflet-container {
          background: #e2e8f0;
        }
        .navdash-v12-night .leaflet-container {
          background: #071019;
          filter: saturate(0.88) brightness(0.82);
        }
      `}</style>

      <div className={`relative z-10 min-h-screen p-5 2xl:p-7 ${dayMode ? "navdash-v12-day" : "navdash-v12-night"}`}>
        <header className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-xl shadow-2xl shadow-black/35">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-3xl border border-wardGold/45 bg-wardGold/15 text-3xl font-black text-wardGold">
                N
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.42em] text-wardGold">M/V MB480</div>
                <h1 className={dayMode ? "text-4xl font-black tracking-tight text-slate-950 2xl:text-5xl" : "text-4xl font-black tracking-tight text-white 2xl:text-5xl"}>
                  NavDash v1.2 
                </h1>
                <div className={dayMode ? "mt-1 text-sm text-slate-700" : "mt-1 text-sm text-slate-300"}>
                  Chart awareness + watch log + route monitoring prototype
                </div>
                <div className={dayMode ? "mt-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500" : "mt-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-400"}>
                  {routeLoadStatus}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <label className="inline-flex h-12 w-[156px] flex-none cursor-pointer items-center justify-center whitespace-nowrap rounded-2xl border border-wardGold/40 bg-wardGold px-4 text-sm font-black text-[#111827] shadow-lg shadow-wardGold/10 hover:brightness-110">
                Load RTZ
                <input type="file" accept=".rtz,.xml" onChange={handleRtzLoad} className="hidden" />
              </label>
              <Link
                href="/"
                onClick={preserveFullscreenPreference}
                className="inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 hover:bg-white/15"
              >
                NavDash
              </Link>
              <button onClick={toggleFullscreen} className="inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 hover:bg-white/15">
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <button onClick={toggleTheme} className="inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 hover:bg-white/15">
                {dayMode ? "Bridge Night" : "Day Mode"}
              </button>
            </div>
          </div>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {[
            ["chart", "Chart Awareness"],
            ["route", "Route Monitor"],
            ["watch", "Watch Log"],
            ["weather", "Weather"],
            ["status", "Status Board"],
            ["offline", "Offline Mode"],
            ["coast", "Coastline Pro"],
            ["build", "Build Info"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => goToPanel(key)}
              className={
                activePanel === key
                  ? "rounded-2xl border border-wardGold/50 bg-wardGold px-3 py-3 text-sm font-black text-[#111827]"
                  : dayMode
                    ? "rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm font-black text-slate-800 hover:bg-slate-50"
                    : "rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-black text-slate-100 hover:bg-white/15"
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[2.1fr_.75fr]">
          <section id="v12-section-chart" className={panelClass}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className={labelClass}>ENC Awareness Layer</div>
                <h2 className={dayMode ? "mt-1 text-3xl font-black text-slate-950" : "mt-1 text-3xl font-black text-white"}>
                  Chart-style prototype display
                </h2>
                <p className={`mt-1 text-sm ${mutedClass}`}>
                  Awareness-only basemap with OSM, seamarks, and NOAA ENC WMS where NOAA coverage exists, including U.S. waters such as Guam.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setEncLayerOn((v) => !v)}
                  className={encLayerOn ? "rounded-2xl border border-emerald-600 bg-emerald-400 px-4 py-3 text-sm font-black text-black" : "rounded-2xl border border-slate-400 bg-slate-200 px-4 py-3 text-sm font-black text-slate-900"}
                >
                  ENC Layer {encLayerOn ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => setSeamarksOn((v) => !v)}
                  className={seamarksOn ? "rounded-2xl border border-cyan-600 bg-cyan-300 px-4 py-3 text-sm font-black text-black" : "rounded-2xl border border-slate-400 bg-slate-200 px-4 py-3 text-sm font-black text-slate-900"}
                >
                  Seamarks {seamarksOn ? "ON" : "OFF"}
                </button>
                <button
                  onClick={centerOwnShip}
                  disabled={!ownShip}
                  className={ownShip ? "rounded-2xl border border-wardGold/40 bg-wardGold px-4 py-3 text-sm font-black text-black" : "rounded-2xl border border-slate-400 bg-slate-200 px-4 py-3 text-sm font-black text-slate-500"}
                >
                  Center Own Ship
                </button>
              </div>
            </div>

            <div id="v12-map" className="h-[700px] min-h-[62vh] overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/30" />

            <div className={dayMode ? "mt-4 rounded-3xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" : "mt-4 rounded-3xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100"}>
              <span className="font-black">Prototype note:</span> This is not an ECDIS, not approved for navigation, and not a chart carriage product. It is a visual test bed for deciding whether an ENC awareness layer belongs in v1.2.
            </div>
          </section>

          <aside className="grid gap-5">
            <section id="v12-section-route" className={panelClass}>
              <div className={labelClass}>Voyage Snapshot</div>
              <div className="mt-4 grid gap-3">
                <div className={softPanelClass}>
                  <div className={labelClass}>Route / Destination</div>
                  <div className="mt-2 text-xl font-black text-wardGold">{routeName}</div>
                  <div className={dayMode ? "mt-1 text-sm font-bold text-slate-700" : "mt-1 text-sm font-bold text-slate-300"}>{destination.name}</div>
                </div>
                <div className={softPanelClass}>
                  <div className={labelClass}>Own Ship Position</div>
                  <div className={ownShip ? "mt-2 text-lg font-black text-emerald-400" : "mt-2 text-xl font-black text-amber-400"}>
                    {ownShip ? formatPositionDdm(ownShip.lat, ownShip.lon) : "Waiting for AIS"}
                  </div>
                  <div className={`mt-1 text-xs ${mutedClass}`}>
                    {ownShip
                      ? `${ownShip.sog.toFixed(1)} kt / ${ownShip.cog.toFixed(1)}° COG / HDG ${ownShip.heading === null ? "--" : `${ownShip.heading.toFixed(0)}°`}`
                      : aisStatus}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className={softPanelClass}>
                    <div className={labelClass}>DTG</div>
                    <div className="mt-2 text-2xl font-black text-wardGold">{formatNm(dtg)}</div>
                    <div className={`text-xs ${mutedClass}`}>NM</div>
                  </div>
                  <div className={softPanelClass}>
                    <div className={labelClass}>ETA</div>
                    <div className={dayMode ? "mt-2 text-2xl font-black text-slate-950" : "mt-2 text-2xl font-black text-white"}>{formatHours(etaHours)}</div>
                  </div>
                  <div className={softPanelClass}>
                    <div className={labelClass}>XTE</div>
                    <div className={absXte === null ? "mt-2 text-2xl font-black text-amber-400" : absXte > corridorNm ? "mt-2 text-2xl font-black text-red-500" : "mt-2 text-2xl font-black text-emerald-400"}>
                      {absXte === null ? "Waiting" : `${formatNm(absXte)} ${side}`}
                    </div>
                  </div>
                  <div className={softPanelClass}>
                    <div className={labelClass}>Leg BRG</div>
                    <div className={dayMode ? "mt-2 text-2xl font-black text-slate-950" : "mt-2 text-2xl font-black text-white"}>{legBearing === null ? "--" : `${legBearing.toFixed(1)}°T`}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className={panelClass}>
              <div className={labelClass}>Active Leg Control</div>
              <div className="mt-3 rounded-3xl border border-wardGold/30 bg-wardGold/10 p-4">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-wardGold">
                  {activeLegStart.id} → {activeLegEnd.id}
                </div>
                <div className={dayMode ? "mt-2 text-sm font-bold text-slate-800" : "mt-2 text-sm font-bold text-slate-200"}>
                  {activeLegStart.name} → {activeLegEnd.name}
                </div>
                <div className={`mt-1 text-xs ${mutedClass}`}>
                  Mode: {legMode === "auto" ? "Auto logical leg" : "Manual selected leg"}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3">
                <button
                  onClick={() => {
                    setLegMode("manual");
                    setActiveWaypointIndex((idx) => Math.max(1, idx - 1));
                  }}
                  className={dayMode ? "rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm font-black text-slate-900" : "rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-black text-slate-100"}
                >
                  Prev Leg
                </button>
                <button
                  onClick={() => setLegMode((mode) => (mode === "auto" ? "manual" : "auto"))}
                  className="rounded-2xl border border-wardGold/40 bg-wardGold px-3 py-3 text-sm font-black text-black"
                >
                  {legMode === "auto" ? "Auto" : "Manual"}
                </button>
                <button
                  onClick={() => {
                    setLegMode("manual");
                    setActiveWaypointIndex((idx) => Math.max(1, Math.min(Math.max(route.length - 1, 1), idx + 1)));
                  }}
                  className={dayMode ? "rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm font-black text-slate-900" : "rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-black text-slate-100"}
                >
                  Next Leg
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4">
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={corridorNm}
                  onChange={(e) => setCorridorNm(Number(e.target.value))}
                  className="w-full"
                />
                <div className="w-20 rounded-2xl border border-wardGold/40 bg-wardGold px-3 py-2 text-center text-sm font-black text-black">
                  {corridorNm.toFixed(1)} NM
                </div>
              </div>
              <p className={`mt-3 text-sm leading-6 ${mutedClass}`}>
                Auto mode picks the most logical route leg from live AIS position. Manual mode lets the watch advance or back up the active leg.
              </p>
            </section>
          </aside>
        </div>

        <section className="mt-5 grid gap-5 xl:grid-cols-3">
          <div id="v12-section-watch" className={panelClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={labelClass}>Watch Log</div>
                <h3 className={dayMode ? "mt-1 text-2xl font-black text-slate-950" : "mt-1 text-2xl font-black text-white"}>Hourly auto position log</h3>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={addWatchLogEntry} className="rounded-2xl border border-wardGold/40 bg-wardGold px-4 py-3 text-sm font-black text-black">Add Entry</button>
                <button
                  onClick={() => setAutoLogEnabled((value) => !value)}
                  className={autoLogEnabled ? "rounded-2xl border border-emerald-700 bg-emerald-400 px-4 py-3 text-sm font-black text-black" : "rounded-2xl border border-amber-700 bg-amber-400 px-4 py-3 text-sm font-black text-black"}
                >
                  Auto Log {autoLogEnabled ? "ON" : "OFF"}
                </button>
                <button onClick={exportWatchLogCsv} className={dayMode ? "rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-black text-slate-900" : "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-slate-100"}>Export CSV</button>
              </div>
            </div>
            <div className={dayMode ? "mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-3 text-xs font-bold text-slate-700" : "mt-4 rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-xs font-bold text-slate-300"}>
              Automatic logbook: one entry per UTC hour when live AIS and active-leg data are available. {lastAutoLogText}
            </div>

            <div className="mt-4 max-h-72 overflow-auto rounded-3xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className={dayMode ? "bg-slate-100 text-slate-600" : "bg-black/35 text-slate-300"}>
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">Position</th>
                    <th className="p-3">SOG/COG</th>
                    <th className="p-3">Leg</th>
                    <th className="p-3">DTG</th>
                    <th className="p-3">XTE</th>
                  </tr>
                </thead>
                <tbody>
                  {watchLog.length === 0 ? (
                    <tr><td colSpan={6} className={`p-4 text-center ${mutedClass}`}>No test entries yet.</td></tr>
                  ) : (
                    watchLog.map((row) => (
                      <tr key={row.id} className={dayMode ? "border-t border-slate-200" : "border-t border-white/10"}>
                        <td className="p-3">{row.timeUtc}</td>
                        <td className="p-3">{formatPositionDdm(row.lat, row.lon)}</td>
                        <td className="p-3">{row.sog.toFixed(1)} kt / {row.cog.toFixed(1)}°</td>
                        <td className="p-3">{row.activeLeg}</td>
                        <td className="p-3">{row.dtg.toFixed(2)} NM</td>
                        <td className="p-3">{row.xte.toFixed(2)} NM</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div id="v12-section-weather" className={panelClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={labelClass}>Weather</div>
                <h3 className={dayMode ? "mt-1 text-2xl font-black text-slate-950" : "mt-1 text-2xl font-black text-white"}>Live weather feed</h3>
              </div>
              <button
                onClick={refreshWeather}
                disabled={weatherLoading}
                className="rounded-2xl border border-wardGold/40 bg-wardGold px-4 py-3 text-sm font-black text-black disabled:opacity-60"
              >
                {weatherLoading ? "Refreshing" : "Refresh WX"}
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div className={softPanelClass}>
                <div className={labelClass}>Weather Status</div>
                <div className={
                  weather?.status === "RED"
                    ? "mt-2 text-3xl font-black text-red-500"
                    : weather?.status === "AMBER"
                      ? "mt-2 text-3xl font-black text-amber-400"
                      : weather?.status === "NORMAL"
                        ? "mt-2 text-3xl font-black text-emerald-400"
                        : "mt-2 text-3xl font-black text-slate-400"
                }>
                  {weather?.status || "WAITING"}
                </div>
                <div className={`mt-1 text-xs ${mutedClass}`}>{weatherStatusText}</div>
                <div className={`mt-1 text-xs ${mutedClass}`}>Stable WX thresholds: Amber 25 kt / 10 ft, Red 35 kt / 15 ft</div>
                <div className={`mt-1 text-xs ${mutedClass}`}>Refresh cadence: page load, first live AIS fix, manual refresh, then every 15 minutes</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={softPanelClass}>
                  <div className={labelClass}>Wind</div>
                  <div className="mt-2 text-xl font-black text-wardGold">{weather?.wind || "--"}</div>
                </div>
                <div className={softPanelClass}>
                  <div className={labelClass}>Seas</div>
                  <div className="mt-2 text-xl font-black text-wardGold">{weather?.seas || "--"}</div>
                </div>
              </div>

              <div className={softPanelClass}>
                <div className={labelClass}>Bridge Summary</div>
                <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>{weather?.summary || "Waiting for weather API…"}</p>
              </div>

              <div className={softPanelClass}>
                <div className={labelClass}>Source</div>
                <div className="mt-2 text-sm font-bold">{weather?.source || "NavDash /api/wx"}</div>
                {weather?.error && <div className="mt-2 text-xs font-bold text-amber-400">{weather.error}</div>}
              </div>
            </div>
          </div>

          <div id="v12-section-status" className={panelClass}>
            <div className={labelClass}>Status Board</div>
            <h3 className={dayMode ? "mt-1 text-2xl font-black text-slate-950" : "mt-1 text-2xl font-black text-white"}>Bridge goblin checklist</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {statusItems.map((item) => (
                <div key={item.label} className={softPanelClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={labelClass}>{item.label}</div>
                      <div className="mt-1 text-xl font-black">{item.value}</div>
                    </div>
                    <div className={`rounded-2xl border px-3 py-2 text-xs font-black ${statusClass(item.status)}`}>
                      {item.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-3">
          <div id="v12-section-offline" className={panelClass}>
            <div className={labelClass}>Offline Mode</div>
            <h3 className="mt-1 text-2xl font-black">Cache readiness</h3>
            <button
              onClick={() => setOfflineCacheArmed((v) => !v)}
              className={offlineCacheArmed ? "mt-4 rounded-2xl border border-emerald-700 bg-emerald-400 px-4 py-3 text-sm font-black text-black" : "mt-4 rounded-2xl border border-amber-700 bg-amber-400 px-4 py-3 text-sm font-black text-black"}
            >
              Offline Cache {offlineCacheArmed ? "Armed" : "Off"}
            </button>
            <p className={`mt-4 text-sm leading-6 ${mutedClass}`}>
              Future build target: cache last route, last weather, last coastline/chart package, and last 36 hours of watch log for Starlink/LAN hiccups.
            </p>
          </div>

          <div id="v12-section-coast" className={panelClass}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={labelClass}>Coastline Pro</div>
                <h3 className="mt-1 text-2xl font-black">Range and bearing engine</h3>
              </div>
              <div className={
                coastlinePro?.status === "RED"
                  ? "rounded-2xl border border-red-600 bg-red-500 px-3 py-2 text-xs font-black text-black"
                  : coastlinePro?.status === "AMBER"
                    ? "rounded-2xl border border-amber-600 bg-amber-400 px-3 py-2 text-xs font-black text-black"
                    : coastlinePro?.status === "NORMAL"
                      ? "rounded-2xl border border-emerald-700 bg-emerald-400 px-3 py-2 text-xs font-black text-black"
                      : "rounded-2xl border border-slate-400 bg-slate-300 px-3 py-2 text-xs font-black text-slate-900"
              }>
                {coastlinePro?.risk || "WAITING"}
              </div>
            </div>

            <select
              value={coastlineMode}
              onChange={(e) => setCoastlineMode(e.target.value)}
              className={dayMode ? "mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950" : "mt-4 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white"}
            >
              <option>Hybrid geometry + island anchors</option>
              <option>True coastline geometry only</option>
              <option>Reference anchors only</option>
            </select>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className={softPanelClass}>
                <div className={labelClass}>Range</div>
                <div className="mt-2 text-3xl font-black text-wardGold">
                  {coastlinePro?.nearest ? coastlinePro.nearest.distance.toFixed(1) : "--"}
                </div>
                <div className={`text-xs ${mutedClass}`}>NM to nearest land candidate</div>
              </div>
              <div className={softPanelClass}>
                <div className={labelClass}>Bearing</div>
                <div className={dayMode ? "mt-2 text-3xl font-black text-slate-950" : "mt-2 text-3xl font-black text-white"}>
                  {coastlinePro?.nearest ? `${coastlinePro.nearest.bearing.toFixed(0)}°T` : "--"}
                </div>
                <div className={`text-xs ${mutedClass}`}>bearing from own ship</div>
              </div>
            </div>

            <div className={softPanelClass + " mt-3"}>
              <div className={labelClass}>Nearest Candidate</div>
              <div className="mt-2 text-xl font-black text-wardGold">
                {coastlinePro?.nearest?.name || "Waiting for live AIS"}
              </div>
              <div className={`mt-1 text-xs ${mutedClass}`}>
                {coastlinePro?.nearest ? `${coastlinePro.nearest.source} • ${formatPositionDdm(coastlinePro.nearest.lat, coastlinePro.nearest.lon)}` : "Needs own ship position"}
              </div>
            </div>

            <div className="mt-3 grid gap-3">
              <div className={labelClass}>Closest Five</div>
              {(coastlinePro?.top || []).map((candidate, index) => (
                <div key={`${candidate.name}-${index}`} className={softPanelClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">{candidate.name}</div>
                      <div className={`mt-1 text-xs ${mutedClass}`}>{candidate.source}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-wardGold">{candidate.distance.toFixed(1)} NM</div>
                      <div className={`text-xs ${mutedClass}`}>{candidate.bearing.toFixed(0)}°T</div>
                    </div>
                  </div>
                </div>
              ))}
              {!coastlinePro && (
                <div className={softPanelClass}>
                  <div className="text-sm font-bold text-amber-400">Waiting for live AIS position before calculating coastline range and bearing.</div>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className={softPanelClass}>
                <div className={labelClass}>Data Sources Used Now</div>
                <div className={`mt-3 grid gap-2 text-sm ${mutedClass}`}>
                  <div>Live AIS own ship: {ownShip ? "ACTIVE" : "WAITING"}</div>
                  <div>Island anchors: {coastlinePro?.sources.anchors ?? LAND_REFERENCE_ANCHORS.length}</div>
                  <div>Coastline segments: {coastlinePro?.sources.segments ?? SIMPLIFIED_COASTLINE_SEGMENTS.length}</div>
                  <div>Loaded RTZ waypoints: {route.length}</div>
                </div>
              </div>
              <div className={softPanelClass}>
                <div className={labelClass}>Display / Future Sources</div>
                <div className={`mt-3 grid gap-2 text-sm ${mutedClass}`}>
                  <div>NOAA ENC WMS: display layer only</div>
                  <div>OpenSeaMap seamarks: display layer only</div>
                  <div>Future: full coastline GeoJSON package</div>
                  <div>Future: EEZ / territorial sea overlays</div>
                </div>
              </div>
            </div>

            <p className={`mt-4 text-sm leading-6 ${mutedClass}`}>
              Coastline Pro is an awareness engine only. It combines embedded Pacific island anchors, simplified coastline geometry, loaded route context, and live AIS to estimate range and bearing to the nearest land candidate. It is not a legal baseline or MARPOL discharge authorization.
            </p>
          </div>

          <div id="v12-section-build" className={panelClass}>
            <div className={labelClass}>Build Info</div>
            <h3 className="mt-1 text-2xl font-black">NavDash v1.2 Lab</h3>
            <div className={`mt-4 grid gap-2 text-sm ${mutedClass}`}>
              <div>Build Type: Local prototype page</div>
              <div>Route: /v12-test</div>
              <div>Chart Layer: NOAA ENC WMS staged</div>
              <div>Map: Leaflet + OSM + OpenSeaMap</div>
              <div>Storage: localStorage hourly watch log</div>
              <div>Weather Feed: /api/wx</div>
              <div>Chart Follow: Manual pan with Center Own Ship button</div>
              <div>Coastline Pro: hybrid anchors + simplified geometry</div>
              <div>Navigation Use: Not approved</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
