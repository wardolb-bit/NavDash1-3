"use client";

import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

const FULLSCREEN_PREF_KEY = "navconsole-fullscreen";

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type LoadedRoute = {
  routeName: string;
  waypoints: Waypoint[];
  activeWaypointIndex: number;
};

type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceNm?: number;
};

type TidePoint = {
  time: string;
  valueFt: number;
  type?: string;
};

type TideData = {
  ok: boolean;
  station?: TideStation;
  stations?: TideStation[];
  source?: string;
  datum?: string;
  units?: string;
  hourly?: TidePoint[];
  highLow?: TidePoint[];
  error?: string;
};

type TideChartGrid = {
  height: number;
  y: number;
};

type TideChartTimeTick = {
  label: string;
  x: number;
};

function parseNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatHours(hours: number | null) {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "—";

  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);

  if (minutes === 60) return `${wholeHours + 1}h 00m`;
  return `${wholeHours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatEtaUtc(hoursFromNow: number | null) {
  if (
    hoursFromNow === null ||
    !Number.isFinite(hoursFromNow) ||
    hoursFromNow < 0
  )
    return "—";

  const eta = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const hour = eta.getUTCHours().toString().padStart(2, "0");
  const minute = eta.getUTCMinutes().toString().padStart(2, "0");

  return `${hour}:${minute} UTC`;
}

function formatEtaWithOffset(
  hoursFromNow: number | null,
  offsetHours: number | null,
) {
  if (
    hoursFromNow === null ||
    offsetHours === null ||
    !Number.isFinite(hoursFromNow) ||
    !Number.isFinite(offsetHours) ||
    hoursFromNow < 0
  ) {
    return "—";
  }

  const eta = new Date(
    Date.now() + (hoursFromNow + offsetHours) * 60 * 60 * 1000,
  );
  const hour = eta.getUTCHours().toString().padStart(2, "0");
  const minute = eta.getUTCMinutes().toString().padStart(2, "0");

  return `${hour}:${minute} Local`;
}

function decimalToDdm(value: number | null, type: "lat" | "lon") {
  if (value === null || !Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi =
    type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";

  const width = type === "lat" ? 2 : 3;

  return `${deg.toString().padStart(width, "0")}° ${min.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

function ddmToDecimal(degrees: string, minutes: string, hemisphere: string) {
  const deg = parseNumber(degrees);
  const min = parseNumber(minutes);

  if (deg === null || min === null || min < 0 || min >= 60) return null;

  const sign = ["S", "W"].includes(hemisphere.toUpperCase()) ? -1 : 1;
  return sign * (Math.abs(deg) + min / 60);
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

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeRoutePayload(payload: any): LoadedRoute | null {
  const rawWaypoints = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  const waypoints = rawWaypoints
    .map((wp: any, index: number) => {
      const lat = Number(wp?.lat ?? wp?.latitude);
      const lon = Number(wp?.lon ?? wp?.lng ?? wp?.longitude);

      return {
        id:
          typeof wp?.id === "string" && wp.id.trim()
            ? wp.id.trim()
            : `WP${String(index + 1).padStart(2, "0")}`,
        name:
          typeof wp?.name === "string" && wp.name.trim()
            ? wp.name.trim()
            : `Waypoint ${index + 1}`,
        lat,
        lon,
      };
    })
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

  if (waypoints.length < 2) return null;

  const activeWaypointIndexRaw = Number(payload?.activeWaypointIndex);
  const activeWaypointIndex = Number.isFinite(activeWaypointIndexRaw)
    ? Math.max(1, Math.min(Math.round(activeWaypointIndexRaw), waypoints.length - 1))
    : 1;

  return {
    routeName:
      typeof payload?.routeName === "string" && payload.routeName.trim()
        ? payload.routeName.trim()
        : "Loaded RTZ Route",
    waypoints,
    activeWaypointIndex,
  };
}

function distanceToRouteWaypointNm(
  route: Waypoint[],
  targetWaypointIndex: number,
  ownShipLat: number | null,
  ownShipLon: number | null,
) {
  if (
    route.length < 2 ||
    ownShipLat === null ||
    ownShipLon === null ||
    !Number.isFinite(ownShipLat) ||
    !Number.isFinite(ownShipLon)
  ) {
    return null;
  }

  const targetIndex = Math.max(0, Math.min(targetWaypointIndex, route.length - 1));
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLegIndex = 0;
  let bestDistanceToLegEnd = 0;

  for (let i = 0; i < targetIndex; i += 1) {
    const start = route[i];
    const end = route[i + 1];
    const legLength = distanceNm(start.lat, start.lon, end.lat, end.lon);
    if (legLength <= 0) continue;

    const x = (ownShipLon - start.lon) * Math.cos(toRad((ownShipLat + start.lat) / 2));
    const y = ownShipLat - start.lat;
    const legX = (end.lon - start.lon) * Math.cos(toRad((start.lat + end.lat) / 2));
    const legY = end.lat - start.lat;
    const legLengthSquared = legX * legX + legY * legY;
    const projectionRatio =
      legLengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, (x * legX + y * legY) / legLengthSquared));
    const crossTrackNm = distanceNm(
      ownShipLat,
      ownShipLon,
      start.lat + (end.lat - start.lat) * projectionRatio,
      start.lon + (end.lon - start.lon) * projectionRatio,
    );

    if (crossTrackNm < bestDistance) {
      bestDistance = crossTrackNm;
      bestLegIndex = i;
      bestDistanceToLegEnd = Math.max(0, legLength * (1 - projectionRatio));
    }
  }

  let total = bestDistanceToLegEnd;
  for (let i = bestLegIndex + 1; i < targetIndex; i += 1) {
    total += distanceNm(route[i].lat, route[i].lon, route[i + 1].lat, route[i + 1].lon);
  }

  return total;
}

