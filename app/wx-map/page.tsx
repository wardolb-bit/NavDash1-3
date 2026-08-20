"use client";

import { useEffect, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

type OwnShip = {
  lat: number;
  lon: number;
  cog?: number;
  sog?: number;
  heading?: number;
  mmsi?: number;
  receivedAt: string;
  raw?: string;
};

type GribTimelineRow = {
  label: string;
  valid: string;
  forecast: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  pressureHpa: number | null;
  tempC: number | null;
};

type RouteForecastPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  worstWindKt: number | null;
  worstGustKt: number | null;
  worstSeasFt: number | null;
  worstSwellFt: number | null;
  worstSwellPeriod: number | null;
  worstValid: string;
  timeline: GribTimelineRow[];
};

type RouteForecast = {
  routeName: string;
  sampledPoints: number;
  routePoints: RouteForecastPoint[];
  worstWindPoint: RouteForecastPoint | null;
  worstSeasPoint: RouteForecastPoint | null;
};

type GribSummary = {
  fileName: string;
  fileSize: number;
  loadedAt: string;
  status: string;
  summary: string;
  sourceNotes: string;
  inventoryPreview: string;
  timeline: GribTimelineRow[];
  overlayPoints: GribOverlayPoint[];
  routeForecast?: RouteForecast | null;
};

type GribOverlayPoint = {
  lat: number;
  lon: number;
  label: string;
  valid: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  routePoint?: string;
};

type SelectedGribPoint = {
  lat: number;
  lon: number;
  wind: string;
  gust: string;
  seas: string;
  swell: string;
  period: string;
  valid: string;
};

const MAPLIBRE_CSS_ID = "maplibre-css";
const GRIB_SOURCE_ID = "navdash-grib-sample-source";
const GRIB_CIRCLE_LAYER_ID = "navdash-grib-sample-circle";
const GRIB_LABEL_LAYER_ID = "navdash-grib-sample-label";

