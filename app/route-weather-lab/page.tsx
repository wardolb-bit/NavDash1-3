"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeRouteWaypoints,
  parseRtzRouteXml,
  pointAtRouteDistanceNm,
  routeDistanceNm,
  routeGeometryPoints,
  routeSliceBetweenDistances as canonicalRouteSliceBetweenDistances,
  type LegGeometry,
} from "../../lib/routeNavigation";
import { projectPositionOntoRouteGeometry } from "../../lib/routeProgress";
import { useOwnShipAis } from "../../lib/useOwnShipAis";

type GeoPoint = { lat: number; lon: number };
type Waypoint = GeoPoint & { name: string; geometryType?: LegGeometry };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg?: number | null;
  source: string;
  waveSource?: string;
};
type Frame = { validAt: string; points: ForecastPoint[] };
type WeatherResponse = {
  provider: string;
  product: string;
  generatedAt: string;
  sampleCount: number;
  coveredSampleCount: number;
  frames: Frame[];
  note?: string | null;
};
type WaveResponse = {
  provider: string;
  product: string;
  frames: Array<{
    validAt: string;
    points: Array<{
      lat: number;
      lon: number;
      distanceNm: number;
      waveHeightFt: number | null;
      wavePeriodSec: number | null;
      waveDirectionDeg: number | null;
      source: string;
    }>;
  }>;
};
type EncounterPoint = ForecastPoint & { eta: Date; validAt: Date; deltaHours: number; leadHours: number; confidenceLabel: string; beyondHorizon: boolean };

const ENC_BRIGHTNESS_KEY = "navdash-enc-brightness";
const ROUTE_WEATHER_DEPARTURE_KEY = "navdash-route-weather-departure";
const ROUTE_WEATHER_SPEED_KEY = "navdash-route-weather-speed-kt";
const ENC_BRIGHTNESS_MIN = 40;
const ENC_BRIGHTNESS_MAX = 140;
const ENC_BRIGHTNESS_STEP = 10;
const ROUTE_GEOMETRY_STEP_NM = 50;
const LIVE_ROUTE_GEOMETRY_STEP_NM = 2;
const LIVE_ROUTE_ANCHOR_MAX_XTE_NM = 50;

function clampEncBrightness(value: number) {
  return Math.max(ENC_BRIGHTNESS_MIN, Math.min(ENC_BRIGHTNESS_MAX, Math.round(value / ENC_BRIGHTNESS_STEP) * ENC_BRIGHTNESS_STEP));
}

function readEncBrightness() {
  try {
    const stored = Number(window.localStorage.getItem(ENC_BRIGHTNESS_KEY));
    return Number.isFinite(stored) ? clampEncBrightness(stored) : 100;
  } catch {
    return 100;
  }
}