function formatBearing(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${normalizeDegrees(value).toFixed(1)}°`;
}

function formatDateTimeUtc(date: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return "—";
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  return `${hour}:${minute} UTC`;
}

function formatDateTimeWithOffset(
  date: Date | null,
  offsetHours: number | null,
) {
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    offsetHours === null ||
    !Number.isFinite(offsetHours)
  )
    return "—";
  const adjusted = new Date(date.getTime() + offsetHours * 60 * 60 * 1000);
  const hour = adjusted.getUTCHours().toString().padStart(2, "0");
  const minute = adjusted.getUTCMinutes().toString().padStart(2, "0");
  return `${hour}:${minute} Local`;
}

function parseUtcDateTime(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) return null;
  const d = new Date(`${dateValue}T${timeValue}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRequiredSpeedTimeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function normalizeClockTime(value: string) {
  const trimmed = value.trim();
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  const digitsOnly = trimmed.replace(/\D/g, "");

  let hour: number;
  let minute: number;

  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
  } else if (digitsOnly.length === 3) {
    hour = Number(digitsOnly.slice(0, 1));
    minute = Number(digitsOnly.slice(1));
  } else if (digitsOnly.length === 4) {
    hour = Number(digitsOnly.slice(0, 2));
    minute = Number(digitsOnly.slice(2));
  } else {
    return null;
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

function parseLocalDateTimeWithOffset(
  dateValue: string,
  timeValue: string,
  offsetHours: number | null,
) {
  if (!dateValue || !timeValue || offsetHours === null || !Number.isFinite(offsetHours)) {
    return null;
  }

  const normalizedTime = normalizeClockTime(timeValue);
  if (!normalizedTime) return null;

  const localAsUtc = new Date(`${dateValue}T${normalizedTime}:00Z`);
  if (Number.isNaN(localAsUtc.getTime())) return null;

  return new Date(localAsUtc.getTime() - offsetHours * 60 * 60 * 1000);
}

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      start) /
      86400000,
  );
}

function calcSunUtcMinutes(
  date: Date,
  lat: number,
  lon: number,
  sunrise: boolean,
) {
  const zenith = 90.833;
  const n = dayOfYear(date);
  const lngHour = lon / 15;
  const t = sunrise ? n + (6 - lngHour) / 24 : n + (18 - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l =
    m + 1.916 * Math.sin(toRad(m)) + 0.02 * Math.sin(toRad(2 * m)) + 282.634;
  l = normalizeDegrees(l);
  let ra = toDeg(Math.atan(0.91764 * Math.tan(toRad(l))));
  ra = normalizeDegrees(ra);
  const lQuadrant = Math.floor(l / 90) * 90;
  const raQuadrant = Math.floor(ra / 90) * 90;
  ra = (ra + lQuadrant - raQuadrant) / 15;
  const sinDec = 0.39782 * Math.sin(toRad(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH =
    (Math.cos(toRad(zenith)) - sinDec * Math.sin(toRad(lat))) /
    (cosDec * Math.cos(toRad(lat)));
  if (cosH > 1 || cosH < -1) return null;
  const h = sunrise ? 360 - toDeg(Math.acos(cosH)) : toDeg(Math.acos(cosH));
  const hours = h / 15;
  const localMean = hours + ra - 0.06571 * t - 6.622;
  return ((localMean - lngHour) * 60 + 1440) % 1440;
}

function minutesToUtcDate(date: Date, minutes: number | null) {
  if (minutes === null) return null;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      Math.round(minutes),
    ),
  );
}

function aisPayloadToBits(payload: string) {
  let bits = "";
  for (const ch of payload) {
    let v = ch.charCodeAt(0) - 48;
    if (v > 40) v -= 8;
    bits += v.toString(2).padStart(6, "0");
  }
  return bits;
}

function readUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function readSigned(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const unsigned = parseInt(raw, 2);
  if (raw[0] === "1") return unsigned - 2 ** length;
  return unsigned;
}

function parseOwnShipAis(sentence: string) {
  const parts = sentence.trim().split(",");
  if (!parts[0]?.includes("AIVDO") || parts.length < 6) return null;
  const bits = aisPayloadToBits(parts[5] || "");
  const type = readUnsigned(bits, 0, 6);

  if (![1, 2, 3, 18, 19].includes(type) || bits.length < 168) return null;

  const sogRaw = readUnsigned(bits, 50, 10);
  const lonRaw = readSigned(bits, 61, 28);
  const latRaw = readSigned(bits, 89, 27);
  const cogRaw = readUnsigned(bits, 116, 12);
  const hdgRaw = readUnsigned(bits, 128, 9);

  const lat = latRaw / 600000;
  const lon = lonRaw / 600000;

  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    lat,
    lon,
    sog: sogRaw === 1023 ? null : sogRaw / 10,
    cog: cogRaw === 3600 ? null : cogRaw / 10,
    heading: hdgRaw === 511 ? null : hdgRaw,
  };
}

function formatTideTime(value?: string) {
  if (!value) return "--";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return value;
  return `${match[4]}:${match[5]}`;
}

