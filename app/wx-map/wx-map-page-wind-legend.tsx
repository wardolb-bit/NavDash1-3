"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

type WeatherCurrent = {
  time?: string;
  temperature_2m?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  precipitation?: number;
  weather_code?: number;
};

type MarineHourly = {
  time?: string[];
  wave_height?: number[];
  wave_direction?: number[];
  wave_period?: number[];
  wind_wave_height?: number[];
  swell_wave_height?: number[];
  swell_wave_direction?: number[];
  swell_wave_period?: number[];
};

type WeatherData = {
  current?: WeatherCurrent;
};

type MarineData = {
  hourly?: MarineHourly;
};

type WeatherLayerId = "wind" | "precipitation" | "clouds" | "temperature";

type WeatherLayerConfig = {
  id: WeatherLayerId;
  label: string;
  variable: string;
  opacity: number;
};

const FALLBACK_LAT = 13.4443;
const FALLBACK_LON = 144.7937;

const MAPLIBRE_CSS_ID = "maplibre-css";
const WEATHER_SOURCE_ID = "openmeteo-weather-source";
const WEATHER_LAYER_ID = "openmeteo-weather-layer";
const OWN_SHIP_SOURCE_ID = "own-ship-source";
const OWN_SHIP_LAYER_ID = "own-ship-layer";
const OWN_SHIP_HALO_LAYER_ID = "own-ship-halo-layer";

const WEATHER_LAYERS: WeatherLayerConfig[] = [
  {
    id: "wind",
    label: "Wind",
    variable: "wind_u_component_10m",
    opacity: 0.65,
  },
  {
    id: "precipitation",
    label: "Precip",
    variable: "precipitation",
    opacity: 0.7,
  },
  {
    id: "clouds",
    label: "Clouds",
    variable: "cloud_cover",
    opacity: 0.55,
  },
  {
    id: "temperature",
    label: "Temp",
    variable: "temperature_2m",
    opacity: 0.55,
  },
];

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

    if (typeof msg?.line === "string" && msg.line.startsWith("!AI")) return msg.line;
  } catch {
    if (eventData.startsWith("!AI")) return eventData;
  }

  return null;
}

function isOwnShipSentence(line: string) {
  return line.startsWith("!AIVDO") || line.startsWith("$AIVDO");
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

function ownShipGeoJson(ownShip: OwnShip | null, lat: number, lon: number) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          rotation: ownShip?.heading ?? ownShip?.cog ?? 0,
          label: "Own Ship",
        },
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
      },
    ],
  };
}