function longitudeNearReference(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function unwrapRouteForDisplay(route: Waypoint[]) {
  if (!route.length) return [] as Waypoint[];
  const unwrapped: Waypoint[] = [{ ...route[0] }];
  for (let i = 1; i < route.length; i += 1) {
    const previous = unwrapped[i - 1];
    unwrapped.push({ ...route[i], lon: longitudeNearReference(route[i].lon, previous.lon) });
  }
  return unwrapped;
}

function routeDisplayPoints(route: Waypoint[]) {
  const geometry = routeGeometryPoints(route, ROUTE_GEOMETRY_STEP_NM);
  if (!geometry.length) return [] as Array<[number, number]>;
  const result: Array<[number, number]> = [];
  let previousLon = geometry[0].lon;
  result.push([geometry[0].lat, previousLon]);
  for (let index = 1; index < geometry.length; index += 1) {
    const point = geometry[index];
    const lon = longitudeNearReference(point.lon, previousLon);
    result.push([point.lat, lon]);
    previousLon = lon;
  }
  return result;
}

function pointAtDistance(route: Waypoint[], targetNm: number) {
  const point = pointAtRouteDistanceNm(route, targetNm, ROUTE_GEOMETRY_STEP_NM);
  return point ? { name: "Expected vessel position", lat: point.lat, lon: point.lon } : null;
}

function routeSliceBetweenDistances(route: Waypoint[], startNm: number, endNm: number) {
  const geometry = canonicalRouteSliceBetweenDistances(route, startNm, endNm, ROUTE_GEOMETRY_STEP_NM);
  if (!geometry.length) return [] as Array<[number, number]>;
  const points: Array<[number, number]> = [];
  let previousLon = geometry[0].lon;
  points.push([geometry[0].lat, previousLon]);
  for (let index = 1; index < geometry.length; index += 1) {
    const point = geometry[index];
    const lon = longitudeNearReference(point.lon, previousLon);
    points.push([point.lat, lon]);
    previousLon = lon;
  }
  return points;
}

function parseRtz(text: string): Waypoint[] {
  const parsed = parseRtzRouteXml(text);
  return parsed.waypoints.map((waypoint, index) => ({
    name: waypoint.name?.trim() || waypoint.id?.trim() || `WP${String(index + 1).padStart(2, "0")}`,
    lat: waypoint.lat,
    lon: waypoint.lon,
    geometryType: waypoint.geometryType,
  }));
}

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatHours(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return "--";
  const rounded = Math.round(hours);
  const days = Math.floor(rounded / 24);
  const remainder = rounded % 24;
  return days > 0 ? `${days}d ${remainder}h` : `${remainder}h`;
}

function forecastConfidence(leadHours: number) {
  if (leadHours <= 72) return "HIGHER CONFIDENCE";
  if (leadHours <= 168) return "LOWER CONFIDENCE";
  if (leadHours <= 240) return "OUTLOOK";
  return "LONG-RANGE GUIDANCE";
}

function compass(deg: number | null | undefined) {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return "--";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function seaColor(wave: number | null | undefined) {
  if (wave === null || wave === undefined || !Number.isFinite(wave)) return "#64748b";
  if (wave >= 10) return "#ef4444";
  if (wave >= 7) return "#f59e0b";
  if (wave >= 5) return "#eab308";
  return "#22c55e";
}

function maxBy(points: ForecastPoint[], key: "waveHeightFt" | "windKt" | "gustKt") {
  return points.reduce<ForecastPoint | null>((best, p) => {
    const value = p[key];
    if (value === null || !Number.isFinite(value)) return best;
    if (!best || best[key] === null || (value as number) > (best[key] as number)) return p;
    return best;
  }, null);
}

function mergeWave(base: WeatherResponse, wave: WaveResponse | null): WeatherResponse {
  if (!wave?.frames?.length) return base;
  return {
    ...base,
    product: `${base.product} + ${wave.product}`,
    frames: base.frames.map((frame) => {
      const target = new Date(frame.validAt).getTime();
      let bestWaveFrame = wave.frames[0];
      let bestDelta = Math.abs(new Date(bestWaveFrame.validAt).getTime() - target);
      for (const candidate of wave.frames) {
        const delta = Math.abs(new Date(candidate.validAt).getTime() - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestWaveFrame = candidate;
        }
      }
      return {
        ...frame,
        points: frame.points.map((point) => {
          let nearest = bestWaveFrame?.points?.[0];
          let score = Number.POSITIVE_INFINITY;
          for (const wp of bestWaveFrame?.points || []) {
            const d = Math.abs(wp.distanceNm - point.distanceNm);
            if (d < score) {
              nearest = wp;
              score = d;
            }
          }
          if (!nearest) return point;
          return {
            ...point,
            waveHeightFt: nearest.waveHeightFt,
            wavePeriodSec: nearest.wavePeriodSec,
            waveDirectionDeg: nearest.waveDirectionDeg,
            waveSource: nearest.source,
          };
        }),
      };
    }),
  };
}

export default function RouteWeatherLabPage() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const weatherLayerRef = useRef<any>(null);
  const autoLoadStartedRef = useRef(false);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [routeName, setRouteName] = useState("No route loaded");
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [status, setStatus] = useState("Load an RTZ route or the current NavDash route to begin.");
  const [speedKt, setSpeedKt] = useState(9);
  const [loadingCurrentRoute, setLoadingCurrentRoute] = useState(false);
  const [departure, setDeparture] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:00`;
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [showWind, setShowWind] = useState(true);
  const [showSeas, setShowSeas] = useState(true);
  const [mode, setMode] = useState<"encounter" | "time">("encounter");
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const ownShip = useOwnShipAis();

  const totalNm = useMemo(() => routeDistanceNm(route), [route]);
  const liveRouteGeometry = useMemo(
    () => routeGeometryPoints(route, LIVE_ROUTE_GEOMETRY_STEP_NM),
    [route],
  );
  const liveRouteProjection = useMemo(
    () => ownShip ? projectPositionOntoRouteGeometry(ownShip, liveRouteGeometry) : null,
    [ownShip, liveRouteGeometry],
  );
  const liveRouteAnchor = liveRouteProjection && liveRouteProjection.crossTrackNm <= LIVE_ROUTE_ANCHOR_MAX_XTE_NM
    ? liveRouteProjection
    : null;

  useEffect(() => {
    try {
      const savedDeparture = window.localStorage.getItem(ROUTE_WEATHER_DEPARTURE_KEY);
      if (savedDeparture) setDeparture(savedDeparture);
      const savedSpeed = Number(window.localStorage.getItem(ROUTE_WEATHER_SPEED_KEY));
      if (Number.isFinite(savedSpeed) && savedSpeed >= 1 && savedSpeed <= 30) setSpeedKt(savedSpeed);
    } catch {}
  }, []);

  useEffect(() => {
    if (autoLoadStartedRef.current) return;
    autoLoadStartedRef.current = true;
    void loadCurrentRoute(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let brightnessMenu: HTMLDivElement | null = null;
    let encLayer: any = null;
    let dayBaseLayer: any = null;
    let daySeamarkLayer: any = null;

    async function init() {
      if (!mapEl.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapEl.current) return;
      if (!document.querySelector('link[data-route-weather-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-route-weather-leaflet", "true");
        document.head.appendChild(link);
      }

      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false, preferCanvas: false, worldCopyJump: true, minZoom: 3 }).setView([20, 0], 3);
      const encPane = map.createPane("routeWeatherEnc");
      encPane.style.zIndex = "250";

      const isNight = () => {
        try {
          return window.localStorage.getItem("navConsoleTheme") !== "day";
        } catch {
          return document.documentElement.dataset.navdashTheme !== "day";
        }
      };

      const encDisplayParams = () => JSON.stringify({
        ECDISParameters: {
          version: "10.9",
          DynamicParameters: {
            Parameter: [
              { name: "ColorScheme", value: 5 },
              { name: "DisplayFrames", value: 2 },
              { name: "DisplayFrameText", value: 0 },
            ],
          },
        },
      });

      const applyBrightness = (value = readEncBrightness()) => {
        encPane.style.filter = `brightness(${clampEncBrightness(value)}%)`;
      };

      const removeLayer = (layer: any) => {
        if (!layer) return;
        try { map.removeLayer(layer); } catch {}
      };

      const createMapLayers = (night: boolean) => {
        removeLayer(encLayer);
        removeLayer(dayBaseLayer);
        removeLayer(daySeamarkLayer);
        encLayer = null;
        dayBaseLayer = null;
        daySeamarkLayer = null;

        if (mapEl.current) mapEl.current.style.background = night ? "#071019" : "#dbe5e8";

        if (!night) {
          dayBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
          daySeamarkLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
        }

        encLayer = L.tileLayer.wms("/api/noaa-charts/wms", {
          pane: "routeWeatherEnc",
          layers: night ? "1,2,3,4,5,6,7" : "0,1,2,3,4,5,6,7",
          format: "image/png",
          transparent: true,
          version: "1.1.1",
          opacity: night ? 1 : 0.9,
          tileSize: 512,
          maxZoom: 18,
          updateWhenZooming: false,
          keepBuffer: 2,
          ...(night ? { display_params: encDisplayParams() } : {}),
        } as any).addTo(map);

        if (night) {
          encLayer.on?.("load", () => applyBrightness());
          applyBrightness();
        } else encPane.style.filter = "";
      };

      const closeBrightnessMenu = () => {
        brightnessMenu?.remove();
        brightnessMenu = null;
      };

      const onDocumentPointerDown = (event: PointerEvent) => {
        if (!brightnessMenu) return;
        if (event.target instanceof Node && brightnessMenu.contains(event.target)) return;
        closeBrightnessMenu();
      };

      const adjustBrightness = (delta: number) => {
        const next = clampEncBrightness(readEncBrightness() + delta);
        try { window.localStorage.setItem(ENC_BRIGHTNESS_KEY, String(next)); } catch {}
        if (isNight()) applyBrightness(next);
        window.dispatchEvent(new CustomEvent("navdash-enc-brightness-change", { detail: next }));
        return next;
      };

      const openBrightnessMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        closeBrightnessMenu();
        if (!mapEl.current) return;
        const day = !isNight();
        const menu = document.createElement("div");
        menu.style.cssText = "position:absolute;z-index:1700;min-width:205px;padding:6px;border-radius:7px;box-shadow:0 10px 28px rgba(0,0,0,.34);user-select:none;-webkit-user-select:none";
        menu.style.background = day ? "rgba(255,255,255,.98)" : "rgba(5,12,18,.98)";
        menu.style.border = day ? "1px solid rgba(15,23,42,.22)" : "1px solid rgba(241,213,107,.38)";
        const label = document.createElement("div");
        label.style.cssText = "padding:7px 12px 5px;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.07em";
        label.style.color = day ? "#586773" : "#91a0ad";
        const syncLabel = () => { label.textContent = `CHART BRIGHTNESS  ${readEncBrightness()}%`; };
        syncLabel();
        menu.appendChild(label);
        const addButton = (text: string, delta: number) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = text;
          button.style.cssText = "display:flex;width:100%;align-items:center;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px";
          button.style.color = day ? "#17212b" : "#e7edf3";
          button.addEventListener("mouseenter", () => { button.style.background = day ? "#f3f6f8" : "#15212c"; });
          button.addEventListener("mouseleave", () => { button.style.background = "transparent"; });
          button.addEventListener("click", (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            adjustBrightness(delta);
            syncLabel();
          });
          menu.appendChild(button);
        };
        addButton("CHART DIMMER  −", -ENC_BRIGHTNESS_STEP);
        addButton("CHART BRIGHTER  +", ENC_BRIGHTNESS_STEP);
        const rect = mapEl.current.getBoundingClientRect();
        mapEl.current.appendChild(menu);
        const menuRect = menu.getBoundingClientRect();
        const left = Math.max(6, Math.min(event.clientX - rect.left, rect.width - menuRect.width - 6));
        const top = Math.max(6, Math.min(event.clientY - rect.top, rect.height - menuRect.height - 6));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        brightnessMenu = menu;
      };

      const onThemeChange = (event: Event) => {
        const next = (event as CustomEvent<"bridge-night" | "day">).detail;
        createMapLayers(next !== "day");
      };

      createMapLayers(isNight());
      mapEl.current.addEventListener("contextmenu", openBrightnessMenu);
      document.addEventListener("pointerdown", onDocumentPointerDown, true);
      window.addEventListener("navdash-theme-change", onThemeChange);
      routeLayerRef.current = L.layerGroup().addTo(map);
      weatherLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      (map as any).__routeWeatherCleanup = () => {
        mapEl.current?.removeEventListener("contextmenu", openBrightnessMenu);
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        window.removeEventListener("navdash-theme-change", onThemeChange);
        closeBrightnessMenu();
      };
      setTimeout(() => map.invalidateSize(), 100);
    }

    init();
    return () => {
      cancelled = true;
      (mapRef.current as any)?.__routeWeatherCleanup?.();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    async function drawRoute() {
      const map = mapRef.current;
      const layer = routeLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (route.length < 2) return;
      const markerRoute = unwrapRouteForDisplay(route);
      const latlngs = routeDisplayPoints(route);
      L.polyline(latlngs, { color: "#22d3ee", weight: weather ? 2 : 3, opacity: weather ? 0.4 : 0.95 }).addTo(layer);
      markerRoute.forEach((wp, i) => {
        L.circleMarker([wp.lat, wp.lon], {
          radius: 4,
          color: "#f1d56b",
          weight: 2,
          fillColor: "#071019",
          fillOpacity: 1,
        }).bindTooltip(`${i + 1}. ${wp.name}`, { direction: "top" }).addTo(layer);
      });
      map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });
    }
    drawRoute();
  }, [route, weather]);

  const encounter = useMemo<EncounterPoint[]>(() => {
    if (!weather?.frames?.length || !Number.isFinite(speedKt) || speedKt <= 0) return [];

    const dep = new Date(departure);
    const usingLiveAnchor = Boolean(liveRouteAnchor && ownShip);
    if (!usingLiveAnchor && !Number.isFinite(dep.getTime())) return [];

    const anchorDistanceNm = liveRouteAnchor?.distanceNm ?? 0;
    const anchorTimeMs = usingLiveAnchor ? ownShip!.receivedAtMs : dep.getTime();
    const generatedAt = new Date(weather.generatedAt).getTime();
    const validFrameTimes = weather.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite);
    if (!validFrameTimes.length) return [];

    const latestValidMs = Math.max(...validFrameTimes);
    const latestFrame = weather.frames.reduce(
      (latest, frame) => new Date(frame.validAt).getTime() > new Date(latest.validAt).getTime() ? frame : latest,
      weather.frames[0],
    );
    const count = weather.frames[0]?.points?.length || 0;
    const rows: EncounterPoint[] = [];

    for (let i = 0; i < count; i += 1) {
      const first = weather.frames[0].points[i];
      if (!first) continue;
      if (usingLiveAnchor && first.distanceNm < anchorDistanceNm - 0.1) continue;

      const remainingToSampleNm = usingLiveAnchor
        ? Math.max(0, first.distanceNm - anchorDistanceNm)
        : first.distanceNm;
      const eta = new Date(anchorTimeMs + (remainingToSampleNm / speedKt) * 3600000);
      const leadHours = Number.isFinite(generatedAt)
        ? Math.max(0, (eta.getTime() - generatedAt) / 3600000)
        : Math.max(0, (eta.getTime() - anchorTimeMs) / 3600000);

      if (eta.getTime() > latestValidMs) {
        const latestPoint = latestFrame.points[i] || first;
        rows.push({
          ...latestPoint,
          distanceNm: first.distanceNm,
          lat: first.lat,
          lon: first.lon,
          windKt: null,
          windDirectionDeg: null,
          gustKt: null,
          waveHeightFt: null,
          wavePeriodSec: null,
          waveDirectionDeg: null,
          source: "Beyond forecast horizon",
          waveSource: undefined,
          eta,
          validAt: new Date(latestValidMs),
          deltaHours: (eta.getTime() - latestValidMs) / 3600000,
          leadHours,
          confidenceLabel: "BEYOND FORECAST HORIZON",
          beyondHorizon: true,
        });
        continue;
      }

      let bestFrame = weather.frames[0];
      let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - eta.getTime());
      for (const frame of weather.frames) {
        const delta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
        if (delta < bestDelta) {
          bestFrame = frame;
          bestDelta = delta;
        }
      }

      const point = bestFrame.points[i];
      if (!point) continue;
      rows.push({
        ...point,
        eta,
        validAt: new Date(bestFrame.validAt),
        deltaHours: bestDelta / 3600000,
        leadHours,
        confidenceLabel: forecastConfidence(leadHours),
        beyondHorizon: false,
      });
    }

    return rows;
  }, [weather, speedKt, departure, liveRouteAnchor, ownShip]);

  const routeWxCoverage = useMemo(() => {
    const usingLiveAnchor = Boolean(liveRouteAnchor && ownShip);
    const remainingNm = usingLiveAnchor ? Math.max(0, totalNm - liveRouteAnchor!.distanceNm) : totalNm;
    const voyageHours = Number.isFinite(speedKt) && speedKt > 0 ? remainingNm / speedKt : 0;
    if (!weather?.frames?.length || voyageHours <= 0) {
      return { voyageHours, coveredHours: 0, percent: 0, latestValid: null as Date | null };
    }

    const dep = new Date(departure);
    const anchorTimeMs = usingLiveAnchor ? ownShip!.receivedAtMs : dep.getTime();
    if (!Number.isFinite(anchorTimeMs)) {
      return { voyageHours, coveredHours: 0, percent: 0, latestValid: null as Date | null };
    }

    const latestMs = Math.max(...weather.frames.map((frame) => new Date(frame.validAt).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(latestMs)) {
      return { voyageHours, coveredHours: 0, percent: 0, latestValid: null as Date | null };
    }

    const coveredHours = Math.max(0, Math.min(voyageHours, (latestMs - anchorTimeMs) / 3600000));
    return {
      voyageHours,
      coveredHours,
      percent: voyageHours > 0 ? (coveredHours / voyageHours) * 100 : 0,
      latestValid: new Date(latestMs),
    };
  }, [weather, departure, totalNm, speedKt, liveRouteAnchor, ownShip]);

  const displayedPoints = useMemo<ForecastPoint[]>(() => {
    if (!weather) return [];
    if (mode === "encounter") return encounter;
    return weather.frames[frameIndex]?.points || [];
  }, [weather, encounter, mode, frameIndex]);

  const outlookReferenceMs = liveRouteAnchor && ownShip ? ownShip.receivedAtMs : Date.now();
  const next24Encounter = useMemo(
    () => encounter.filter((point) => !point.beyondHorizon && point.eta.getTime() >= outlookReferenceMs && point.eta.getTime() <= outlookReferenceMs + 24 * 3600000),
    [encounter, outlookReferenceMs],
  );
  const next48Encounter = useMemo(
    () => encounter.filter((point) => !point.beyondHorizon && point.eta.getTime() >= outlookReferenceMs && point.eta.getTime() <= outlookReferenceMs + 48 * 3600000),
    [encounter, outlookReferenceMs],
  );
  const maxSeas = useMemo(() => maxBy(next24Encounter, "waveHeightFt") as EncounterPoint | null, [next24Encounter]);
  const maxWind = useMemo(() => maxBy(next24Encounter, "windKt") as EncounterPoint | null, [next24Encounter]);
  const maxGust = useMemo(() => maxBy(next24Encounter, "gustKt") as EncounterPoint | null, [next24Encounter]);
  const maxSeas48 = useMemo(() => maxBy(next48Encounter, "waveHeightFt") as EncounterPoint | null, [next48Encounter]);
  const maxWind48 = useMemo(() => maxBy(next48Encounter, "windKt") as EncounterPoint | null, [next48Encounter]);
  const selectedFrame = weather?.frames?.[frameIndex];

  const expectedVesselNm = useMemo(() => {
    if (mode !== "time" || !selectedFrame || !route.length) return null;
    const valid = new Date(selectedFrame.validAt);
    if (!Number.isFinite(valid.getTime())) return null;

    if (liveRouteAnchor && ownShip) {
      const hoursAhead = Math.max(0, (valid.getTime() - ownShip.receivedAtMs) / 3600000);
      return Math.max(0, Math.min(totalNm, liveRouteAnchor.distanceNm + hoursAhead * speedKt));
    }

    const dep = new Date(departure);
    if (!Number.isFinite(dep.getTime())) return null;
    return Math.max(0, Math.min(totalNm, ((valid.getTime() - dep.getTime()) / 3600000) * speedKt));
  }, [mode, selectedFrame, departure, route.length, totalNm, speedKt, liveRouteAnchor, ownShip]);

  useEffect(() => {
    async function drawWeather() {
      const layer = weatherLayerRef.current;
      if (!mapRef.current || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (!displayedPoints.length) return;

      if (showSeas) {
        for (let i = 0; i < displayedPoints.length - 1; i += 1) {
          const a = displayedPoints[i];
          const b = displayedPoints[i + 1];
          const routeSlice = routeSliceBetweenDistances(route, a.distanceNm, b.distanceNm);
          if (routeSlice.length < 2) continue;
          const enc = mode === "encounter" ? (a as EncounterPoint) : null;
          const wave = a.waveHeightFt;
          const color = enc?.beyondHorizon ? "#64748b" : seaColor(wave);
          const details = [
            `<b>${mode === "encounter" ? "Route encounter" : "Weather time"}</b>`,
            enc ? `<b>Confidence:</b> ${enc.confidenceLabel}` : "",
            `<b>Seas:</b> ${wave === null ? "--" : `${wave.toFixed(1)} ft`}`,
            a.wavePeriodSec !== null ? `<b>Period:</b> ${a.wavePeriodSec.toFixed(0)} s` : "",
            a.waveDirectionDeg !== null && a.waveDirectionDeg !== undefined ? `<b>Wave dir:</b> ${compass(a.waveDirectionDeg)} ${a.waveDirectionDeg.toFixed(0)}°` : "",
            a.windKt !== null ? `<b>Wind:</b> ${compass(a.windDirectionDeg)} ${a.windKt.toFixed(0)} kt` : "",
            `<b>Along route:</b> ${a.distanceNm.toFixed(0)} NM`,
          ].filter(Boolean).join("<br/>");
          L.polyline(routeSlice, { color, weight: 9, opacity: enc?.beyondHorizon ? 0.4 : 0.7, lineCap: "round", lineJoin: "round" }).bindTooltip(details, { sticky: true, opacity: 0.97 }).addTo(layer);
          L.polyline(routeSlice, { color: "#e2e8f0", weight: 1, opacity: 0.35, interactive: false }).addTo(layer);
        }
      }

      displayedPoints.forEach((p, index) => {
        const enc = mode === "encounter" ? (p as EncounterPoint) : null;
        const wave = p.waveHeightFt;
        const wind = p.windKt;
        const routePoint = pointAtDistance(route, p.distanceNm) || p;
        const pointColor = enc?.beyondHorizon ? "#64748b" : seaColor(wave);
        const details = [
          enc ? `<b>Confidence:</b> ${enc.confidenceLabel}` : "",
          showSeas ? `<b>Seas:</b> ${wave === null ? "--" : `${wave.toFixed(1)} ft`}` : "",
          p.wavePeriodSec !== null && showSeas ? `<b>Period:</b> ${p.wavePeriodSec.toFixed(0)} s` : "",
          p.waveDirectionDeg !== null && p.waveDirectionDeg !== undefined && showSeas ? `<b>Wave dir:</b> ${compass(p.waveDirectionDeg)} ${p.waveDirectionDeg.toFixed(0)}°` : "",
          showWind ? `<b>Wind:</b> ${wind === null ? "--" : `${compass(p.windDirectionDeg)} ${wind.toFixed(0)} kt`}` : "",
          p.gustKt !== null && showWind ? `<b>Gust:</b> ${p.gustKt.toFixed(0)} kt` : "",
          `<b>Along route:</b> ${p.distanceNm.toFixed(0)} NM`,
        ].filter(Boolean).join("<br/>");
        L.circleMarker([routePoint.lat, routePoint.lon], {
          radius: focusedIndex === index ? 8 : 4,
          color: focusedIndex === index ? "#f8fafc" : pointColor,
          weight: focusedIndex === index ? 3 : 1,
          fillColor: pointColor,
          fillOpacity: focusedIndex === index ? 0.95 : 0.7,
        }).bindTooltip(details, { direction: "top", opacity: 0.96 }).bindPopup([
          details, `<b>Wind source:</b> ${p.source}`, p.waveSource ? `<b>Wave source:</b> ${p.waveSource}` : "",
        ].filter(Boolean).join("<br/>")).addTo(layer);
      });

      if (liveRouteAnchor && ownShip) {
        L.circleMarker([ownShip.lat, ownShip.lon], {
          radius: 7,
          color: "#071019",
          weight: 2,
          fillColor: "#f1d56b",
          fillOpacity: 1,
        }).bindTooltip(
          `<b>LIVE OWN SHIP</b><br/>${liveRouteAnchor.distanceNm.toFixed(1)} NM along route<br/>XTE ${liveRouteAnchor.crossTrackNm.toFixed(2)} NM`,
          { direction: "top", opacity: 0.98 },
        ).addTo(layer);
      }

      if (expectedVesselNm !== null) {
        const position = pointAtDistance(route, expectedVesselNm);
        if (position && selectedFrame) {
          const label = liveRouteAnchor ? "AIS-ANCHORED EXPECTED POSITION" : "EXPECTED VESSEL POSITION";
          L.circleMarker([position.lat, position.lon], { radius: 9, color: "#f8fafc", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.95 })
            .bindTooltip(`<b>${label}</b><br/>${expectedVesselNm.toFixed(0)} NM along route<br/>${formatWhen(new Date(selectedFrame.validAt))}`, { direction: "top", opacity: 0.98 }).addTo(layer);
          L.circleMarker([position.lat, position.lon], { radius: 15, color: "#22d3ee", weight: 1, fillOpacity: 0, opacity: 0.45, interactive: false }).addTo(layer);
        }
      }
    }
    drawWeather();
  }, [displayedPoints, showWind, showSeas, mode, selectedFrame, route, focusedIndex, expectedVesselNm, liveRouteAnchor, ownShip]);

  async function loadRouteFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseRtz(text);
      if (parsed.length < 2) throw new Error("No usable RTZ waypoints found.");
      setRoute(parsed); setRouteName(file.name); setWeather(null); setFrameIndex(0); setFocusedIndex(null);
      setStatus(`${parsed.length} waypoints loaded. Ready to analyze route weather.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not read route."); }
  }

  async function analyzeWaypoints(waypoints: Waypoint[]) {
    if (waypoints.length < 2) return;
    setStatus("Sampling route weather…"); setWeather(null);
    try {
      const windResponse = await fetch("/api/noaa-route-weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints }) });
      const windJson = await windResponse.json();
      if (!windResponse.ok) throw new Error(windJson?.error || "Route weather request failed.");
      let merged = windJson as WeatherResponse;
      const basePoints = merged.frames?.[0]?.points || [];
      const validTimes = merged.frames?.map((frame) => frame.validAt) || [];
      let waveMessage = "";
      if (basePoints.length && validTimes.length) {
        try {
          const waveResponse = await fetch("/api/gfs-wave-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: basePoints.map((p) => ({ lat: p.lat, lon: p.lon, distanceNm: p.distanceNm })), validTimes }) });
          const waveJson = await waveResponse.json();
          if (waveResponse.ok) merged = mergeWave(merged, waveJson as WaveResponse);
          else waveMessage = ` Wave model unavailable: ${waveJson?.error || "unknown error"}`;
        } catch (waveError) { waveMessage = ` Wave model unavailable: ${waveError instanceof Error ? waveError.message : "request failed"}`; }
      }
      setWeather(merged); setFrameIndex(0); setFocusedIndex(null);
      if (merged.frames.some((frame) => frame.points.some((point) => point.waveHeightFt !== null))) setStatus(`Route weather loaded. Waves: GFS-forced WaveWatch III. Winds: ${windJson.product}.`);
      else setStatus((windJson.note || `Wind loaded from ${windJson.product}; no wave data returned.`) + waveMessage);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Weather analysis failed."); }
  }

  async function loadCurrentRoute(autoAnalyze = false) {
    setLoadingCurrentRoute(true); setStatus("Loading current NavDash route…");
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Could not read current NavDash route.");
      if (!json?.hasRoute) throw new Error("There is no current shared NavDash route loaded.");
      const parsed: Waypoint[] = normalizeRouteWaypoints(json?.waypoints).map((waypoint, index) => ({
        name: waypoint.name?.trim() || `WP${String(index + 1).padStart(2, "0")}`,
        lat: waypoint.lat,
        lon: waypoint.lon,
        geometryType: waypoint.geometryType,
      }));
      if (parsed.length < 2) throw new Error("The current NavDash route does not contain enough usable waypoints.");
      setRoute(parsed); setRouteName(typeof json?.routeName === "string" && json.routeName.trim() ? json.routeName.trim() : "Current NavDash Route"); setWeather(null); setFrameIndex(0); setFocusedIndex(null);
      if (autoAnalyze) await analyzeWaypoints(parsed); else setStatus(`${parsed.length} waypoints loaded from the current NavDash route. Ready to analyze route weather.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not load current NavDash route."); }
    finally { setLoadingCurrentRoute(false); }
  }

  async function analyze() { await analyzeWaypoints(route); }
  function occurrence(point: EncounterPoint | null) { if (!point) return null; return `Occurs ${point.distanceNm.toFixed(0)} NM along route • ETA ${formatWhen(point.eta)}`; }

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-amber-500/25 bg-[#071019] px-3 py-2"><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH ROUTE WEATHER</div><div className="text-sm font-black">Route encounter and Weather Time</div></div><Link href="/bridge" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">MAIN</Link></div>
      <div className="mb-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="border border-slate-700/50 bg-[#071019] p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2"><label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml" className="hidden" onChange={(e) => e.target.files?.[0] && loadRouteFile(e.target.files[0])} /></label><button type="button" onClick={() => loadCurrentRoute(false)} disabled={loadingCurrentRoute} className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200 disabled:opacity-40">{loadingCurrentRoute ? "LOADING CURRENT ROUTE…" : "LOAD CURRENT ROUTE"}</button><button type="button" disabled={route.length < 2} onClick={analyze} className="border border-emerald-400/40 bg-[#08130f] px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-40">ANALYZE ROUTE</button><button type="button" onClick={() => setMode("encounter")} className={`border px-3 py-2 text-[10px] font-black ${mode === "encounter" ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>ROUTE ENCOUNTER</button><button type="button" disabled={!weather} onClick={() => setMode("time")} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${mode === "time" ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>WEATHER TIME</button></div>
          {weather && <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-5"><div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MODE</div><div className="mt-1 text-xs font-black text-cyan-200">{mode === "encounter" ? "ROUTE ENCOUNTER" : "WEATHER TIME"}</div></div><div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MAX SEAS · 24H</div><div className="mt-1 text-lg font-black text-[#f1d56b]">{maxSeas?.waveHeightFt == null ? "--" : `${maxSeas.waveHeightFt.toFixed(1)} ft`}</div><div className="mt-1 text-[8px] font-bold text-slate-500">48h {maxSeas48?.waveHeightFt == null ? "--" : `${maxSeas48.waveHeightFt.toFixed(1)} ft`}</div></div><div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MAX WIND · 24H</div><div className="mt-1 text-lg font-black text-cyan-300">{maxWind?.windKt == null ? "--" : `${compass(maxWind.windDirectionDeg)} ${maxWind.windKt.toFixed(0)} kt`}</div><div className="mt-1 text-[8px] font-bold text-slate-500">48h {maxWind48?.windKt == null ? "--" : `${maxWind48.windKt.toFixed(0)} kt`}</div></div><div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">{mode === "time" ? "FORECAST VALID" : "ROUTE LENGTH"}</div><div className="mt-1 text-xs font-black text-slate-200">{mode === "time" && selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : `${totalNm.toFixed(0)} NM`}</div></div><div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">ROUTE WX COVERAGE</div><div className="mt-1 text-xs font-black text-emerald-200">{formatHours(routeWxCoverage.coveredHours)} of {formatHours(routeWxCoverage.voyageHours)}</div><div className="mt-1 text-[9px] font-bold text-slate-500">{routeWxCoverage.percent.toFixed(0)}% of {liveRouteAnchor ? "remaining voyage" : "voyage"}</div></div></div>}
          <div className="relative overflow-hidden border border-slate-800"><div id="route-weather-lab-map" ref={mapEl} style={{ width: "100%", height: "58vh", minHeight: 480, background: "#0a141d" }} />{weather && <div className="pointer-events-none absolute bottom-2 left-2 border border-slate-700/70 bg-[#050a0f]/90 px-2 py-1 text-[9px] font-bold text-slate-300">Sea-state ribbon follows loaded route • arrows = wind flow • hover for details</div>}</div>
          {weather && mode === "time" && <div className="mt-2 border border-slate-800 bg-[#050a0f] p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-black"><span className="text-slate-400">WEATHER TIME</span><span className="text-cyan-300">{selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</span></div><input className="w-full accent-amber-400" type="range" min={0} max={Math.max(0, weather.frames.length - 1)} value={frameIndex} onChange={(e) => setFrameIndex(Number(e.target.value))} /><div className="mt-2 flex justify-between text-[9px] text-slate-500"><span>EARLIEST</span><span>{liveRouteAnchor ? `AIS ANCHORED • ${liveRouteAnchor.distanceNm.toFixed(0)} NM ALONG ROUTE` : "GHOST VESSEL USES DEPARTURE + SPEED"}</span><span>LATEST</span></div></div>}
        </section>
        <aside className="space-y-2">
          <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">VOYAGE</div><div className="mt-1 truncate text-sm font-black text-cyan-200">{routeName}</div><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[9px] font-black text-slate-500">DEPARTURE<input type="datetime-local" value={departure} onChange={(e) => { const next = e.target.value; setDeparture(next); try { window.localStorage.setItem(ROUTE_WEATHER_DEPARTURE_KEY, next); } catch {} }} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label><label className="text-[9px] font-black text-slate-500">SPEED KT<input type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(e) => { const next = Math.max(1, Number(e.target.value) || 1); setSpeedKt(next); try { window.localStorage.setItem(ROUTE_WEATHER_SPEED_KEY, String(next)); } catch {} }} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">WPTS</div><div className="font-black">{route.length || "--"}</div></div><div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">NM</div><div className="font-black">{route.length ? totalNm.toFixed(0) : "--"}</div></div><div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">HOURS</div><div className="font-black">{route.length ? (totalNm / speedKt).toFixed(1) : "--"}</div></div></div></section>
          <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">MAX SEAS · NEXT 24 HOURS</div><span className="text-[9px] font-black text-cyan-300">WW3</span></div><div className="mt-2 text-4xl font-black text-[#f1d56b]">{maxSeas?.waveHeightFt == null ? "NO WAVE DATA" : `${maxSeas.waveHeightFt.toFixed(1)} ft`}</div>{maxSeas?.wavePeriodSec != null && <div className="mt-1 text-sm text-slate-300">{maxSeas.wavePeriodSec.toFixed(0)} s • {compass(maxSeas.waveDirectionDeg)}</div>}<div className="mt-2 text-[10px] font-bold text-slate-400">{occurrence(maxSeas) || "No wave sample in the next 24 hours."}</div><div className="mt-2 border-t border-slate-800 pt-2 text-[10px] font-bold text-slate-500">48h outlook: {maxSeas48?.waveHeightFt == null ? "--" : `${maxSeas48.waveHeightFt.toFixed(1)} ft`}</div></section>
          <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">MAX WIND · NEXT 24 HOURS</div><span className="text-[9px] font-black text-cyan-300">NOAA</span></div><div className="mt-2 text-4xl font-black text-cyan-300">{maxWind?.windKt == null ? "NO WIND DATA" : `${maxWind.windKt.toFixed(0)} kt`}</div>{maxWind?.windDirectionDeg != null && <div className="mt-1 text-sm text-slate-300">{compass(maxWind.windDirectionDeg)} • GUST {maxGust?.gustKt == null ? "--" : `${maxGust.gustKt.toFixed(0)} kt`}</div>}<div className="mt-2 text-[10px] font-bold text-slate-400">{occurrence(maxWind) || "No wind sample in the next 24 hours."}</div><div className="mt-2 border-t border-slate-800 pt-2 text-[10px] font-bold text-slate-500">48h outlook: {maxWind48?.windKt == null ? "--" : `${maxWind48.windKt.toFixed(0)} kt`}</div></section>
          {weather && <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="mb-2 flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">DISPLAY</div><div className="text-[9px] text-slate-500">{weather.coveredSampleCount}/{weather.sampleCount} wind coverage</div></div><div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showWind} onChange={(e) => setShowWind(e.target.checked)} /> WIND</label><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showSeas} onChange={(e) => setShowSeas(e.target.checked)} /> SEAS</label></div></section>}
          <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">STATUS</div><div className="mt-2 text-[11px] leading-relaxed text-slate-300">{status}</div></section>
        </aside>
      </div>
      {weather && displayedPoints.length > 0 && <section className="border border-slate-700/50 bg-[#071019] p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">WEATHER ALONG ROUTE</div><div className="text-xs font-black text-slate-200">{mode === "encounter" ? "Conditions matched to vessel ETA at each sample" : `Snapshot valid ${selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}`}</div></div>{mode === "encounter" && <div className="text-[9px] text-slate-500">Forecast confidence and ETA match tolerance shown below</div>}</div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-[10px]"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="p-2">NM</th><th className="p-2">ETA / VALID</th>{mode === "encounter" && <th className="p-2">CONFIDENCE</th>}<th className="p-2">WIND</th><th className="p-2">GUST</th><th className="p-2">SEAS</th><th className="p-2">PERIOD</th><th className="p-2">WAVE DIR</th><th className="p-2">SOURCE</th></tr></thead><tbody>{displayedPoints.map((p, i) => { const enc = mode === "encounter" ? (p as EncounterPoint) : null; return <tr key={i} className={`border-b border-slate-900 ${focusedIndex === i ? "bg-cyan-400/10" : ""}`} onMouseEnter={() => setFocusedIndex(i)} onMouseLeave={() => setFocusedIndex(null)}><td className="p-2 font-black text-slate-200">{p.distanceNm.toFixed(0)}</td><td className="p-2 text-slate-300">{enc ? <><div>{formatWhen(enc.eta)}</div><div className="text-[9px] font-bold text-slate-400">{enc.beyondHorizon ? `horizon ends ${formatWhen(enc.validAt)} • +${enc.deltaHours.toFixed(1)}h` : `valid ${formatWhen(enc.validAt)} • Δ ${enc.deltaHours.toFixed(1)}h`}</div></> : selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</td>{enc && <td className={`p-2 text-[9px] font-black ${enc.beyondHorizon ? "text-slate-400" : enc.leadHours <= 72 ? "text-emerald-300" : enc.leadHours <= 168 ? "text-amber-200" : "text-amber-400"}`}>{enc.confidenceLabel}</td>}<td className="p-2 font-black text-cyan-200">{p.windKt == null ? "--" : `${compass(p.windDirectionDeg)} ${p.windKt.toFixed(0)} kt`}</td><td className="p-2">{p.gustKt == null ? "--" : `${p.gustKt.toFixed(0)} kt`}</td><td className="p-2 font-black" style={{ color: enc?.beyondHorizon ? "#94a3b8" : seaColor(p.waveHeightFt) }}>{p.waveHeightFt == null ? "--" : `${p.waveHeightFt.toFixed(1)} ft`}</td><td className="p-2">{p.wavePeriodSec == null ? "--" : `${p.wavePeriodSec.toFixed(0)} s`}</td><td className="p-2">{p.waveDirectionDeg == null ? "--" : `${compass(p.waveDirectionDeg)} ${p.waveDirectionDeg.toFixed(0)}°`}</td><td className="p-2 text-[8px] text-slate-500">{p.waveSource ? `${p.source} • ${p.waveSource}` : p.source}</td></tr>; })}</tbody></table></div></section>}
    </main>
  );
}