function tideChartPolyline(points: TidePoint[]) {
  const clean = points.filter((point) => Number.isFinite(point.valueFt));
  if (clean.length < 2) return "";

  const values = clean.map((point) => point.valueFt);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.1, max - min);

  return clean
    .map((point, index) => {
      const x = 42 + (index / Math.max(1, clean.length - 1)) * 266;
      const y = 104 - ((point.valueFt - min) / span) * 84;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function tideChartHeightGrid(points: TidePoint[]): TideChartGrid[] {
  const values = points.map((point) => point.valueFt).filter(Number.isFinite);
  if (!values.length) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.1, max - min);

  return [max, min + span / 2, min].map((height) => ({
    height,
    y: 104 - ((height - min) / span) * 84,
  }));
}

function tideChartTimeTicks(points: TidePoint[]): TideChartTimeTick[] {
  const clean = points.filter((point) => Number.isFinite(point.valueFt));
  if (clean.length < 2) return [];

  const indexes = Array.from(
    new Set([
      0,
      Math.round((clean.length - 1) * 0.25),
      Math.round((clean.length - 1) * 0.5),
      Math.round((clean.length - 1) * 0.75),
      clean.length - 1,
    ]),
  );

  return indexes.map((index) => ({
    label: formatTideTime(clean[index]?.time),
    x: 42 + (index / Math.max(1, clean.length - 1)) * 266,
  }));
}

function tideChartStats(points: TidePoint[]) {
  const values = points.map((point) => point.valueFt).filter(Number.isFinite);
  if (!values.length) return { min: null as number | null, max: null as number | null };
  return { min: Math.min(...values), max: Math.max(...values) };
}

export default function ToolsPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [stdDistance, setStdDistance] = useState("");
  const [stdSpeed, setStdSpeed] = useState("");
  const [stdTime, setStdTime] = useState("");

  const [etaDistance, setEtaDistance] = useState("");
  const [etaSpeed, setEtaSpeed] = useState("");
  const [etaOffset, setEtaOffset] = useState("");

  const [decimalLat, setDecimalLat] = useState("");
  const [decimalLon, setDecimalLon] = useState("");

  const [ddmLatDeg, setDdmLatDeg] = useState("");
  const [ddmLatMin, setDdmLatMin] = useState("");
  const [ddmLatHemi, setDdmLatHemi] = useState("N");
  const [ddmLonDeg, setDdmLonDeg] = useState("");
  const [ddmLonMin, setDdmLonMin] = useState("");
  const [ddmLonHemi, setDdmLonHemi] = useState("E");

  const [aisLat, setAisLat] = useState<number | null>(null);
  const [aisLon, setAisLon] = useState<number | null>(null);
  const [aisSog, setAisSog] = useState<number | null>(null);
  const [aisCog, setAisCog] = useState<number | null>(null);
  const [aisHeading, setAisHeading] = useState<number | null>(null);
  const [aisStatus, setAisStatus] = useState("Connecting to AIS WebSocket…");

  const [sunDate, setSunDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [watchOffset, setWatchOffset] = useState("0");
  const [tzDate, setTzDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [tzTime, setTzTime] = useState(() =>
    new Date().toISOString().slice(11, 16),
  );
  const [tzOffset, setTzOffset] = useState("0");

  const [reqDistance, setReqDistance] = useState("");
  const [reqDate, setReqDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reqTime, setReqTime] = useState("");
  const [reqOffset, setReqOffset] = useState("0");
  const [reqSource, setReqSource] = useState<"route-end" | "waypoint" | "manual">("route-end");
  const [reqWaypointIndex, setReqWaypointIndex] = useState("1");
  const [loadedRoute, setLoadedRoute] = useState<LoadedRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState("Checking loaded route...");
  const [tideData, setTideData] = useState<TideData | null>(null);
  const [tideStation, setTideStation] = useState("");
  const [tideLookupLat, setTideLookupLat] = useState("");
  const [tideLookupLon, setTideLookupLon] = useState("");
  const [tideLoading, setTideLoading] = useState(false);
  const [tideStatus, setTideStatus] = useState("Enter a position or use AIS to load nearby tide stations.");

  useEffect(() => {
    const updateFullscreenState = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      window.localStorage.setItem(
        FULLSCREEN_PREF_KEY,
        active ? "true" : "false",
      );
    };

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onopen = () => setAisStatus("AIS WebSocket connected");
    ws.onerror = () => setAisStatus("AIS WebSocket error");
    ws.onclose = () => setAisStatus("AIS WebSocket closed");
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "route-state") {
          const route = normalizeRoutePayload(msg);
          if (route) {
            setLoadedRoute(route);
            setReqWaypointIndex((current) => {
              const currentNumber = Number(current);
              const safeIndex = Number.isFinite(currentNumber)
                ? Math.max(1, Math.min(Math.round(currentNumber), route.waypoints.length - 1))
                : route.activeWaypointIndex;
              return String(safeIndex);
            });
            setRouteStatus(`Loaded route: ${route.routeName}`);
          } else {
            setLoadedRoute(null);
            setRouteStatus("Route cleared");
          }
          return;
        }
        const sentence =
          typeof msg === "string"
            ? msg
            : msg?.sentence || msg?.line || msg?.nmea || "";
        if (typeof sentence !== "string") return;
        const ownShip = parseOwnShipAis(sentence);
        if (!ownShip) return;
        setAisLat(ownShip.lat);
        setAisLon(ownShip.lon);
        setAisSog(ownShip.sog);
        setAisCog(ownShip.cog);
        setAisHeading(ownShip.heading);
        setAisStatus("AIS position live");
      } catch {
        const sentence = String(event.data || "");
        const ownShip = parseOwnShipAis(sentence);
        if (!ownShip) return;
        setAisLat(ownShip.lat);
        setAisLon(ownShip.lon);
        setAisSog(ownShip.sog);
        setAisCog(ownShip.cog);
        setAisHeading(ownShip.heading);
        setAisStatus("AIS position live");
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRouteState() {
      try {
        const response = await fetch("/api/route-state", { cache: "no-store" });
        if (!response.ok) throw new Error("Route state unavailable");

        const data = await response.json();
        const route = normalizeRoutePayload(data);

        if (cancelled) return;

        if (route) {
          setLoadedRoute(route);
          setReqWaypointIndex((current) => {
            const currentNumber = Number(current);
            const safeIndex = Number.isFinite(currentNumber)
              ? Math.max(1, Math.min(Math.round(currentNumber), route.waypoints.length - 1))
              : route.activeWaypointIndex;
            return String(safeIndex);
          });
          setRouteStatus(`Loaded route: ${route.routeName}`);
        } else {
          setLoadedRoute(null);
          setRouteStatus("No loaded route found");
        }
      } catch {
        if (!cancelled) {
          setLoadedRoute(null);
          setRouteStatus("Could not read loaded route");
        }
      }
    }

    loadRouteState();
    const interval = window.setInterval(loadRouteState, 30000);
    window.addEventListener("focus", loadRouteState);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", loadRouteState);
    };
  }, []);

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
      // Browser may block fullscreen unless triggered by a user click.
    }
  }

  async function loadTides(stationOverride = tideStation) {
    const lookupLat = parseNumber(tideLookupLat) ?? aisLat;
    const lookupLon = parseNumber(tideLookupLon) ?? aisLon;

    if (lookupLat === null || lookupLon === null) {
      setTideStatus("Enter a lookup position or wait for AIS position.");
      return;
    }

    try {
      setTideLoading(true);
      setTideStatus("Loading tide stations and predictions...");
      const params = new URLSearchParams({
        lat: String(lookupLat),
        lon: String(lookupLon),
      });
      if (stationOverride) params.set("station", stationOverride);

      const response = await fetch(`/api/tides?${params}`, { cache: "no-store" });
      const data = (await response.json()) as TideData;
      if (!response.ok || !data.ok) throw new Error(data.error || `Tide API returned ${response.status}`);

      setTideData(data);
      setTideStation(data.station?.id || stationOverride || "");
      setTideStatus(data.station ? `Loaded ${data.station.name}` : "Tides loaded");
    } catch (error) {
      setTideStatus(error instanceof Error ? error.message : "Could not load tide data.");
    } finally {
      setTideLoading(false);
    }
  }

  const std = useMemo(() => {
    const distance = parseNumber(stdDistance);
    const speed = parseNumber(stdSpeed);
    const time = parseNumber(stdTime);

    const canTime = distance !== null && speed !== null && speed > 0;
    const canDistance = speed !== null && time !== null;
    const canSpeed = distance !== null && time !== null && time > 0;

    return {
      time: canTime ? distance / speed : null,
      distance: canDistance ? speed * time : null,
      speed: canSpeed ? distance / time : null,
    };
  }, [stdDistance, stdSpeed, stdTime]);

  const eta = useMemo(() => {
    const distance = parseNumber(etaDistance);
    const speed = parseNumber(etaSpeed);

    if (distance === null || speed === null || speed <= 0) return null;
    return distance / speed;
  }, [etaDistance, etaSpeed]);

  const etaOffsetHours = parseNumber(etaOffset);

  const decimalLatNumber = parseNumber(decimalLat);
  const decimalLonNumber = parseNumber(decimalLon);

  const ddmLatDecimal = ddmToDecimal(ddmLatDeg, ddmLatMin, ddmLatHemi);
  const ddmLonDecimal = ddmToDecimal(ddmLonDeg, ddmLonMin, ddmLonHemi);

  const watchOffsetHours = parseNumber(watchOffset);
  const tzOffsetHours = parseNumber(tzOffset);
  const tzUtcDate = parseUtcDateTime(tzDate, tzTime);

  const sunCalcDate = new Date(`${sunDate}T00:00:00Z`);
  const sunriseUtc =
    aisLat !== null && aisLon !== null
      ? minutesToUtcDate(
          sunCalcDate,
          calcSunUtcMinutes(sunCalcDate, aisLat, aisLon, true),
        )
      : null;
  const sunsetUtc =
    aisLat !== null && aisLon !== null
      ? minutesToUtcDate(
          sunCalcDate,
          calcSunUtcMinutes(sunCalcDate, aisLat, aisLon, false),
        )
      : null;


  const reqOffsetHours = parseNumber(reqOffset);
  const requiredSpeedTargetUtc = useMemo(
    () => parseLocalDateTimeWithOffset(reqDate, reqTime, reqOffsetHours),
    [reqDate, reqTime, reqOffsetHours],
  );

  const selectedWaypointIndex = useMemo(() => {
    if (!loadedRoute) return 1;
    const parsed = Number(reqWaypointIndex);
    if (!Number.isFinite(parsed)) return loadedRoute.activeWaypointIndex;
    return Math.max(1, Math.min(Math.round(parsed), loadedRoute.waypoints.length - 1));
  }, [loadedRoute, reqWaypointIndex]);

  const selectedWaypoint = loadedRoute?.waypoints[selectedWaypointIndex] || null;

  const routeEndDistance = useMemo(
    () =>
      loadedRoute
        ? distanceToRouteWaypointNm(
            loadedRoute.waypoints,
            loadedRoute.waypoints.length - 1,
            aisLat,
            aisLon,
          )
        : null,
    [loadedRoute, aisLat, aisLon],
  );

  const selectedWaypointDistance = useMemo(
    () =>
      loadedRoute
        ? distanceToRouteWaypointNm(loadedRoute.waypoints, selectedWaypointIndex, aisLat, aisLon)
        : null,
    [loadedRoute, selectedWaypointIndex, aisLat, aisLon],
  );

  const requiredSpeedDistance = useMemo(() => {
    if (reqSource === "manual") return parseNumber(reqDistance);
    if (reqSource === "waypoint") return selectedWaypointDistance;
    return routeEndDistance;
  }, [reqSource, reqDistance, selectedWaypointDistance, routeEndDistance]);

  const requiredSpeedTargetLabel =
    reqSource === "manual"
      ? "Manual distance"
      : reqSource === "waypoint"
        ? selectedWaypoint
          ? `${selectedWaypoint.id} ${selectedWaypoint.name}`
          : "Selected waypoint"
        : loadedRoute?.waypoints.length
          ? `${loadedRoute.waypoints[loadedRoute.waypoints.length - 1].id} ${
              loadedRoute.waypoints[loadedRoute.waypoints.length - 1].name
            }`
          : "Final waypoint";

  const requiredSpeed = useMemo(() => {
    const distance = requiredSpeedDistance;
    if (distance === null || distance < 0 || !requiredSpeedTargetUtc) return null;
    const hours = (requiredSpeedTargetUtc.getTime() - Date.now()) / 3600000;
    if (hours <= 0) return null;
    return distance / hours;
  }, [requiredSpeedDistance, requiredSpeedTargetUtc]);

  const currentSogComparison =
    requiredSpeed !== null && aisSog !== null && Number.isFinite(aisSog)
      ? aisSog - requiredSpeed
      : null;

  const etaAtCurrentSog =
    requiredSpeedDistance !== null && aisSog !== null && Number.isFinite(aisSog) && aisSog > 0
      ? requiredSpeedDistance / aisSog
      : null;

  const selectedWaypointEtaAtCurrentSog =
    selectedWaypointDistance !== null && aisSog !== null && Number.isFinite(aisSog) && aisSog > 0
      ? selectedWaypointDistance / aisSog
      : null;

  const tideHourly = tideData?.hourly || [];
  const tideHighLow = tideData?.highLow || [];
  const tidePolyline = tideChartPolyline(tideHourly);
  const tideHeightGrid = tideChartHeightGrid(tideHourly);
  const tideTimeTicks = tideChartTimeTicks(tideHourly);
  const tideStats = tideChartStats(tideHourly);
  const tideLookupLatNumber = parseNumber(tideLookupLat) ?? aisLat;
  const tideLookupLonNumber = parseNumber(tideLookupLon) ?? aisLon;



  const theme = nightMode
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

  return (
    <main className={theme.page}>
      <div className="mx-auto max-w-none w-full">
        <header className={`${theme.panel} mb-6`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-3xl border border-[#f2b84b]/45 bg-[#f2b84b]/15 text-3xl font-black text-[#f2b84b]">
                T
              </div>
              <div>
                <div className="text-xl font-bold uppercase tracking-[0.42em] text-[#f2b84b]">
                  M/V MB480 Utilities
                </div>
                <h1
                  className={`text-4xl font-black tracking-tight ${theme.value}`}
                >
                  Utility Tools
                </h1>
                <div className={`mt-1 text-xl ${theme.muted}`}>
                  Bridge calculators and quick checks.  
                </div>
              </div>
            </div>

            <div className={`${theme.card} py-3 text-xl`}>
              <div className={theme.label}>AIS Feed</div>
              <div className="font-mono font-black">{aisStatus}</div>
              <div className={`mt-1 font-mono text-xl ${theme.muted}`}>
                {decimalToDdm(aisLat, "lat")} / {decimalToDdm(aisLon, "lon")}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className={theme.button}
                onClick={toggleFullscreen}
                type="button"
              >
                {isFullscreen ? "Exit Full Screen" : "Full Screen"}
              </button>
              <button
                className={theme.button}
                onClick={toggleTheme}
                type="button"
              >
                {nightMode ? "Day Mode" : "Bridge Night"}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className={`${theme.card} order-1`}>
            <div className="mb-4 text-xl font-black text-[#f2b84b]">
              Speed / Time / Distance
            </div>

            <div className="grid gap-3">
              <label className="grid gap-2">
                <span className={theme.label}>Distance, NM</span>
                <input
                  className={theme.input}
                  value={stdDistance}
                  onChange={(e) => setStdDistance(e.target.value)}
                  placeholder="Example: 186"
                />
              </label>
              <label className="grid gap-2">
                <span className={theme.label}>Speed, kts</span>
                <input
                  className={theme.input}
                  value={stdSpeed}
                  onChange={(e) => setStdSpeed(e.target.value)}
                  placeholder="Example: 10.5"
                />
              </label>
              <label className="grid gap-2">
                <span className={theme.label}>Time, hours</span>
                <input
                  className={theme.input}
                  value={stdTime}
                  onChange={(e) => setStdTime(e.target.value)}
                  placeholder="Example: 12"
                />
              </label>
            </div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className="grid gap-3 text-xl">
                <div>
                  <div className={theme.label}>Calculated Time</div>
                  <div className="font-mono text-xl font-black">
                    {formatHours(std.time)}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Calculated Distance</div>
                  <div className="font-mono text-xl font-black">
                    {std.distance === null
                      ? "—"
                      : `${std.distance.toFixed(1)} nm`}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Calculated Speed</div>
                  <div className="font-mono text-xl font-black">
                    {std.speed === null ? "—" : `${std.speed.toFixed(2)} kts`}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden">
            <div className="mb-4 text-xl font-black text-[#f2b84b]">
              ETA UTC
            </div>

            <div className="grid gap-3">
              <label className="grid gap-2">
                <span className={theme.label}>Distance To Go, NM</span>
                <input
                  className={theme.input}
                  value={etaDistance}
                  onChange={(e) => setEtaDistance(e.target.value)}
                  placeholder="Example: 240"
                />
              </label>
              <label className="grid gap-2">
                <span className={theme.label}>Speed Made Good, kts</span>
                <input
                  className={theme.input}
                  value={etaSpeed}
                  onChange={(e) => setEtaSpeed(e.target.value)}
                  placeholder="Example: 10"
                />
              </label>
              <label className="grid gap-2">
                <span className={theme.label}>Local Time Offset From UTC</span>
                <input
                  className={theme.input}
                  value={etaOffset}
                  onChange={(e) => setEtaOffset(e.target.value)}
                  placeholder="Example: -5 or 8"
                />
              </label>
            </div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className={theme.label}>Time Enroute</div>
              <div className="font-mono text-2xl font-black">
                {formatHours(eta)}
              </div>

              <div className={`${theme.label} mt-4`}>ETA UTC</div>
              <div className="font-mono text-2xl font-black">
                {formatEtaUtc(eta)}
              </div>
              <div className={`${theme.label} mt-4`}>ETA Local Offset</div>
              <div className="font-mono text-2xl font-black">
                {formatEtaWithOffset(eta, etaOffsetHours)}
              </div>
            </div>
          </div>

          <div className="hidden">
            <div className="mb-4 text-xl font-black text-[#f2b84b]">
              Lat / Lon Converter
            </div>

            <div className="grid gap-3">
              <label className="grid gap-2">
                <span className={theme.label}>Decimal Latitude</span>
                <input
                  className={theme.input}
                  value={decimalLat}
                  onChange={(e) => setDecimalLat(e.target.value)}
                  placeholder="Example: 13.4443"
                />
              </label>
              <label className="grid gap-2">
                <span className={theme.label}>Decimal Longitude</span>
                <input
                  className={theme.input}
                  value={decimalLon}
                  onChange={(e) => setDecimalLon(e.target.value)}
                  placeholder="Example: 144.7937"
                />
              </label>
            </div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className={theme.label}>
                Decimal to Degrees / Decimal Minutes
              </div>
              <div className="mt-2 font-mono text-xl font-black">
                {decimalToDdm(decimalLatNumber, "lat")}
              </div>
              <div className="font-mono text-xl font-black">
                {decimalToDdm(decimalLonNumber, "lon")}
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              <div className={theme.label}>
                Degrees / Decimal Minutes to Decimal
              </div>

              <div className="grid grid-cols-[1fr_1fr_82px] gap-2">
                <input
                  className={theme.input}
                  value={ddmLatDeg}
                  onChange={(e) => setDdmLatDeg(e.target.value)}
                  placeholder="Lat deg"
                />
                <input
                  className={theme.input}
                  value={ddmLatMin}
                  onChange={(e) => setDdmLatMin(e.target.value)}
                  placeholder="Lat min"
                />
                <select
                  className={theme.input}
                  value={ddmLatHemi}
                  onChange={(e) => setDdmLatHemi(e.target.value)}
                >
                  <option>N</option>
                  <option>S</option>
                </select>
              </div>

              <div className="grid grid-cols-[1fr_1fr_82px] gap-2">
                <input
                  className={theme.input}
                  value={ddmLonDeg}
                  onChange={(e) => setDdmLonDeg(e.target.value)}
                  placeholder="Lon deg"
                />
                <input
                  className={theme.input}
                  value={ddmLonMin}
                  onChange={(e) => setDdmLonMin(e.target.value)}
                  placeholder="Lon min"
                />
                <select
                  className={theme.input}
                  value={ddmLonHemi}
                  onChange={(e) => setDdmLonHemi(e.target.value)}
                >
                  <option>E</option>
                  <option>W</option>
                </select>
              </div>
            </div>

            <div className={`${theme.panel} mt-4 p-4`}>
              <div className={theme.label}>DDM to Decimal</div>
              <div className="mt-2 font-mono text-xl font-black">
                {ddmLatDecimal === null ? "—" : ddmLatDecimal.toFixed(6)}
              </div>
              <div className="font-mono text-xl font-black">
                {ddmLonDecimal === null ? "—" : ddmLonDecimal.toFixed(6)}
              </div>
            </div>
          </div>
            <div className={`${theme.card} order-4`}>
              <div className="mb-4 text-xl font-black text-[#f2b84b]">
                Sunrise / Sunset
              </div>
              <div className="grid gap-3">
                <label className="grid gap-2">
                  <span className={theme.label}>Date UTC</span>
                  <input
                    className={theme.input}
                    type="date"
                    value={sunDate}
                    onChange={(e) => setSunDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={theme.label}>Local Offset From UTC</span>
                  <input
                    className={theme.input}
                    value={watchOffset}
                    onChange={(e) => setWatchOffset(e.target.value)}
                    placeholder="Example: 10 or -5"
                  />
                </label>
              </div>
              <div className={`${theme.panel} mt-4 p-4`}>
                <div className={theme.label}>Sunrise UTC</div>
                <div className="font-mono text-xl font-black">
                  {formatDateTimeUtc(sunriseUtc)}
                </div>
                <div className={`${theme.label} mt-4`}>Sunset UTC</div>
                <div className="font-mono text-xl font-black">
                  {formatDateTimeUtc(sunsetUtc)}
                </div>
                <div className={`${theme.label} mt-4`}>Local</div>
                <div className="font-mono text-xl font-black">
                  Rise: {formatDateTimeWithOffset(sunriseUtc, watchOffsetHours)}
                </div>
                <div className="font-mono text-xl font-black">
                  Set: {formatDateTimeWithOffset(sunsetUtc, watchOffsetHours)}
                </div>
              </div>
            </div>

            <div className="hidden">
              <div className="mb-4 text-xl font-black text-[#f2b84b]">
                Time Zone Helper
              </div>
              <div className="grid gap-3">
                <label className="grid gap-2">
                  <span className={theme.label}>UTC Date</span>
                  <input
                    className={theme.input}
                    type="date"
                    value={tzDate}
                    onChange={(e) => setTzDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={theme.label}>UTC Time</span>
                  <input
                    className={theme.input}
                    type="time"
                    value={tzTime}
                    onChange={(e) => setTzTime(e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={theme.label}>Offset</span>
                  <input
                    className={theme.input}
                    value={tzOffset}
                    onChange={(e) => setTzOffset(e.target.value)}
                    placeholder="Example: +10, -5, 8"
                  />
                </label>
              </div>
              <div className={`${theme.panel} mt-4 p-4`}>
                <div className={theme.label}>Converted Time</div>
                <div className="font-mono text-xl font-black">
                  {formatDateTimeWithOffset(tzUtcDate, tzOffsetHours)}
                </div>
              </div>
            </div>

            <div className={`${theme.card} order-2`}>
              <div className="mb-4 text-xl font-black text-[#f2b84b]">
                Tides
              </div>

              <div className="grid gap-3">
                <div className={`${theme.panel} p-4`}>
                  <div className={theme.label}>Lookup Position</div>
                  <div className="mt-1 font-mono text-lg font-black">
                    {tideLookupLatNumber === null || tideLookupLonNumber === null
                      ? "No position selected"
                      : `${decimalToDdm(tideLookupLatNumber, "lat")} / ${decimalToDdm(tideLookupLonNumber, "lon")}`}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className={theme.label}>Latitude</span>
                    <input
                      className={theme.input}
                      value={tideLookupLat}
                      onChange={(event) => setTideLookupLat(event.target.value)}
                      placeholder={aisLat === null ? "Example: 13.4443" : aisLat.toFixed(6)}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={theme.label}>Longitude</span>
                    <input
                      className={theme.input}
                      value={tideLookupLon}
                      onChange={(event) => setTideLookupLon(event.target.value)}
                      placeholder={aisLon === null ? "Example: 144.7937" : aisLon.toFixed(6)}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className={theme.button}
                  disabled={aisLat === null || aisLon === null}
                  onClick={() => {
                    if (aisLat !== null) setTideLookupLat(aisLat.toFixed(6));
                    if (aisLon !== null) setTideLookupLon(aisLon.toFixed(6));
                  }}
                >
                  Use AIS Position
                </button>

                <button
                  type="button"
                  className={theme.button}
                  disabled={tideLoading || tideLookupLatNumber === null || tideLookupLonNumber === null}
                  onClick={() => loadTides("")}
                >
                  {tideLoading ? "Loading Tides" : "Find Nearby Tide Stations"}
                </button>

                {tideData?.stations?.length ? (
                  <label className="grid gap-2">
                    <span className={theme.label}>Tide Station</span>
                    <select
                      className={theme.input}
                      value={tideStation}
                      onChange={(event) => {
                        setTideStation(event.target.value);
                        loadTides(event.target.value);
                      }}
                    >
                      {tideData.stations.map((station) => (
                        <option key={station.id} value={station.id}>
                          {station.name} {station.distanceNm !== undefined ? `(${station.distanceNm} NM)` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className={`${theme.panel} mt-4 p-4`}>
                <div className={theme.label}>Prediction Chart</div>
                <div className={`mt-1 text-lg ${theme.muted}`}>{tideStatus}</div>

                <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/30">
                  <svg viewBox="0 0 320 144" className="h-52 w-full">
                    <rect x="42" y="20" width="266" height="84" fill="rgba(15,23,42,.35)" />
                    {tideHeightGrid.map((tick) => (
                      <g key={`height-${tick.height.toFixed(2)}`}>
                        <line
                          x1="42"
                          y1={tick.y}
                          x2="308"
                          y2={tick.y}
                          stroke="rgba(148,163,184,.3)"
                          strokeWidth="1"
                        />
                        <text
                          x="36"
                          y={tick.y + 4}
                          textAnchor="end"
                          fill="#cbd5e1"
                          fontSize="10"
                        >
                          {tick.height.toFixed(1)} ft
                        </text>
                      </g>
                    ))}
                    {tideTimeTicks.map((tick) => (
                      <g key={`time-${tick.label}-${tick.x.toFixed(1)}`}>
                        <line
                          x1={tick.x}
                          y1="20"
                          x2={tick.x}
                          y2="104"
                          stroke="rgba(148,163,184,.18)"
                          strokeWidth="1"
                        />
                        <text
                          x={tick.x}
                          y="126"
                          textAnchor="middle"
                          fill="#cbd5e1"
                          fontSize="10"
                        >
                          {tick.label}
                        </text>
                      </g>
                    ))}
                    <line x1="42" y1="104" x2="308" y2="104" stroke="rgba(148,163,184,.55)" strokeWidth="1" />
                    <line x1="42" y1="20" x2="42" y2="104" stroke="rgba(148,163,184,.45)" strokeWidth="1" />
                    {tidePolyline ? (
                      <polyline
                        points={tidePolyline}
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="3"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ) : (
                      <text x="175" y="66" textAnchor="middle" fill="#94a3b8" fontSize="12">
                        Load tides to plot prediction
                      </text>
                    )}
                    <text x="42" y="138" textAnchor="start" fill="#94a3b8" fontSize="9">
                      Time
                    </text>
                    <text x="6" y="18" textAnchor="start" fill="#94a3b8" fontSize="9">
                      Height
                    </text>
                  </svg>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-lg">
                  <div>
                    <div className={theme.label}>Range</div>
                    <div className="font-mono font-black">
                      {tideStats.min === null || tideStats.max === null
                        ? "—"
                        : `${tideStats.min.toFixed(1)} to ${tideStats.max.toFixed(1)} ft`}
                    </div>
                  </div>
                  <div>
                    <div className={theme.label}>Datum</div>
                    <div className="font-mono font-black">{tideData?.datum || "MLLW"}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  <div className={theme.label}>High / Low</div>
                  {tideHighLow.slice(0, 6).map((point, index) => (
                    <div key={`${point.time}-${index}`} className="flex items-center justify-between gap-3 font-mono text-lg">
                      <span>{formatTideTime(point.time)} {point.type || ""}</span>
                      <span className="font-black">{point.valueFt.toFixed(2)} ft</span>
                    </div>
                  ))}
                  {!tideHighLow.length ? (
                    <div className={`text-lg ${theme.muted}`}>No high/low predictions loaded.</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={`${theme.card} order-3`}>
              <div className="mb-4 text-xl font-black text-[#f2b84b]">
                Required Speed
              </div>
              <div className="grid gap-3">
                <div className={`${theme.panel} p-4`}>
                  <div className={theme.label}>Loaded Route</div>
                  <div className="mt-1 font-mono text-lg font-black">
                    {routeStatus}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setReqSource("route-end")}
                    className={
                      reqSource === "route-end"
                        ? `${theme.button} border-[#f2b84b] bg-[#f2b84b]/20`
                        : theme.button
                    }
                  >
                    End Route
                  </button>
                  <button
                    type="button"
                    onClick={() => setReqSource("waypoint")}
                    className={
                      reqSource === "waypoint"
                        ? `${theme.button} border-[#f2b84b] bg-[#f2b84b]/20`
                        : theme.button
                    }
                  >
                    Waypoint
                  </button>
                  <button
                    type="button"
                    onClick={() => setReqSource("manual")}
                    className={
                      reqSource === "manual"
                        ? `${theme.button} border-[#f2b84b] bg-[#f2b84b]/20`
                        : theme.button
                    }
                  >
                    Manual
                  </button>
                </div>

                {reqSource === "waypoint" && (
                  <div className="grid gap-3">
                    <label className="grid gap-2">
                      <span className={theme.label}>Target Waypoint</span>
                      <select
                        className={theme.input}
                        value={String(selectedWaypointIndex)}
                        onChange={(e) => setReqWaypointIndex(e.target.value)}
                        disabled={!loadedRoute}
                      >
                        {loadedRoute ? (
                          loadedRoute.waypoints.slice(1).map((wp, index) => (
                            <option key={`${wp.id}-${index}`} value={String(index + 1)}>
                              {wp.id} {wp.name}
                            </option>
                          ))
                        ) : (
                          <option value="1">No route loaded</option>
                        )}
                      </select>
                    </label>

                    <div className="grid gap-2">
                      <span className={theme.label}>Waypoint Quick Select</span>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {loadedRoute ? (
                          loadedRoute.waypoints.slice(1).map((wp, index) => {
                            const waypointIndex = index + 1;
                            const active = waypointIndex === selectedWaypointIndex;
                            return (
                              <button
                                key={`${wp.id}-${wp.lat}-${wp.lon}`}
                                type="button"
                                onClick={() => {
                                  setReqSource("waypoint");
                                  setReqWaypointIndex(String(waypointIndex));
                                }}
                                className={
                                  active
                                    ? `${theme.button} border-[#f2b84b] bg-[#f2b84b]/25 text-[#f2b84b]`
                                    : theme.button
                                }
                              >
                                WPT {wp.id}
                              </button>
                            );
                          })
                        ) : (
                          <div className={`rounded-2xl border border-current/10 p-3 text-lg ${theme.muted}`}>
                            No route loaded
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {reqSource === "manual" && (
                  <label className="grid gap-2">
                    <span className={theme.label}>Distance Remaining, NM</span>
                    <input
                      className={theme.input}
                      value={reqDistance}
                      onChange={(e) => setReqDistance(e.target.value)}
                      placeholder="Example: 318"
                    />
                  </label>
                )}
                <label className="grid gap-2">
                  <span className={theme.label}>Arrival Date, Local</span>
                  <input
                    className={theme.input}
                    type="date"
                    value={reqDate}
                    onChange={(e) => setReqDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={theme.label}>Arrival Time, Local 24hr</span>
                  <input
                    className={theme.input}
                    type="text"
                    inputMode="numeric"
                    value={reqTime}
                    onChange={(e) =>
                      setReqTime(formatRequiredSpeedTimeInput(e.target.value))
                    }
                    placeholder="1430"
                  />
                </label>
                <label className="grid gap-2">
                  <span className={theme.label}>Arrival UTC Offset</span>
                  <input
                    className={theme.input}
                    value={reqOffset}
                    onChange={(e) => setReqOffset(e.target.value)}
                    placeholder="Example: +10 or -4"
                  />
                </label>
              </div>
              <div className={`${theme.panel} mt-4 grid gap-3 p-4 sm:grid-cols-2`}>
                <div>
                  <div className={theme.label}>Target</div>
                  <div className="font-mono text-xl font-black">
                    {requiredSpeedTargetLabel}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Route Distance</div>
                  <div className="font-mono text-xl font-black">
                    {requiredSpeedDistance === null
                      ? "—"
                      : `${requiredSpeedDistance.toFixed(1)} NM`}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Arrival Converted To UTC</div>
                  <div className="font-mono text-xl font-black">
                    {formatDateTimeUtc(requiredSpeedTargetUtc)}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Speed Required</div>
                  <div className="font-mono text-2xl font-black">
                    {requiredSpeed === null
                      ? "—"
                      : `${requiredSpeed.toFixed(2)} kts`}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>Current SOG</div>
                  <div className="font-mono text-xl font-black">
                    {aisSog === null ? "—" : `${aisSog.toFixed(1)} kts`}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>SOG Difference</div>
                  <div className="font-mono text-xl font-black">
                    {currentSogComparison === null
                      ? "—"
                      : currentSogComparison >= 0
                        ? `${currentSogComparison.toFixed(2)} kts ahead`
                        : `${Math.abs(currentSogComparison).toFixed(2)} kts short`}
                  </div>
                </div>
                <div>
                  <div className={theme.label}>ETA At Current SOG</div>
                  <div className="font-mono text-xl font-black">
                    {formatEtaUtc(etaAtCurrentSog)}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className={theme.label}>Selected Waypoint At Current SOG</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <div>
                      <div className={`text-sm font-bold uppercase tracking-[.14em] ${theme.muted}`}>Waypoint</div>
                      <div className="font-mono text-xl font-black">
                        {selectedWaypoint ? `${selectedWaypoint.id} ${selectedWaypoint.name}` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className={`text-sm font-bold uppercase tracking-[.14em] ${theme.muted}`}>Distance</div>
                      <div className="font-mono text-xl font-black">
                        {selectedWaypointDistance === null ? "—" : `${selectedWaypointDistance.toFixed(1)} NM`}
                      </div>
                    </div>
                    <div>
                      <div className={`text-sm font-bold uppercase tracking-[.14em] ${theme.muted}`}>Time</div>
                      <div className="font-mono text-xl font-black">
                        {formatHours(selectedWaypointEtaAtCurrentSog)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-sm font-bold uppercase tracking-[.14em] ${theme.muted}`}>ETA</div>
                      <div className="font-mono text-xl font-black">
                        {formatEtaUtc(selectedWaypointEtaAtCurrentSog)}
                      </div>
                      <div className={`font-mono text-lg ${theme.muted}`}>
                        {formatEtaWithOffset(selectedWaypointEtaAtCurrentSog, reqOffsetHours)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </section>
      </div>
    </main>
  );
}
