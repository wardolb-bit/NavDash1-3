"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Waypoint = { name: string; lat: number; lon: number };
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
type EncounterPoint = ForecastPoint & { eta: Date; validAt: Date; deltaHours: number };

const ENC_BRIGHTNESS_KEY = "navdash-enc-brightness";
const ENC_BRIGHTNESS_MIN = 40;
const ENC_BRIGHTNESS_MAX = 140;
const ENC_BRIGHTNESS_STEP = 10;

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

function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeLengthNm(route: Waypoint[]) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += nmBetween(route[i - 1], route[i]);
  return total;
}

function routeWaypointDistances(route: Waypoint[]) {
  const distances: number[] = [];
  let total = 0;
  route.forEach((wp, i) => {
    if (i > 0) total += nmBetween(route[i - 1], wp);
    distances.push(total);
  });
  return distances;
}

function pointAtDistance(route: Waypoint[], targetNm: number) {
  if (!route.length) return null;
  if (route.length === 1 || targetNm <= 0) return route[0];
  let travelled = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    const leg = nmBetween(a, b);
    if (travelled + leg >= targetNm) {
      const ratio = leg <= 0 ? 0 : (targetNm - travelled) / leg;
      return {
        name: "Expected vessel position",
        lat: a.lat + (b.lat - a.lat) * ratio,
        lon: a.lon + (b.lon - a.lon) * ratio,
      };
    }
    travelled += leg;
  }
  return route[route.length - 1];
}

function routeSliceBetweenDistances(route: Waypoint[], startNm: number, endNm: number) {
  if (route.length < 2) return [] as Array<[number, number]>;
  const total = routeLengthNm(route);
  const start = Math.max(0, Math.min(total, Math.min(startNm, endNm)));
  const end = Math.max(start, Math.min(total, Math.max(startNm, endNm)));
  const startPoint = pointAtDistance(route, start);
  const endPoint = pointAtDistance(route, end);
  if (!startPoint || !endPoint) return [] as Array<[number, number]>;

  const distances = routeWaypointDistances(route);
  const points: Array<[number, number]> = [[startPoint.lat, startPoint.lon]];
  route.forEach((wp, i) => {
    const d = distances[i];
    if (d > start && d < end) points.push([wp.lat, wp.lon]);
  });
  points.push([endPoint.lat, endPoint.lon]);
  return points;
}