export default function WxMapTestPage() {
  const [nightMode, setNightMode] = useState(true);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [socketStatus, setSocketStatus] = useState("Disconnected");
  const [status, setStatus] = useState("Waiting for AIS own-ship position...");
  const [mapStatus, setMapStatus] = useState("Map loading...");
  const [activeLayer, setActiveLayer] = useState<WeatherLayerId>("wind");
  const [weatherLayerEnabled, setWeatherLayerEnabled] = useState(true);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [marine, setMarine] = useState<MarineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const shipMarkerRef = useRef<HTMLDivElement | null>(null);
  const maplibreRef = useRef<any>(null);
  const lastFetchKeyRef = useRef("");

  const activeLat = ownShip?.lat ?? FALLBACK_LAT;
  const activeLon = ownShip?.lon ?? FALLBACK_LON;
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

  const activeLayerConfig = WEATHER_LAYERS.find((layer) => layer.id === activeLayer) ?? WEATHER_LAYERS[0];

  function updateShipMarkerPosition() {
    const map = mapRef.current;
    const marker = shipMarkerRef.current;

    if (!map || !marker) return;

    const point = map.project([activeLon, activeLat]);
    const rotation = ownShip?.heading ?? ownShip?.cog ?? 0;

    marker.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) rotate(${rotation}deg)`;
    marker.style.display = "block";
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


  async function loadOpenMeteo(lat: number, lon: number) {
    setLoading(true);
    setStatus("Fetching Open-Meteo data for active position...");

    try {
      const weatherUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
        `&wind_speed_unit=kmh&timezone=UTC`;

      const marineUrl =
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
        `&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period` +
        `&timezone=UTC`;

      const [weatherRes, marineRes] = await Promise.all([
        fetch(weatherUrl),
        fetch(marineUrl),
      ]);

      if (!weatherRes.ok) throw new Error("Weather request failed");
      if (!marineRes.ok) throw new Error("Marine request failed");

      setWeather((await weatherRes.json()) as WeatherData);
      setMarine((await marineRes.json()) as MarineData);
      setStatus(
        usingAis
          ? "Open-Meteo updated from AIS own-ship position"
          : "Open-Meteo updated from fallback position"
      );
    } catch (err) {
      console.error(err);
      setStatus("Unable to load Open-Meteo point data");
    } finally {
      setLoading(false);
    }
  }

  function removeWeatherLayer(map: any) {
    if (!map) return;

    if (map.getLayer(WEATHER_LAYER_ID)) {
      map.removeLayer(WEATHER_LAYER_ID);
    }

    if (map.getSource(WEATHER_SOURCE_ID)) {
      map.removeSource(WEATHER_SOURCE_ID);
    }
  }

  function applyWeatherLayer(layerConfig: WeatherLayerConfig, enabled = weatherLayerEnabled) {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    removeWeatherLayer(map);

    if (!enabled) {
      setMapStatus("Weather layer off");
      return;
    }

    const darkParam = nightMode ? "&dark=true" : "";
    const omUrl =
      `https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json` +
      `?time_step=current_time_1H&variable=${layerConfig.variable}${darkParam}`;

    map.addSource(WEATHER_SOURCE_ID, {
      type: "raster",
      url: `om://${omUrl}`,
      maxzoom: 12,
      tileSize: 256,
    });

    map.addLayer({
      id: WEATHER_LAYER_ID,
      type: "raster",
      source: WEATHER_SOURCE_ID,
      paint: {
        "raster-opacity": layerConfig.opacity,
      },
    });

    setMapStatus(`${layerConfig.label} layer active`);
  }

  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:8081`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setSocketStatus(`Connected to ${wsUrl}`);
      setStatus("AIS websocket connected. Waiting for !AIVDO own-ship sentence...");
    };

    ws.onmessage = (event) => {
      const line = getNmeaLineFromMessage(String(event.data));
      if (!line) return;

      const decoded = decodeOwnShip(line);
      if (decoded) {
        setOwnShip(decoded);
        setStatus("AIS own-ship position received");
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

    async function initializeMap() {
      try {
        addMapLibreCss();

        const maplibreglModule = await import("maplibre-gl");
        const weatherLayerModule = await import("@openmeteo/weather-map-layer");

        if (cancelled || !mapElRef.current || mapRef.current) return;

        const maplibregl = maplibreglModule.default ?? maplibreglModule;
        const omProtocol = weatherLayerModule.omProtocol;

        maplibreRef.current = maplibregl;

        try {
          maplibregl.addProtocol("om", omProtocol);
        } catch {
          // Protocol may already be registered during hot reload.
        }

        const map = new maplibregl.Map({
          container: mapElRef.current,
          center: [activeLon, activeLat],
          zoom: 7,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
              [OWN_SHIP_SOURCE_ID]: {
                type: "geojson",
                data: ownShipGeoJson(ownShip, activeLat, activeLon) as any,
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

          applyWeatherLayer(activeLayerConfig, weatherLayerEnabled);
          setMapStatus(`${activeLayerConfig.label} layer active`);
          setTimeout(updateShipMarkerPosition, 100);
        });

        mapRef.current = map;
      } catch (err) {
        console.error(err);
        setMapStatus("Map failed to load. Check npm packages.");
        setStatus("MapLibre/Open-Meteo map package missing or failed to load.");
      }
    }

    initializeMap();

    return () => {
      cancelled = true;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const roundedLat = activeLat.toFixed(3);
    const roundedLon = activeLon.toFixed(3);
    const fetchKey = `${roundedLat},${roundedLon}`;

    if (lastFetchKeyRef.current === fetchKey) return;

    lastFetchKeyRef.current = fetchKey;
    loadOpenMeteo(activeLat, activeLon);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLat, activeLon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(OWN_SHIP_SOURCE_ID)) return;

    const source = map.getSource(OWN_SHIP_SOURCE_ID);
    source.setData(ownShipGeoJson(ownShip, activeLat, activeLon) as any);

    map.easeTo({
      center: [activeLon, activeLat],
      duration: 900,
      essential: true,
    });

    setTimeout(updateShipMarkerPosition, 100);
  }, [activeLat, activeLon, ownShip]);

  useEffect(() => {
    applyWeatherLayer(activeLayerConfig, weatherLayerEnabled);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, weatherLayerEnabled, nightMode]);

  const firstMarine = useMemo(() => {
    const h = marine?.hourly;
    if (!h?.time?.length) return null;

    return {
      time: h.time[0],
      waveHeight: h.wave_height?.[0],
      waveDirection: h.wave_direction?.[0],
      wavePeriod: h.wave_period?.[0],
      swellHeight: h.swell_wave_height?.[0],
      swellDirection: h.swell_wave_direction?.[0],
      swellPeriod: h.swell_wave_period?.[0],
    };
  }, [marine]);

  return (
    <main className={theme.page}>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className={theme.muted}>Ward Maritime Nav Console</div>
            <h1 className="text-3xl font-semibold tracking-wide">Weather Map</h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/wx" className={theme.button}>
              Back to Weather
            </Link>

            <Link href="/" className={theme.button}>
              Console
            </Link>

            

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

            <button
              className={theme.button}
              onClick={() => loadOpenMeteo(activeLat, activeLon)}
              disabled={loading}
            >
              {loading ? "Updating..." : "Refresh WX"}
            </button>
          </div>
        </header>

        <section className={`${theme.panel} mb-6 p-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">AIS Position Feed</h2>
              <div className={`mt-1 text-sm ${theme.muted}`}>{socketStatus}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className={usingAis ? theme.badgeGood : theme.badgeWarn}>
                {usingAis ? "AIS POSITION LIVE" : "FALLBACK POSITION"}
              </div>

              <div className={weatherLayerEnabled ? theme.badgeGood : theme.badgeWarn}>
                {mapStatus}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Latitude</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatLatLon(activeLat, true)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>{activeLat.toFixed(6)}°</div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Longitude</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatLatLon(activeLon, false)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>{activeLon.toFixed(6)}°</div>
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
              <h2 className="text-xl font-semibold">Open-Meteo Weather Layers</h2>
              <div className={`mt-1 text-sm ${theme.muted}`}>
                MapLibre weather layer centered on AIS own-ship. Toggle the layer type below.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {WEATHER_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  className={activeLayer === layer.id && weatherLayerEnabled ? theme.activeButton : theme.button}
                  onClick={() => {
                    setActiveLayer(layer.id);
                    setWeatherLayerEnabled(true);
                  }}
                >
                  {layer.label}
                </button>
              ))}

              <button
                className={!weatherLayerEnabled ? theme.activeButton : theme.button}
                onClick={() => setWeatherLayerEnabled((v) => !v)}
              >
                {weatherLayerEnabled ? "Layer Off" : "Layer On"}
              </button>
            </div>
          </div>

          <div className="relative mt-4 overflow-hidden rounded-2xl border border-current/20">
            <div ref={mapElRef} className="h-[560px] w-full bg-slate-800" />

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
              <div className="mb-2 text-sm font-bold tracking-wide">Wind Speed</div>
              <div className="space-y-1">
                <LegendRow color="#313695" label="0-5 kt" />
                <LegendRow color="#4575b4" label="5-10 kt" />
                <LegendRow color="#74add1" label="10-15 kt" />
                <LegendRow color="#abd9e9" label="15-20 kt" />
                <LegendRow color="#fee090" label="20-25 kt" />
                <LegendRow color="#fdae61" label="25-30 kt" />
                <LegendRow color="#f46d43" label="30-40 kt" />
                <LegendRow color="#d73027" label="40+ kt" />
              </div>
              <div className="mt-2 text-[10px] text-cyan-100/60">
                Approximate guide for Open-Meteo wind layer
              </div>
            </div>
          </div>

          <div className={`mt-3 text-sm ${theme.muted}`}>
            Center: {formatLatLon(activeLat, true)} / {formatLatLon(activeLon, false)} · Active layer:{" "}
            {weatherLayerEnabled ? activeLayerConfig.label : "Off"}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Condition</div>
            <div className="mt-2 text-2xl font-semibold">
              {weatherCodeLabel(weather?.current?.weather_code)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {weather?.current?.time ?? "—"} UTC
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Wind</div>
            <div className="mt-2 text-2xl font-semibold">
              {kmhToKnots(weather?.current?.wind_speed_10m)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              From {weather?.current?.wind_direction_10m ?? "—"}°{" "}
              {directionToCardinal(weather?.current?.wind_direction_10m)}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Seas</div>
            <div className="mt-2 text-2xl font-semibold">
              {metersToFeet(firstMarine?.waveHeight)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {firstMarine?.waveDirection ?? "—"}° {directionToCardinal(firstMarine?.waveDirection)}
            </div>
          </div>

          <div className={`${theme.card} p-4`}>
            <div className={theme.muted}>Swell</div>
            <div className="mt-2 text-2xl font-semibold">
              {metersToFeet(firstMarine?.swellHeight)}
            </div>
            <div className={`mt-2 text-sm ${theme.muted}`}>
              {firstMarine?.swellPeriod ? `${firstMarine.swellPeriod}s` : "—"}
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