function directionToCardinal(deg?: number) {
  if (deg === undefined || Number.isNaN(deg)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function formatLatLon(value?: number, isLat = true) {
  if (value === undefined || Number.isNaN(value)) return "—";

  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;

  const hemi = isLat
    ? value >= 0
      ? "N"
      : "S"
    : value >= 0
    ? "E"
    : "W";

  return `${degrees}°${minutes.toFixed(1)}' ${hemi}`;
}


function parseNmeaLatLon(value: string, hemi: string, isLat: boolean) {
  if (!value || !hemi) return null;

  const degreeLength = isLat ? 2 : 3;
  const degrees = Number(value.slice(0, degreeLength));
  const minutes = Number(value.slice(degreeLength));

  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;

  let decimal = degrees + minutes / 60;

  if (hemi === "S" || hemi === "W") {
    decimal *= -1;
  }

  return decimal;
}

function decodeGpsNmeaPosition(line: string): OwnShip | null {
  try {
    const clean = line.split("*")[0];
    const parts = clean.split(",");
    const sentenceType = parts[0];

    // GGA: $GPGGA,time,lat,N,lon,E,fix,...
    if (
      sentenceType.endsWith("GGA") &&
      parts.length >= 6
    ) {
      const lat = parseNmeaLatLon(parts[2], parts[3], true);
      const lon = parseNmeaLatLon(parts[4], parts[5], false);
      const fixQuality = Number(parts[6]);

      if (lat === null || lon === null) return null;
      if (!Number.isFinite(fixQuality) || fixQuality < 1) return null;

      return {
        lat,
        lon,
        receivedAt: new Date().toISOString(),
        raw: line,
      };
    }

    // RMC: $GPRMC,time,status,lat,N,lon,E,sog,cog,date,...
    if (
      sentenceType.endsWith("RMC") &&
      parts.length >= 9
    ) {
      if (parts[2] !== "A") return null;

      const lat = parseNmeaLatLon(parts[3], parts[4], true);
      const lon = parseNmeaLatLon(parts[5], parts[6], false);
      const sog = Number(parts[7]);
      const cog = Number(parts[8]);

      if (lat === null || lon === null) return null;

      return {
        lat,
        lon,
        sog: Number.isFinite(sog) ? sog : undefined,
        cog: Number.isFinite(cog) ? cog : undefined,
        receivedAt: new Date().toISOString(),
        raw: line,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function decodeAnyOwnShipPosition(line: string): OwnShip | null {
  const ais = decodeOwnShip(line);
  if (ais) return ais;

  const gps = decodeGpsNmeaPosition(line);
  if (gps) return gps;

  return null;
}


function metersToFeet(m?: number) {
  if (m === undefined || Number.isNaN(m)) return "—";
  return `${(m * 3.28084).toFixed(1)} ft`;
}

function kmhToKnots(kmh?: number) {
  if (kmh === undefined || Number.isNaN(kmh)) return "—";
  return `${(kmh * 0.539957).toFixed(1)} kt`;
}

function weatherCodeLabel(code?: number) {
  const map: Record<number, string> = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    80: "Rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };

  if (code === undefined) return "—";
  return map[code] ?? `Code ${code}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatGribNumber(value?: number | null, decimals = 1, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}${suffix}`;
}

function formatGribDirection(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${String(Math.round(value)).padStart(3, "0")} deg T`;
}

function hasAnySeas(rows: GribTimelineRow[]) {
  return rows.some(row => Number.isFinite(row.seasFt) || Number.isFinite(row.swellFt));
}

function routePointStatus(point?: RouteForecastPoint | null) {
  const gust = point?.worstGustKt ?? point?.worstWindKt ?? 0;
  const seas = point?.worstSeasFt ?? 0;
  if (gust >= 35 || seas >= 12) return "Heavy";
  if (gust >= 25 || seas >= 8) return "Watch";
  return "OK";
}

function routePointBadgeClass(point: RouteForecastPoint, nightMode: boolean) {
  const status = routePointStatus(point);
  if (status === "Heavy") return nightMode ? "border-red-400/40 bg-red-500/15 text-red-100" : "border-red-300 bg-red-50 text-red-800";
  if (status === "Watch") return nightMode ? "border-amber-400/40 bg-amber-500/15 text-amber-100" : "border-amber-300 bg-amber-50 text-amber-800";
  return nightMode ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" : "border-emerald-300 bg-emerald-50 text-emerald-800";
}

function gribPointColor(row?: GribTimelineRow) {
  const gust = row?.gustKt ?? row?.windKt ?? 0;
  if (gust >= 35) return "#ef4444";
  if (gust >= 25) return "#f97316";
  if (gust >= 15) return "#facc15";
  return "#22d3ee";
}

function gribOverlayPointColor(point?: GribOverlayPoint) {
  const seas = point?.seasFt ?? 0;
  const gust = point?.gustKt ?? point?.windKt ?? 0;
  if (seas >= 12 || gust >= 35) return "#ef4444";
  if (seas >= 8 || gust >= 25) return "#f97316";
  if (seas >= 4 || gust >= 15) return "#facc15";
  return "#22d3ee";
}

function getBits(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signedFromBits(value: number, bitLength: number) {
  const signBit = 1 << (bitLength - 1);
  return value & signBit ? value - (1 << bitLength) : value;
}

function aisCharToSixBit(char: string) {
  const code = char.charCodeAt(0);
  let value = code - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string, fillBits = 0) {
  let bits = "";

  for (const char of payload) {
    const value = aisCharToSixBit(char);
    bits += value.toString(2).padStart(6, "0");
  }

  return fillBits > 0 ? bits.slice(0, -fillBits) : bits;
}

function decodeAisPayload(payload: string, fillBits = 0, raw?: string): OwnShip | null {
  const bits = payloadToBits(payload, fillBits);
  const messageType = getBits(bits, 0, 6);

  if ([1, 2, 3].includes(messageType) && bits.length >= 168) {
    const mmsi = getBits(bits, 8, 30);
    const sogRaw = getBits(bits, 50, 10);
    const lonRaw = signedFromBits(getBits(bits, 61, 28), 28);
    const latRaw = signedFromBits(getBits(bits, 89, 27), 27);
    const cogRaw = getBits(bits, 116, 12);
    const headingRaw = getBits(bits, 128, 9);

    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return {
      lat,
      lon,
      mmsi,
      sog: sogRaw === 1023 ? undefined : sogRaw / 10,
      cog: cogRaw === 3600 ? undefined : cogRaw / 10,
      heading: headingRaw === 511 ? undefined : headingRaw,
      receivedAt: new Date().toISOString(),
      raw,
    };
  }

  if (messageType === 18 && bits.length >= 168) {
    const mmsi = getBits(bits, 8, 30);
    const sogRaw = getBits(bits, 46, 10);
    const lonRaw = signedFromBits(getBits(bits, 57, 28), 28);
    const latRaw = signedFromBits(getBits(bits, 85, 27), 27);
    const cogRaw = getBits(bits, 112, 12);
    const headingRaw = getBits(bits, 124, 9);

    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return {
      lat,
      lon,
      mmsi,
      sog: sogRaw === 1023 ? undefined : sogRaw / 10,
      cog: cogRaw === 3600 ? undefined : cogRaw / 10,
      heading: headingRaw === 511 ? undefined : headingRaw,
      receivedAt: new Date().toISOString(),
      raw,
    };
  }

  return null;
}

function getNmeaLineFromMessage(eventData: string): string | null {
  try {
    const msg = JSON.parse(eventData);

    if (typeof msg === "string") return msg;
    if (msg?.type === "nmea") {
      return (
        msg.line ??
        msg.sentence ??
        msg.nmea ??
        msg.data ??
        msg.message ??
        null
      );
    }

    if (
      typeof msg?.line === "string" &&
      (msg.line.startsWith("!") || msg.line.startsWith("$"))
    ) return msg.line;
  } catch {
    if (eventData.startsWith("!") || eventData.startsWith("$")) return eventData;
  }

  return null;
}

function isOwnShipSentence(line: string) {
  return (
    line.startsWith("!AIVDO") ||
    line.startsWith("$AIVDO") ||
    line.startsWith("!AIVDM") ||
    line.startsWith("$AIVDM")
  );
}

function decodeOwnShip(line: string): OwnShip | null {
  if (!isOwnShipSentence(line)) return null;

  const clean = line.split("*")[0];
  const parts = clean.split(",");

  const totalFragments = Number(parts[1]);
  const fragmentNumber = Number(parts[2]);

  if (!Number.isFinite(totalFragments) || !Number.isFinite(fragmentNumber)) return null;
  if (fragmentNumber !== 1) return null;

  const payload = parts[5];
  const fillBits = Number(parts[6] ?? 0);

  if (!payload) return null;

  return decodeAisPayload(payload, fillBits, line);
}

function addMapLibreCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(MAPLIBRE_CSS_ID)) return;

  const link = document.createElement("link");
  link.id = MAPLIBRE_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/maplibre-gl@5.14.0/dist/maplibre-gl.css";
  document.head.appendChild(link);
}


export default function WxMapTestPage() {
  const [nightMode, setNightMode] = useState(true);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [socketStatus, setSocketStatus] = useState("Disconnected");
  const [lastNmeaLine, setLastNmeaLine] = useState("");
  const [status, setStatus] = useState("Waiting for AIS own-ship position...");
  const [mapStatus, setMapStatus] = useState("Map loading...");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gribLoading, setGribLoading] = useState(false);
  const [gribStatus, setGribStatus] = useState("No GRIB file loaded");
  const [gribSummary, setGribSummary] = useState<GribSummary | null>(null);
  const [selectedGribPoint, setSelectedGribPoint] = useState<SelectedGribPoint | null>(null);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const shipMarkerRef = useRef<HTMLDivElement | null>(null);
  const maplibreRef = useRef<any>(null);
  const gribHandlersBoundRef = useRef(false);

  const activeLat = ownShip?.lat;
  const activeLon = ownShip?.lon;
  const hasActivePosition = Number.isFinite(activeLat) && Number.isFinite(activeLon);
  const usingAis = !!ownShip;

  const theme = nightMode
    ? {
        page: "min-h-screen bg-slate-950 text-cyan-100",
        panel: "rounded-2xl border border-cyan-400/20 bg-slate-900/70 shadow-lg shadow-cyan-950/30",
        card: "rounded-xl border border-cyan-400/20 bg-slate-950/70",
        muted: "text-cyan-100/60",
        button: "rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50",
        activeButton: "rounded-xl border border-cyan-300 bg-cyan-300/20 px-4 py-2 text-cyan-50 shadow-sm shadow-cyan-900/40",
        badgeGood: "rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-emerald-200",
        badgeWarn: "rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-amber-200",
      }
    : {
        page: "min-h-screen bg-slate-100 text-slate-950",
        panel: "rounded-2xl border border-slate-300 bg-white shadow-md",
        card: "rounded-xl border border-slate-300 bg-slate-50",
        muted: "text-slate-500",
        button: "rounded-xl border border-slate-400 bg-white px-4 py-2 text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50",
        activeButton: "rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-white shadow-sm",
        badgeGood: "rounded-full border border-emerald-500/50 bg-emerald-100 px-3 py-1 text-emerald-800",
        badgeWarn: "rounded-full border border-amber-500/50 bg-amber-100 px-3 py-1 text-amber-800",
      };

  function updateShipMarkerPosition() {
    const map = mapRef.current;
    const marker = shipMarkerRef.current;

    if (!map || !marker || !ownShip) {
      if (marker) marker.style.display = "none";
      return;
    }

    const point = map.project([ownShip.lon, ownShip.lat]);
    const rotation = ownShip.heading ?? ownShip.cog ?? 0;

    marker.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg)`;
    marker.style.display = "block";
  }

  function centerMapOnShip() {
    const map = mapRef.current;
    if (!map || !ownShip) return;

    map.easeTo({
      center: [ownShip.lon, ownShip.lat],
      zoom: Math.max(map.getZoom?.() ?? 8, 8),
      duration: 700,
      essential: true,
    });
  }

  function clearGribMapPoint() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer(GRIB_LABEL_LAYER_ID)) map.removeLayer(GRIB_LABEL_LAYER_ID);
    if (map.getLayer(GRIB_CIRCLE_LAYER_ID)) map.removeLayer(GRIB_CIRCLE_LAYER_ID);
    if (map.getSource(GRIB_SOURCE_ID)) map.removeSource(GRIB_SOURCE_ID);
    setSelectedGribPoint(null);
  }

  function updateGribMapPoint(summary: GribSummary | null) {
    const map = mapRef.current;
    const points = summary?.overlayPoints || [];

    if (!map || !map.isStyleLoaded()) return;
    if (!points.length) setSelectedGribPoint(null);

    const data = {
      type: "FeatureCollection",
      features: points.map(point => {
        const label = [
          point.routePoint || "",
          `Wind ${formatGribNumber(point.windKt, 1, " kt")}`,
          `Seas ${formatGribNumber(point.seasFt, 1, " ft")}`,
        ].filter(Boolean).join("\n");

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [point.lon, point.lat],
          },
            properties: {
              label,
              color: gribOverlayPointColor(point),
              lat: point.lat,
              lon: point.lon,
              wind: formatGribNumber(point.windKt, 1, " kt"),
              gust: formatGribNumber(point.gustKt, 1, " kt"),
              seas: formatGribNumber(point.seasFt, 1, " ft"),
              swell: formatGribNumber(point.swellFt, 1, " ft"),
            period: formatGribNumber(point.swellPeriod, 1, " sec"),
            valid: point.valid || "",
            routePoint: point.routePoint || "",
          },
        };
      }),
    };

    if (map.getLayer(GRIB_LABEL_LAYER_ID)) {
      map.setPaintProperty(GRIB_LABEL_LAYER_ID, "text-color", nightMode ? "#f8fafc" : "#111827");
      map.setPaintProperty(GRIB_LABEL_LAYER_ID, "text-halo-color", nightMode ? "#020617" : "#ffffff");
      map.setPaintProperty(GRIB_LABEL_LAYER_ID, "text-halo-width", nightMode ? 2.5 : 3);
    }

    const source = map.getSource(GRIB_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
      return;
    }

    map.addSource(GRIB_SOURCE_ID, {
      type: "geojson",
      data,
    });

    map.addLayer({
      id: GRIB_CIRCLE_LAYER_ID,
      type: "circle",
      source: GRIB_SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          5,
          8,
          11,
        ],
        "circle-color": ["get", "color"],
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0.55,
          8,
          0.8,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });

    map.addLayer({
      id: GRIB_LABEL_LAYER_ID,
      type: "symbol",
      source: GRIB_SOURCE_ID,
      minzoom: 8,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.7],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": nightMode ? "#f8fafc" : "#111827",
        "text-halo-color": nightMode ? "#020617" : "#ffffff",
        "text-halo-width": nightMode ? 2.5 : 3,
      },
    });

    if (!gribHandlersBoundRef.current) {
      map.on("click", GRIB_CIRCLE_LAYER_ID, (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const coords = feature.geometry.coordinates.slice();
        const props = feature.properties || {};
        setSelectedGribPoint({
          lat: Number(props.lat ?? coords[1]),
          lon: Number(props.lon ?? coords[0]),
          wind: props.wind || "--",
          gust: props.gust || "--",
          seas: props.seas || "--",
          swell: props.swell || "--",
          period: props.period || "--",
          valid: props.valid || "",
        });
        const html = `
          <div style="font: 12px/1.35 system-ui, sans-serif; min-width: 160px; color: #0f172a;">
            <strong>${props.routePoint || "GRIB sample"}</strong><br/>
            Wind: ${props.wind}<br/>
            Gust: ${props.gust}<br/>
            Seas: ${props.seas}<br/>
            Swell: ${props.swell} / ${props.period}<br/>
            <span style="opacity:.75">${props.valid}</span>
          </div>
        `;

        new maplibreRef.current.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);
      });

      map.on("mouseenter", GRIB_CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", GRIB_CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      gribHandlersBoundRef.current = true;
    }
  }


  useEffect(() => {
    const updateFullscreenState = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      localStorage.setItem("navconsole-fullscreen", active ? "true" : "false");
    };

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        localStorage.setItem("navconsole-fullscreen", "true");
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        localStorage.setItem("navconsole-fullscreen", "false");
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error("Fullscreen toggle failed", err);
    }
  }

  function applyGribSummary(data: any, fallbackName = "Saved GRIB file", fallbackSize = 0) {
    setGribSummary({
      fileName: data?.fileName || fallbackName,
      fileSize: Number.isFinite(Number(data?.fileSize)) ? Number(data.fileSize) : fallbackSize,
      loadedAt: data?.loadedAt || new Date().toISOString(),
      status: data?.status || "GRIB loaded",
      summary: data?.summary || "GRIB loaded, but no summary was returned.",
      sourceNotes: data?.sourceNotes || "",
      inventoryPreview: data?.inventoryPreview || "",
      timeline: Array.isArray(data?.timeline) ? data.timeline : [],
      overlayPoints: Array.isArray(data?.overlayPoints) ? data.overlayPoints : [],
      routeForecast: data?.routeForecast || null,
    });
    setGribStatus(data?.status || "GRIB loaded");
  }

  async function importGribFile(file: File | null) {
    if (!file) return;

    if (!hasActivePosition || activeLat === undefined || activeLon === undefined) {
      setGribStatus("Waiting for AIS position before sampling GRIB file");
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".grb") && !lowerName.endsWith(".grb2") && !lowerName.endsWith(".grib") && !lowerName.endsWith(".grib2")) {
      setGribStatus("Select a GRIB file ending in .grb, .grb2, .grib, or .grib2");
      return;
    }

    try {
      setGribLoading(true);
      setGribStatus(`Loading ${file.name}`);

      const form = new FormData();
      form.append("file", file);
      form.append("lat", String(activeLat));
      form.append("lon", String(activeLon));

      const response = await fetch("/api/grib-summary", {
        method: "POST",
        body: form,
      });
      const responseText = await response.text();
      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        const plainText = responseText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(
          plainText
            ? `GRIB parser returned a server error: ${plainText.slice(0, 180)}`
            : `GRIB parser returned ${response.status} without JSON.`,
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || `GRIB API returned ${response.status}`);
      }

      applyGribSummary(data, file.name, file.size);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load GRIB file";
      setGribStatus(message);
      setGribSummary(null);
    } finally {
      setGribLoading(false);
    }
  }

  async function clearGribFile() {
    try {
      setGribLoading(true);
      await fetch("/api/grib-summary", { method: "DELETE" });
    } finally {
      setGribSummary(null);
      setGribStatus("No GRIB file loaded");
      clearGribMapPoint();
      setGribLoading(false);
    }
  }


  useEffect(() => {
    const wsUrl = getAisWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setSocketStatus(`Connected to ${wsUrl}`);
      setStatus("AIS websocket connected. Waiting for !AIVDO own-ship sentence...");
    };

    ws.onmessage = (event) => {
      const line = getNmeaLineFromMessage(String(event.data));
      if (!line) return;

      setLastNmeaLine(line.slice(0, 120));

      const decoded = decodeAnyOwnShipPosition(line);
      if (decoded) {
        setOwnShip(decoded);
        setStatus(`Position received from ${line.slice(0, 6)}`);
      }
    };

    ws.onerror = () => {
      setSocketStatus("Websocket error");
      setStatus("AIS websocket error");
    };

    ws.onclose = () => {
      setSocketStatus("Disconnected");
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedGrib() {
      try {
        const response = await fetch("/api/grib-summary", { cache: "no-store" });
        if (!response.ok) return;

        const data = await response.json();
        if (cancelled || !data?.hasGrib) return;

        applyGribSummary(data);
      } catch {
        // Weather map can still run without a saved GRIB file.
      }
    }

    loadSavedGrib();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      try {
        addMapLibreCss();

        const maplibreglModule = await import("maplibre-gl");

        if (cancelled || !mapElRef.current || mapRef.current) return;

        const maplibregl = maplibreglModule.default ?? maplibreglModule;

        maplibreRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: mapElRef.current,
          center: hasActivePosition ? [activeLon ?? 0, activeLat ?? 0] : [0, 20],
          zoom: hasActivePosition ? 7 : 2,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "osm-base",
                type: "raster",
                source: "osm",
              },

            ],
          },
        });

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

        map.on("move", updateShipMarkerPosition);
        map.on("zoom", updateShipMarkerPosition);
        map.on("resize", updateShipMarkerPosition);

        map.on("load", () => {
          // Own-ship is displayed by the DOM overlay marker below.
          // Keeping it out of MapLibre's symbol-image pipeline avoids canvas/image sizing issues.

          setMapStatus("Base map ready");
          updateGribMapPoint(gribSummary);
          map.resize();
          setTimeout(updateShipMarkerPosition, 100);
          setTimeout(() => map.resize(), 250);
        });

        mapRef.current = map;
        resizeObserver = new ResizeObserver(() => {
          map.resize();
          updateShipMarkerPosition();
        });
        resizeObserver.observe(mapElRef.current);
      } catch (err) {
        console.error(err);
        setMapStatus("Map failed to load. Check npm packages.");
        setStatus("MapLibre map package missing or failed to load.");
      }
    }

    initializeMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        gribHandlersBoundRef.current = false;
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plain AIS marker only: hidden until decoded AIS position exists.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !ownShip) {
      updateShipMarkerPosition();
      return;
    }

    updateShipMarkerPosition();

    const timer = window.setTimeout(updateShipMarkerPosition, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownShip?.lat, ownShip?.lon, ownShip?.heading, ownShip?.cog]);

  useEffect(() => {
    updateGribMapPoint(gribSummary);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gribSummary, nightMode]);

  return (
    <main className={theme.page}>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className={theme.muted}>NavDash 1.3 Weather</div>
            <h1 className="text-3xl font-semibold tracking-wide">Weather Map</h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className={theme.button}
              onClick={toggleFullscreen}
              type="button"
            >
              {isFullscreen ? "Exit Full Screen" : "Full Screen"}
            </button>
<button
              className={theme.button}
              onClick={() => setNightMode((v) => !v)}
            >
              {nightMode ? "Day Mode" : "Night Mode"}
            </button>

          </div>
        </header>

        <section className={`${theme.panel} mb-6 p-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">AIS Position Feed</h2>
              <div className={`mt-1 text-sm ${theme.muted}`}>{socketStatus}</div>
              <div className={`mt-1 max-w-4xl truncate text-xs ${theme.muted}`}>
                Last NMEA: {lastNmeaLine || "waiting for NMEA sentence"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className={usingAis ? theme.badgeGood : theme.badgeWarn}>
                {usingAis ? "AIS POSITION LIVE" : "WAITING FOR AIS POSITION"}
              </div>

              <div className={theme.badgeGood}>{mapStatus}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Latitude</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatLatLon(activeLat, true)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {activeLat !== undefined ? `${activeLat.toFixed(6)} deg` : "Waiting for AIS"}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Longitude</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatLatLon(activeLon, false)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {activeLon !== undefined ? `${activeLon.toFixed(6)} deg` : "Waiting for AIS"}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Course / Speed</div>
            <div className="mt-2 text-2xl font-semibold">
              {ownShip?.cog !== undefined ? `${ownShip.cog.toFixed(1)}°` : "—"}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              SOG {ownShip?.sog !== undefined ? `${ownShip.sog.toFixed(1)} kt` : "—"}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Heading / MMSI</div>
            <div className="mt-2 text-2xl font-semibold">
              {ownShip?.heading !== undefined ? `${ownShip.heading}°` : "—"}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>{ownShip?.mmsi ?? "Waiting for AIS"}</div>
          </div>
        </section>

        <section className={`${theme.panel} mt-6 p-4`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold">GRIB Weather Map</h2>
              <div className={`mt-1 text-sm ${theme.muted}`}>
                Imported GRIB files are sampled around own ship and displayed as the weather source for this page.
              </div>
            </div>
          </div>

          <div className={`${theme.card} mt-4 p-4`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-lg font-semibold">GRIB Forecast File</h3>
                <div className={`mt-1 text-sm ${theme.muted}`}>
                  Import a downloaded GRIB2 file for model guidance around the active AIS position.
                </div>
                <div className={`mt-2 text-sm font-semibold ${gribSummary ? "" : theme.muted}`}>
                  {gribStatus}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className={(gribLoading || !hasActivePosition) ? `${theme.button} cursor-not-allowed opacity-60` : `${theme.button} cursor-pointer`}>
                  {gribLoading ? "Loading GRIB" : "Import GRIB"}
                  <input
                    type="file"
                    accept=".grb,.grb2,.grib,.grib2"
                    className="hidden"
                    disabled={gribLoading || !hasActivePosition}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      importGribFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={theme.button}
                  disabled={!gribSummary || gribLoading}
                  onClick={clearGribFile}
                >
                  Clear GRIB
                </button>
              </div>
            </div>

            {gribSummary ? (
              <div className="mt-4 grid gap-4">
                <div className={nightMode ? "rounded-xl border border-cyan-400/20 bg-slate-950/70 p-4" : "rounded-xl border border-slate-300 bg-white p-4"}>
                  <div className={theme.muted}>Loaded File</div>
                  <div className="mt-1 text-xl font-semibold">{gribSummary.fileName}</div>
                  <div className={`mt-1 text-sm ${theme.muted}`}>
                    {formatFileSize(gribSummary.fileSize)} · sampled at {formatLatLon(activeLat, true)} / {formatLatLon(activeLon, false)}
                  </div>
                  <details className={`mt-3 rounded-xl border border-current/10 p-3 text-sm leading-6 ${nightMode ? "bg-black/25" : "bg-slate-50"}`}>
                    <summary className="cursor-pointer font-semibold">GRIB Summary</summary>
                    <div className="mt-3 whitespace-pre-wrap">{gribSummary.summary}</div>
                  </details>
                  {gribSummary.sourceNotes ? (
                    <div className={`mt-3 text-xs ${theme.muted}`}>{gribSummary.sourceNotes}</div>
                  ) : null}
                </div>

                {gribSummary.routeForecast ? (
                  <div className={nightMode ? "rounded-xl border border-cyan-400/20 bg-slate-950/70 p-4" : "rounded-xl border border-slate-300 bg-white p-4"}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className={theme.muted}>Route-Aware GRIB</div>
                        <div className="mt-1 text-lg font-semibold">{gribSummary.routeForecast.routeName}</div>
                        <div className={`mt-1 text-sm ${theme.muted}`}>
                          {gribSummary.routeForecast.sampledPoints} route points sampled from the loaded route.
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <div className={nightMode ? "rounded-xl border border-cyan-400/20 bg-black/20 p-3" : "rounded-xl border border-slate-200 bg-slate-50 p-3"}>
                          <div className={theme.muted}>Worst Wind/Gust</div>
                          <div className="mt-1 font-semibold">
                            {gribSummary.routeForecast.worstWindPoint
                              ? `${gribSummary.routeForecast.worstWindPoint.id} ${gribSummary.routeForecast.worstWindPoint.name}`
                              : "--"}
                          </div>
                          <div className={`mt-1 ${theme.muted}`}>
                            {formatGribNumber(gribSummary.routeForecast.worstWindPoint?.worstWindKt, 1, " kt")} / {formatGribNumber(gribSummary.routeForecast.worstWindPoint?.worstGustKt, 1, " kt")}
                          </div>
                        </div>
                        <div className={nightMode ? "rounded-xl border border-cyan-400/20 bg-black/20 p-3" : "rounded-xl border border-slate-200 bg-slate-50 p-3"}>
                          <div className={theme.muted}>Worst Seas</div>
                          <div className="mt-1 font-semibold">
                            {gribSummary.routeForecast.worstSeasPoint
                              ? `${gribSummary.routeForecast.worstSeasPoint.id} ${gribSummary.routeForecast.worstSeasPoint.name}`
                              : "--"}
                          </div>
                          <div className={`mt-1 ${theme.muted}`}>
                            {formatGribNumber(gribSummary.routeForecast.worstSeasPoint?.worstSeasFt, 1, " ft")}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-[760px] w-full border-collapse text-left text-sm">
                        <thead className={nightMode ? "text-cyan-200" : "text-slate-600"}>
                          <tr className="border-b border-current/15">
                            <th className="py-2 pr-3 font-semibold">Route Point</th>
                            <th className="py-2 pr-3 font-semibold">Status</th>
                            <th className="py-2 pr-3 font-semibold">Wind</th>
                            <th className="py-2 pr-3 font-semibold">Gust</th>
                            <th className="py-2 pr-3 font-semibold">Seas</th>
                            <th className="py-2 pr-3 font-semibold">Swell</th>
                            <th className="py-2 pr-3 font-semibold">Worst Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gribSummary.routeForecast.routePoints.map((point) => (
                            <tr key={`${point.id}-${point.lat}-${point.lon}`} className="border-b border-current/10">
                              <td className="py-2 pr-3">
                                <div className="font-semibold">{point.id} {point.name}</div>
                                <div className={`text-xs ${theme.muted}`}>{formatLatLon(point.lat, true)} / {formatLatLon(point.lon, false)}</div>
                              </td>
                              <td className="py-2 pr-3">
                                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${routePointBadgeClass(point, nightMode)}`}>
                                  {point.timeline.length ? routePointStatus(point) : "No data"}
                                </span>
                              </td>
                              <td className="py-2 pr-3">{formatGribNumber(point.worstWindKt, 1, " kt")}</td>
                              <td className="py-2 pr-3">{formatGribNumber(point.worstGustKt, 1, " kt")}</td>
                              <td className="py-2 pr-3">{formatGribNumber(point.worstSeasFt, 1, " ft")}</td>
                              <td className="py-2 pr-3">
                                <div>{formatGribNumber(point.worstSwellFt, 1, " ft")}</div>
                                <div className={`text-xs ${theme.muted}`}>{formatGribNumber(point.worstSwellPeriod, 1, " sec")}</div>
                              </td>
                              <td className={`py-2 pr-3 ${theme.muted}`}>{point.worstValid || "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-xl border border-current/10 p-3 text-sm ${theme.muted}`}>
                    Load a route before importing GRIB to add route-aware wind and seas guidance.
                  </div>
                )}

                <details className={nightMode ? "rounded-xl border border-cyan-400/20 bg-slate-950/70 p-4" : "rounded-xl border border-slate-300 bg-white p-4"}>
                  <summary className="cursor-pointer font-semibold">Forecast Timeline</summary>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className={theme.muted}>Forecast Timeline</div>
                      <div className="mt-1 text-lg font-semibold">Point sample at active map position</div>
                    </div>
                    {!hasAnySeas(gribSummary.timeline) ? (
                      <div className={`text-xs ${theme.muted}`}>No valid wave/seas values found at this point.</div>
                    ) : null}
                  </div>

                  {gribSummary.timeline.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-[860px] w-full border-collapse text-left text-sm">
                        <thead className={nightMode ? "text-cyan-200" : "text-slate-600"}>
                          <tr className="border-b border-current/15">
                            <th className="py-2 pr-3 font-semibold">Step</th>
                            <th className="py-2 pr-3 font-semibold">Valid Time</th>
                            <th className="py-2 pr-3 font-semibold">Wind</th>
                            <th className="py-2 pr-3 font-semibold">Gust</th>
                            <th className="py-2 pr-3 font-semibold">Seas</th>
                            <th className="py-2 pr-3 font-semibold">Swell</th>
                            <th className="py-2 pr-3 font-semibold">Pressure</th>
                            <th className="py-2 pr-3 font-semibold">Temp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gribSummary.timeline.map((row, index) => (
                            <tr key={`${row.valid}-${row.forecast}-${index}`} className="border-b border-current/10">
                              <td className="py-2 pr-3 font-semibold">{row.label || row.forecast || "Forecast"}</td>
                              <td className={`py-2 pr-3 ${theme.muted}`}>{row.valid || "--"}</td>
                              <td className="py-2 pr-3">
                                <div>{formatGribNumber(row.windKt, 1, " kt")}</div>
                                <div className={`text-xs ${theme.muted}`}>{formatGribDirection(row.windDir)}</div>
                              </td>
                              <td className="py-2 pr-3">{formatGribNumber(row.gustKt, 1, " kt")}</td>
                              <td className="py-2 pr-3">{formatGribNumber(row.seasFt, 1, " ft")}</td>
                              <td className="py-2 pr-3">
                                <div>{formatGribNumber(row.swellFt, 1, " ft")}</div>
                                <div className={`text-xs ${theme.muted}`}>{formatGribNumber(row.swellPeriod, 1, " sec")}</div>
                              </td>
                              <td className="py-2 pr-3">{formatGribNumber(row.pressureHpa, 1, " hPa")}</td>
                              <td className="py-2 pr-3">{formatGribNumber(row.tempC, 1, " C")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={`mt-3 rounded-xl border border-current/10 p-3 text-sm ${theme.muted}`}>
                      No timeline rows were returned from this GRIB sample.
                    </div>
                  )}
                </details>

                <details className={nightMode ? "rounded-xl border border-cyan-400/20 bg-slate-950/70 p-4" : "rounded-xl border border-slate-300 bg-white p-4"}>
                  <summary className="cursor-pointer font-semibold">GRIB Inventory Preview</summary>
                  <pre className={`mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-current/10 p-3 text-xs leading-5 ${nightMode ? "bg-black/30 text-cyan-100" : "bg-slate-50 text-slate-800"}`}>
                    {gribSummary.inventoryPreview || "No inventory preview returned."}
                  </pre>
                </details>
              </div>
            ) : (
              <div className={`mt-4 rounded-xl border border-current/10 p-3 text-sm ${theme.muted}`}>
                Import a GRIB file to display route-aware wind and sea guidance on the map.
              </div>
            )}
          </div>

          <div className="relative mt-4 overflow-hidden rounded-2xl border border-current/20">
            <div ref={mapElRef} className="h-[560px] w-full bg-slate-800" />

            <button
              type="button"
              className={`absolute left-4 top-4 z-40 rounded-xl border px-3 py-2 text-xs font-semibold shadow-2xl shadow-black/30 backdrop-blur-md disabled:cursor-not-allowed disabled:opacity-50 ${
                nightMode
                  ? "border-cyan-300/40 bg-slate-950/85 text-cyan-50 hover:bg-cyan-400/20"
                  : "border-slate-300 bg-white/90 text-slate-900 hover:bg-slate-100"
              }`}
              disabled={!ownShip}
              onClick={centerMapOnShip}
            >
              Center Ship
            </button>

            <div
              ref={shipMarkerRef}
              className="pointer-events-none absolute left-0 top-0 z-50 hidden"
              style={{ transformOrigin: "50% 50%" }}
              title="Own Ship"
            >
              <div className="relative grid h-16 w-16 place-items-center">
                <div className="absolute h-12 w-12 rounded-full border-2 border-cyan-200/80 bg-cyan-300/15 shadow-[0_0_22px_rgba(34,211,238,0.85)]" />
                <div
                  className="relative h-0 w-0"
                  style={{
                    borderLeft: "12px solid transparent",
                    borderRight: "12px solid transparent",
                    borderBottom: "38px solid #22d3ee",
                    filter: "drop-shadow(0 0 8px rgba(34,211,238,0.95))",
                  }}
                />
              </div>
            </div>

            <div className="pointer-events-none absolute right-4 top-4 z-40 w-44 rounded-2xl border border-white/20 bg-slate-950/80 p-3 text-xs text-cyan-50 shadow-2xl shadow-black/40 backdrop-blur-md">
              <div className="text-sm font-bold tracking-wide">Weather Source</div>
              <div className="mt-1 text-cyan-100/70">
                {gribSummary ? "Imported GRIB file loaded" : "Import a GRIB file to add weather data"}
              </div>
            </div>

            {selectedGribPoint ? (
              <div
                className={`absolute right-4 bottom-4 z-40 w-72 rounded-2xl border p-4 text-xs shadow-2xl shadow-black/40 backdrop-blur-md ${
                  nightMode
                    ? "border-cyan-300/30 bg-slate-950/90 text-cyan-50"
                    : "border-slate-300 bg-white/95 text-slate-950"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold tracking-wide">Selected GRIB Point</div>
                    <div className={`mt-1 ${nightMode ? "text-cyan-100/70" : "text-slate-500"}`}>
                      {formatLatLon(selectedGribPoint.lat, true)} / {formatLatLon(selectedGribPoint.lon, false)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                      nightMode
                        ? "border-cyan-300/30 text-cyan-50 hover:bg-cyan-300/10"
                        : "border-slate-300 text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => setSelectedGribPoint(null)}
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <div className={nightMode ? "text-cyan-100/60" : "text-slate-500"}>Wind</div>
                    <div className="font-semibold">{selectedGribPoint.wind}</div>
                  </div>
                  <div>
                    <div className={nightMode ? "text-cyan-100/60" : "text-slate-500"}>Gust</div>
                    <div className="font-semibold">{selectedGribPoint.gust}</div>
                  </div>
                  <div>
                    <div className={nightMode ? "text-cyan-100/60" : "text-slate-500"}>Seas</div>
                    <div className="font-semibold">{selectedGribPoint.seas}</div>
                  </div>
                  <div>
                    <div className={nightMode ? "text-cyan-100/60" : "text-slate-500"}>Swell</div>
                    <div className="font-semibold">
                      {selectedGribPoint.swell} / {selectedGribPoint.period}
                    </div>
                  </div>
                </div>
                {selectedGribPoint.valid ? (
                  <div className={`mt-3 ${nightMode ? "text-cyan-100/65" : "text-slate-500"}`}>
                    {selectedGribPoint.valid}
                  </div>
                ) : null}
              </div>
            ) : null}

            {gribSummary ? (
              <div className="pointer-events-none absolute bottom-4 left-4 z-40 w-56 rounded-2xl border border-white/20 bg-slate-950/80 p-3 text-xs text-cyan-50 shadow-2xl shadow-black/40 backdrop-blur-md">
                <div className="text-sm font-bold tracking-wide">GRIB Samples</div>
                <div className="mt-2 grid gap-1.5">
                  <MapLegendSwatch color="#22d3ee" label="Light" />
                  <MapLegendSwatch color="#facc15" label="Moderate" />
                  <MapLegendSwatch color="#f97316" label="Building" />
                  <MapLegendSwatch color="#ef4444" label="Heavy" />
                </div>
                <div className="mt-2 text-cyan-100/70">Click a point for wind and seas.</div>
              </div>
            ) : null}
          </div>

          <div className={`mt-3 text-sm ${theme.muted}`}>
            Center: {formatLatLon(activeLat, true)} / {formatLatLon(activeLon, false)} · Source: {gribSummary ? "GRIB file" : "No GRIB loaded"}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>GRIB Time</div>
            <div className="mt-2 text-2xl font-semibold">
              {gribSummary?.timeline?.[0]?.label ?? "--"}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {gribSummary?.timeline?.[0]?.valid ?? "Import GRIB"}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Wind</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatGribNumber(gribSummary?.timeline?.[0]?.windKt, 1, " kt")}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              From {formatGribDirection(gribSummary?.timeline?.[0]?.windDir)}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Seas</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatGribNumber(gribSummary?.timeline?.[0]?.seasFt, 1, " ft")}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              Combined seas from imported GRIB
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Swell</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatGribNumber(gribSummary?.timeline?.[0]?.swellFt, 1, " ft")}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {formatGribNumber(gribSummary?.timeline?.[0]?.swellPeriod, 1, " sec")}
            </div>
          </div>
        </section>

        <footer className={`mt-6 text-sm ${theme.muted}`}>Status: {status}</footer>
      </div>
    </main>
  );
}


function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="h-3 w-8 rounded-sm border border-white/20" style={{ background: color }} />
      <span className="font-semibold">{label}</span>
    </div>
  );
}

function MapLegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