function parseRtz(text: string): Waypoint[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return Array.from(doc.querySelectorAll("waypoint")).map((node, index) => {
    const pos = node.querySelector("position");
    return {
      name: node.getAttribute("name") || node.getAttribute("id") || `WP${String(index + 1).padStart(2, "0")}`,
      lat: Number(pos?.getAttribute("lat")),
      lon: Number(pos?.getAttribute("lon")),
    };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
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

  const totalNm = useMemo(() => routeLengthNm(route), [route]);
  const waypointDistances = useMemo(() => routeWaypointDistances(route), [route]);

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

      const map = L.map(mapEl.current, { attributionControl: false, zoomControl: true }).setView([20, 0], 3);
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

        if (mapEl.current) {
          mapEl.current.style.background = night ? "#071019" : "#dbe5e8";
        }

        if (!night) {
          dayBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
          }).addTo(map);
          daySeamarkLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
            maxZoom: 18,
          }).addTo(map);
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
        } else {
          encPane.style.filter = "";
        }
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
      const latlngs = route.map((wp) => [wp.lat, wp.lon] as [number, number]);
      L.polyline(latlngs, { color: "#22d3ee", weight: weather ? 2 : 3, opacity: weather ? 0.4 : 0.95 }).addTo(layer);
      route.forEach((wp, i) => {
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
    if (!Number.isFinite(dep.getTime())) return [];
    const count = weather.frames[0]?.points?.length || 0;
    const rows: EncounterPoint[] = [];
    for (let i = 0; i < count; i += 1) {
      const first = weather.frames[0].points[i];
      if (!first) continue;
      const eta = new Date(dep.getTime() + (first.distanceNm / speedKt) * 3600000);
      let bestFrame = weather.frames[0];
      let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - eta.getTime());
      for (const frame of weather.frames) {
        const delta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
        if (delta < bestDelta) {
          bestFrame = frame;
          bestDelta = delta;
        }
      }
      const p = bestFrame.points[i];
      if (!p) continue;
      rows.push({ ...p, eta, validAt: new Date(bestFrame.validAt), deltaHours: bestDelta / 3600000 });
    }
    return rows;
  }, [weather, speedKt, departure]);

  const displayedPoints = useMemo<ForecastPoint[]>(() => {
    if (!weather) return [];
    if (mode === "encounter") return encounter;
    return weather.frames[frameIndex]?.points || [];
  }, [weather, encounter, mode, frameIndex]);

  const maxSeas = useMemo(() => maxBy(encounter, "waveHeightFt") as EncounterPoint | null, [encounter]);
  const maxWind = useMemo(() => maxBy(encounter, "windKt") as EncounterPoint | null, [encounter]);
  const maxGust = useMemo(() => maxBy(encounter, "gustKt") as EncounterPoint | null, [encounter]);
  const selectedFrame = weather?.frames?.[frameIndex];
  const profileMaxSea = useMemo(() => Math.max(1, ...displayedPoints.map((p) => p.waveHeightFt || 0)), [displayedPoints]);
  const profileMaxWind = useMemo(() => Math.max(1, ...displayedPoints.map((p) => p.windKt || 0)), [displayedPoints]);

  const expectedVesselNm = useMemo(() => {
    if (mode !== "time" || !selectedFrame || !route.length) return null;
    const dep = new Date(departure);
    const valid = new Date(selectedFrame.validAt);
    if (!Number.isFinite(dep.getTime()) || !Number.isFinite(valid.getTime())) return null;
    return Math.max(0, Math.min(totalNm, ((valid.getTime() - dep.getTime()) / 3600000) * speedKt));
  }, [mode, selectedFrame, departure, route.length, totalNm, speedKt]);

  const profileLabels = useMemo(() => {
    if (!route.length || !totalNm) return [] as Array<{ name: string; distanceNm: number }>;
    const maxLabels = 6;
    if (route.length <= maxLabels) return route.map((wp, i) => ({ name: wp.name, distanceNm: waypointDistances[i] || 0 }));
    const selected = new Set<number>([0, route.length - 1]);
    for (let slot = 1; slot < maxLabels - 1; slot += 1) {
      selected.add(Math.round((slot / (maxLabels - 1)) * (route.length - 1)));
    }
    return Array.from(selected).sort((a, b) => a - b).map((i) => ({ name: route[i].name, distanceNm: waypointDistances[i] || 0 }));
  }, [route, waypointDistances, totalNm]);

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
          const wave = a.waveHeightFt;
          const color = seaColor(wave);
          const details = [
            `<b>${mode === "encounter" ? "Route encounter" : "Weather time"}</b>`,
            `<b>Seas:</b> ${wave === null ? "No wave data" : `${wave.toFixed(1)} ft`}`,
            a.wavePeriodSec !== null ? `<b>Period:</b> ${a.wavePeriodSec.toFixed(0)} s` : "",
            a.waveDirectionDeg !== null && a.waveDirectionDeg !== undefined ? `<b>Wave dir:</b> ${compass(a.waveDirectionDeg)} ${a.waveDirectionDeg.toFixed(0)}°` : "",
            a.windKt !== null ? `<b>Wind:</b> ${compass(a.windDirectionDeg)} ${a.windKt.toFixed(0)} kt` : "",
            `<b>Along route:</b> ${a.distanceNm.toFixed(0)} NM`,
          ].filter(Boolean).join("<br/>");

          L.polyline(routeSlice, {
            color,
            weight: 9,
            opacity: 0.7,
            lineCap: "round",
            lineJoin: "round",
          }).bindTooltip(details, { sticky: true, opacity: 0.97 }).addTo(layer);

          L.polyline(routeSlice, {
            color: "#e2e8f0",
            weight: 1,
            opacity: 0.35,
            interactive: false,
          }).addTo(layer);
        }
      }

      displayedPoints.forEach((p, index) => {
        const wave = p.waveHeightFt;
        const wind = p.windKt;
        const routePoint = pointAtDistance(route, p.distanceNm) || p;
        const details = [
          showSeas ? `<b>Seas:</b> ${wave === null ? "No wave data" : `${wave.toFixed(1)} ft`}` : "",
          p.wavePeriodSec !== null && showSeas ? `<b>Period:</b> ${p.wavePeriodSec.toFixed(0)} s` : "",
          p.waveDirectionDeg !== null && p.waveDirectionDeg !== undefined && showSeas ? `<b>Wave dir:</b> ${compass(p.waveDirectionDeg)} ${p.waveDirectionDeg.toFixed(0)}°` : "",
          showWind ? `<b>Wind:</b> ${wind === null ? "--" : `${compass(p.windDirectionDeg)} ${wind.toFixed(0)} kt`}` : "",
          p.gustKt !== null && showWind ? `<b>Gust:</b> ${p.gustKt.toFixed(0)} kt` : "",
          `<b>Along route:</b> ${p.distanceNm.toFixed(0)} NM`,
        ].filter(Boolean).join("<br/>");

        L.circleMarker([routePoint.lat, routePoint.lon], {
          radius: focusedIndex === index ? 8 : 4,
          color: focusedIndex === index ? "#f8fafc" : seaColor(wave),
          weight: focusedIndex === index ? 3 : 1,
          fillColor: seaColor(wave),
          fillOpacity: focusedIndex === index ? 0.95 : 0.7,
        }).bindTooltip(details, { direction: "top", opacity: 0.96 }).bindPopup([
          details,
          `<b>Wind source:</b> ${p.source}`,
          p.waveSource ? `<b>Wave source:</b> ${p.waveSource}` : "",
        ].filter(Boolean).join("<br/>")).addTo(layer);
      });

      if (expectedVesselNm !== null) {
        const position = pointAtDistance(route, expectedVesselNm);
        if (position && selectedFrame) {
          L.circleMarker([position.lat, position.lon], {
            radius: 9,
            color: "#f8fafc",
            weight: 2,
            fillColor: "#22d3ee",
            fillOpacity: 0.95,
          }).bindTooltip(`<b>EXPECTED VESSEL POSITION</b><br/>${expectedVesselNm.toFixed(0)} NM along route<br/>${formatWhen(new Date(selectedFrame.validAt))}`, {
            direction: "top",
            opacity: 0.98,
          }).addTo(layer);
          L.circleMarker([position.lat, position.lon], {
            radius: 15,
            color: "#22d3ee",
            weight: 1,
            fillOpacity: 0,
            opacity: 0.45,
            interactive: false,
          }).addTo(layer);
        }
      }
    }
    drawWeather();
  }, [displayedPoints, showWind, showSeas, mode, selectedFrame, route, focusedIndex, expectedVesselNm]);

  async function loadRouteFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseRtz(text);
      if (parsed.length < 2) throw new Error("No usable RTZ waypoints found.");
      setRoute(parsed);
      setRouteName(file.name);
      setWeather(null);
      setFrameIndex(0);
      setFocusedIndex(null);
      setStatus(`${parsed.length} waypoints loaded. Ready to analyze route weather.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read route.");
    }
  }

  async function analyzeWaypoints(waypoints: Waypoint[]) {
    if (waypoints.length < 2) return;
    setStatus("Sampling route weather…");
    setWeather(null);
    try {
      const windResponse = await fetch("/api/noaa-route-weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints }),
      });
      const windJson = await windResponse.json();
      if (!windResponse.ok) throw new Error(windJson?.error || "Route weather request failed.");
      let merged = windJson as WeatherResponse;
      const basePoints = merged.frames?.[0]?.points || [];
      const validTimes = merged.frames?.map((frame) => frame.validAt) || [];
      let waveMessage = "";
      if (basePoints.length && validTimes.length) {
        try {
          const waveResponse = await fetch("/api/gfs-wave-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              points: basePoints.map((p) => ({ lat: p.lat, lon: p.lon, distanceNm: p.distanceNm })),
              validTimes,
            }),
          });
          const waveJson = await waveResponse.json();
          if (waveResponse.ok) merged = mergeWave(merged, waveJson as WaveResponse);
          else waveMessage = ` Wave model unavailable: ${waveJson?.error || "unknown error"}`;
        } catch (waveError) {
          waveMessage = ` Wave model unavailable: ${waveError instanceof Error ? waveError.message : "request failed"}`;
        }
      }
      setWeather(merged);
      setFrameIndex(0);
      setFocusedIndex(null);
      if (merged.frames.some((frame) => frame.points.some((point) => point.waveHeightFt !== null))) {
        setStatus(`Route weather loaded. Waves: GFS-forced WaveWatch III. Winds: ${windJson.product}.`);
      } else {
        setStatus((windJson.note || `Wind loaded from ${windJson.product}; no wave data returned.`) + waveMessage);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Weather analysis failed.");
    }
  }

  async function loadCurrentRoute(autoAnalyze = false) {
    setLoadingCurrentRoute(true);
    setStatus("Loading current NavDash route…");
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Could not read current NavDash route.");
      if (!json?.hasRoute) throw new Error("There is no current shared NavDash route loaded.");
      const parsed: Waypoint[] = (Array.isArray(json?.waypoints) ? json.waypoints : [])
        .map((wp: any, index: number) => ({
          name: typeof wp?.name === "string" && wp.name.trim() ? wp.name.trim() : `WP${String(index + 1).padStart(2, "0")}`,
          lat: Number(wp?.lat ?? wp?.latitude),
          lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
        }))
        .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
      if (parsed.length < 2) throw new Error("The current NavDash route does not contain enough usable waypoints.");
      setRoute(parsed);
      setRouteName(typeof json?.routeName === "string" && json.routeName.trim() ? json.routeName.trim() : "Current NavDash Route");
      setWeather(null);
      setFrameIndex(0);
      setFocusedIndex(null);
      if (autoAnalyze) await analyzeWaypoints(parsed);
      else setStatus(`${parsed.length} waypoints loaded from the current NavDash route. Ready to analyze route weather.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load current NavDash route.");
    } finally {
      setLoadingCurrentRoute(false);
    }
  }

  async function analyze() {
    await analyzeWaypoints(route);
  }

  function occurrence(point: EncounterPoint | null) {
    if (!point) return null;
    return `Occurs ${point.distanceNm.toFixed(0)} NM along route • ETA ${formatWhen(point.eta)}`;
  }

  function profileXDistance(distanceNm: number) {
    if (totalNm <= 0) return 0;
    return Math.max(0, Math.min(1000, (distanceNm / totalNm) * 1000));
  }

  const seaProfile = displayedPoints.map((p) => {
    const y = 58 - ((p.waveHeightFt || 0) / profileMaxSea) * 36;
    return `${profileXDistance(p.distanceNm)},${y}`;
  }).join(" ");

  const windProfile = displayedPoints.map((p) => {
    const y = 108 - ((p.windKt || 0) / profileMaxWind) * 32;
    return `${profileXDistance(p.distanceNm)},${y}`;
  }).join(" ");

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-amber-500/25 bg-[#071019] px-3 py-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH ROUTE WEATHER</div>
          <div className="text-sm font-black">Route encounter and Weather Time</div>
        </div>
        <Link href="/bridge" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">MAIN</Link>
      </div>

      <div className="mb-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="border border-slate-700/50 bg-[#071019] p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml" className="hidden" onChange={(e) => e.target.files?.[0] && loadRouteFile(e.target.files[0])} /></label>
            <button type="button" onClick={() => loadCurrentRoute(false)} disabled={loadingCurrentRoute} className="border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200 disabled:opacity-40">{loadingCurrentRoute ? "LOADING CURRENT ROUTE…" : "LOAD CURRENT ROUTE"}</button>
            <button type="button" disabled={route.length < 2} onClick={analyze} className="border border-emerald-400/40 bg-[#08130f] px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-40">ANALYZE ROUTE</button>
            <button type="button" onClick={() => setMode("encounter")} className={`border px-3 py-2 text-[10px] font-black ${mode === "encounter" ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>ROUTE ENCOUNTER</button>
            <button type="button" disabled={!weather} onClick={() => setMode("time")} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${mode === "time" ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>WEATHER TIME</button>
          </div>

          {weather && (
            <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MODE</div><div className="mt-1 text-xs font-black text-cyan-200">{mode === "encounter" ? "ROUTE ENCOUNTER" : "WEATHER TIME"}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MAX SEAS</div><div className="mt-1 text-lg font-black text-[#f1d56b]">{maxSeas?.waveHeightFt == null ? "--" : `${maxSeas.waveHeightFt.toFixed(1)} ft`}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">MAX WIND</div><div className="mt-1 text-lg font-black text-cyan-300">{maxWind?.windKt == null ? "--" : `${compass(maxWind.windDirectionDeg)} ${maxWind.windKt.toFixed(0)} kt`}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] px-3 py-2"><div className="text-[8px] font-black tracking-widest text-slate-500">{mode === "time" ? "FORECAST VALID" : "ROUTE LENGTH"}</div><div className="mt-1 text-xs font-black text-slate-200">{mode === "time" && selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : `${totalNm.toFixed(0)} NM`}</div></div>
            </div>
          )}

          <div className="relative overflow-hidden border border-slate-800">
            <div id="route-weather-lab-map" ref={mapEl} style={{ width: "100%", height: "58vh", minHeight: 480, background: "#0a141d" }} />
            {weather && <div className="pointer-events-none absolute bottom-2 left-2 border border-slate-700/70 bg-[#050a0f]/90 px-2 py-1 text-[9px] font-bold text-slate-300">Sea-state ribbon follows loaded route • hover for details</div>}
          </div>

          {weather && mode === "time" && (
            <div className="mt-2 border border-slate-800 bg-[#050a0f] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-black"><span className="text-slate-400">WEATHER TIME</span><span className="text-cyan-300">{selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</span></div>
              <input className="w-full accent-amber-400" type="range" min={0} max={Math.max(0, weather.frames.length - 1)} value={frameIndex} onChange={(e) => setFrameIndex(Number(e.target.value))} />
              <div className="mt-2 flex justify-between text-[9px] text-slate-500"><span>EARLIEST</span><span>GHOST VESSEL SHOWS EXPECTED POSITION</span><span>LATEST</span></div>
            </div>
          )}

          {weather && displayedPoints.length > 1 && (
            <div className="mt-2 border border-slate-800 bg-[#050a0f] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">ROUTE PROFILE</div><div className="text-[9px] text-slate-600">Distance-based, using names from the loaded route. Tap or hover a sample to highlight it on the map.</div></div>
                <div className="text-right text-[9px] font-bold text-slate-500"><span className="text-[#f1d56b]">SEA HEIGHT</span> / <span className="text-cyan-300">WIND</span></div>
              </div>
              <svg viewBox="0 0 1000 160" className="h-[160px] w-full" onMouseLeave={() => {}}>
                <line x1="0" y1="62" x2="1000" y2="62" stroke="#334155" strokeWidth="1" />
                <line x1="0" y1="112" x2="1000" y2="112" stroke="#334155" strokeWidth="1" />
                <polyline points={seaProfile} fill="none" stroke="#f1d56b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={windProfile} fill="none" stroke="#67e8f9" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

                {profileLabels.map((label, i) => {
                  const x = profileXDistance(label.distanceNm);
                  const anchor = i === 0 ? "start" : i === profileLabels.length - 1 ? "end" : "middle";
                  return <g key={`label-${i}`}><line x1={x} y1="116" x2={x} y2="123" stroke="#64748b" strokeWidth="1" /><text x={x} y="140" textAnchor={anchor} fill="#94a3b8" fontSize="14" fontWeight="700">{label.name}</text><text x={x} y="155" textAnchor={anchor} fill="#475569" fontSize="11">{label.distanceNm.toFixed(0)} NM</text></g>;
                })}

                {expectedVesselNm !== null && (
                  <g>
                    <line x1={profileXDistance(expectedVesselNm)} y1="46" x2={profileXDistance(expectedVesselNm)} y2="124" stroke="#22d3ee" strokeWidth="2" strokeDasharray="5 4" />
                    <path d={`M ${profileXDistance(expectedVesselNm) - 7} 38 L ${profileXDistance(expectedVesselNm) + 7} 38 L ${profileXDistance(expectedVesselNm)} 50 Z`} fill="#22d3ee" stroke="#f8fafc" strokeWidth="1" />
                  </g>
                )}

                {displayedPoints.map((p, i) => {
                  const x = profileXDistance(p.distanceNm);
                  const seaY = 58 - ((p.waveHeightFt || 0) / profileMaxSea) * 36;
                  const windY = 108 - ((p.windKt || 0) / profileMaxWind) * 32;
                  const selectedText = `${p.distanceNm.toFixed(0)} NM • ${p.waveHeightFt == null ? "--" : `${p.waveHeightFt.toFixed(1)} ft`} • ${p.windKt == null ? "--" : `${compass(p.windDirectionDeg)} ${p.windKt.toFixed(0)} kt`}`;
                  const selectedWidth = Math.max(180, Math.min(350, selectedText.length * 7 + 24));
                  return (
                    <g key={`profile-${i}`} onMouseEnter={() => setFocusedIndex(i)} onClick={() => setFocusedIndex((current) => current === i ? null : i)} style={{ cursor: "pointer" }}>
                      <rect x={Math.max(0, x - 24)} y="0" width="48" height="116" fill="transparent" />
                      <circle cx={x} cy={seaY} r={focusedIndex === i ? 7 : 4} fill={seaColor(p.waveHeightFt)} stroke="#f8fafc" strokeWidth={focusedIndex === i ? 2 : 0} />
                      <circle cx={x} cy={windY} r={focusedIndex === i ? 6 : 3} fill="#67e8f9" />
                      {focusedIndex === i && (
                        <g pointerEvents="none">
                          <rect x="8" y="3" width={selectedWidth} height="24" rx="5" fill="#03070b" fillOpacity="0.97" stroke="#64748b" strokeWidth="1" />
                          <text x="20" y="19" fill="#e2e8f0" fontSize="13" fontWeight="800">{selectedText}</text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </section>

        <aside className="space-y-2">
          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">VOYAGE</div>
            <div className="mt-1 truncate text-sm font-black text-cyan-200">{routeName}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[9px] font-black text-slate-500">DEPARTURE<input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label>
              <label className="text-[9px] font-black text-slate-500">SPEED KT<input type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(e) => setSpeedKt(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">WPTS</div><div className="font-black">{route.length || "--"}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">NM</div><div className="font-black">{route.length ? totalNm.toFixed(0) : "--"}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">HOURS</div><div className="font-black">{route.length ? (totalNm / speedKt).toFixed(1) : "--"}</div></div>
            </div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">MAX SEAS ALONG VOYAGE</div><span className="text-[9px] font-black text-cyan-300">WW3</span></div>
            <div className="mt-2 text-4xl font-black text-[#f1d56b]">{maxSeas?.waveHeightFt == null ? "NO WAVE DATA" : `${maxSeas.waveHeightFt.toFixed(1)} ft`}</div>
            {maxSeas?.wavePeriodSec != null && <div className="mt-1 text-sm text-slate-300">{maxSeas.wavePeriodSec.toFixed(0)} s • {compass(maxSeas.waveDirectionDeg)}</div>}
            <div className="mt-2 text-[10px] font-bold text-slate-400">{occurrence(maxSeas) || "No route wave sample available."}</div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">MAX WIND ALONG VOYAGE</div><span className="text-[9px] font-black text-cyan-300">NOAA</span></div>
            <div className="mt-2 text-4xl font-black text-cyan-300">{maxWind?.windKt == null ? "NO WIND DATA" : `${maxWind.windKt.toFixed(0)} kt`}</div>
            {maxWind?.windDirectionDeg != null && <div className="mt-1 text-sm text-slate-300">{compass(maxWind.windDirectionDeg)} • GUST {maxGust?.gustKt == null ? "--" : `${maxGust.gustKt.toFixed(0)} kt`}</div>}
            <div className="mt-2 text-[10px] font-bold text-slate-400">{occurrence(maxWind) || "No route wind sample available."}</div>
          </section>

          {weather && (
            <section className="border border-slate-700/50 bg-[#071019] p-3">
              <div className="mb-2 flex items-center justify-between"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">DISPLAY</div><div className="text-[9px] text-slate-500">{weather.coveredSampleCount}/{weather.sampleCount} wind coverage</div></div>
              <div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showWind} onChange={(e) => setShowWind(e.target.checked)} /> WIND</label><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showSeas} onChange={(e) => setShowSeas(e.target.checked)} /> SEAS</label></div>
            </section>
          )}

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">STATUS</div>
            <div className="mt-2 text-[11px] leading-relaxed text-slate-300">{status}</div>
          </section>
        </aside>
      </div>

      {weather && displayedPoints.length > 0 && (
        <section className="border border-slate-700/50 bg-[#071019] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">WEATHER ALONG ROUTE</div><div className="text-xs font-black text-slate-200">{mode === "encounter" ? "Conditions matched to vessel ETA at each sample" : `Snapshot valid ${selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}`}</div></div>{mode === "encounter" && <div className="text-[9px] text-slate-500">ETA match tolerance shown in VALID column</div>}</div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[10px]"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="p-2">NM</th><th className="p-2">ETA / VALID</th><th className="p-2">WIND</th><th className="p-2">GUST</th><th className="p-2">SEAS</th><th className="p-2">PERIOD</th><th className="p-2">WAVE DIR</th><th className="p-2">SOURCE</th></tr></thead><tbody>{displayedPoints.map((p, i) => { const enc = mode === "encounter" ? (p as EncounterPoint) : null; return <tr key={i} className={`border-b border-slate-900 ${focusedIndex === i ? "bg-cyan-400/10" : ""}`} onMouseEnter={() => setFocusedIndex(i)} onMouseLeave={() => setFocusedIndex(null)}><td className="p-2 font-black text-slate-200">{p.distanceNm.toFixed(0)}</td><td className="p-2 text-slate-400">{enc ? <><div>{formatWhen(enc.eta)}</div><div className="text-[8px] text-slate-600">valid {formatWhen(enc.validAt)} • Δ {enc.deltaHours.toFixed(1)}h</div></> : selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</td><td className="p-2 font-black text-cyan-200">{p.windKt == null ? "--" : `${compass(p.windDirectionDeg)} ${p.windKt.toFixed(0)} kt`}</td><td className="p-2">{p.gustKt == null ? "--" : `${p.gustKt.toFixed(0)} kt`}</td><td className="p-2 font-black" style={{ color: seaColor(p.waveHeightFt) }}>{p.waveHeightFt == null ? "--" : `${p.waveHeightFt.toFixed(1)} ft`}</td><td className="p-2">{p.wavePeriodSec == null ? "--" : `${p.wavePeriodSec.toFixed(0)} s`}</td><td className="p-2">{p.waveDirectionDeg == null ? "--" : `${compass(p.waveDirectionDeg)} ${p.waveDirectionDeg.toFixed(0)}°`}</td><td className="p-2 text-[8px] text-slate-500">{p.waveSource ? `${p.source} • ${p.waveSource}` : p.source}</td></tr>; })}</tbody></table></div>
        </section>
      )}
    </main>
  );
}
