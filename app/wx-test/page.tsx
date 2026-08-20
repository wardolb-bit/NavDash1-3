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
};

type WxData = {
  ok: boolean;
  generatedAt: string;
  position: { lat: number; lon: number };
  nws?: {
    gridOffice?: string;
    gridX?: number;
    gridY?: number;
    forecastName?: string;
    shortForecast?: string;
    detailedForecast?: string;
    windSpeedText?: string;
    windDirection?: string;
    forecastWindKt?: number | null;
    alerts?: Array<{ event: string; headline?: string; severity?: string; urgency?: string }>;
  };
  ndbc?: {
    station?: string;
    distanceNm?: number;
    windKt?: number | null;
    gustKt?: number | null;
    waveFt?: number | null;
    note?: string;
  };
  pacific?: {
    localSource?: string;
    localText?: string;
    highSeasSource?: string;
    highSeasText?: string;
    highSeasNote?: string;
    parsed?: {
      maxWindKt?: number | null;
      maxSeasFt?: number | null;
      windText?: string;
      seasText?: string;
      windDisplayText?: string;
      seasDisplayText?: string;
      warnings?: string[];
    };
  };
  errors: string[];
};


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
    };
  } catch {
    return null;
  }
}

function toDDM(value?: number, type: "lat" | "lon" = "lat") {
  if (value === undefined || Number.isNaN(value)) return "--";

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi = type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const degWidth = type === "lat" ? 2 : 3;

  return `${deg.toString().padStart(degWidth, "0")}° ${min.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

function padCourse(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Math.round(value).toString().padStart(3, "0")}°T`;
}

function numOrNull(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function diffText(shipWind: number | null, forecastWind: number | null) {
  if (shipWind === null || forecastWind === null) return "Enter ship wind and refresh forecast.";
  const diff = Math.round(shipWind - forecastWind);
  if (diff >= 6) return `Observed ship wind is running ${diff} kt above forecast. Treat model guidance as undercalling conditions.`;
  if (diff <= -6) return `Observed ship wind is running ${Math.abs(diff)} kt below forecast.`;
  return `Ship wind and forecast are within ${Math.abs(diff)} kt.`;
}

function statusClass(shipWind: number | null, forecastWind: number | null) {
  if (shipWind === null || forecastWind === null) return "border-slate-700/70 bg-slate-950/45 text-slate-200";
  const diff = shipWind - forecastWind;
  if (diff >= 6) return "border-amber-400/60 bg-amber-950/30 text-amber-100";
  return "border-cyan-400/40 bg-cyan-950/20 text-cyan-100";
}

function alertTone(windKt: number | null, seasFt: number | null, pressureDropMb?: number | null) {
  if ((windKt ?? 0) >= 35 || (seasFt ?? 0) >= 15 || (pressureDropMb ?? 0) >= 6) {
    return { label: "RED", wordClassName: "text-red-300" };
  }
  if ((windKt ?? 0) >= 25 || (seasFt ?? 0) >= 10 || (pressureDropMb ?? 0) >= 3) {
    return { label: "AMBER", wordClassName: "text-amber-300" };
  }
  return { label: "NORMAL", wordClassName: "text-cyan-300" };
}

function trendArrow(current: number | null, reference: number | null) {
  if (current === null || reference === null) return "→";
  const diff = current - reference;
  if (diff >= 3) return "↑";
  if (diff <= -3) return "↓";
  return "→";
}

function safeMax(values: Array<number | null | undefined>) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}

function extractRangeFromDisplay(display: string | null | undefined) {
  if (!display || display === "--") return null;

  const match = display.match(/(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const low = Number(match[1]);
  const high = Number(match[2]);

  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  return {
    low: Math.min(low, high),
    high: Math.max(low, high),
  };
}

function rangeRealityText(observed: number | null, rangeDisplay: string, label: string) {
  if (observed === null) return `No observed ${label} input`;
  const range = extractRangeFromDisplay(rangeDisplay);
  if (!range) return `Observed ${label}: ${observed.toFixed(1)}`;

  if (observed < range.low) return `Below forecast range`;
  if (observed > range.high) return `Above forecast range`;
  return `Within forecast range`;
}

export default function WxTestPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();

  const pageClass = nightMode
    ? "min-h-screen bg-slate-950 text-slate-100"
    : "min-h-screen bg-white text-slate-950";

  const headerClass = nightMode
    ? "mb-6 flex flex-col gap-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 shadow-2xl shadow-cyan-950/30 md:flex-row md:items-center md:justify-between"
    : "mb-6 flex flex-col gap-4 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between";

  const navButtonClass = nightMode
    ? "inline-flex items-center justify-center rounded-xl border border-cyan-300/40 px-4 py-2 text-center text-sm font-medium text-cyan-100 hover:bg-cyan-400/10"
    : "inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-center text-sm font-semibold text-slate-900 hover:bg-white";

  const eyebrowClass = nightMode
    ? "text-xs uppercase tracking-[0.35em] text-cyan-300/80"
    : "text-xs uppercase tracking-[0.35em] text-slate-500";

  const titleClass = nightMode
    ? "mt-2 text-3xl font-semibold text-white"
    : "mt-2 text-3xl font-semibold text-slate-950";

  const subtitleClass = nightMode
    ? "mt-2 max-w-3xl text-sm text-slate-300"
    : "mt-2 max-w-3xl text-sm text-slate-600";

  const bridgeSummaryClass = nightMode
    ? "mt-6 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5"
    : "mt-6 rounded-2xl border border-slate-300 bg-white p-5";

  const summaryMiniCardClass = nightMode
    ? "rounded-xl border border-white/10 bg-black/20 p-3"
    : "rounded-xl border border-slate-300 bg-slate-50 p-3";

  const [lat, setLat] = useState("13.4443");
  const [lon, setLon] = useState("144.7937");
  const [shipWind, setShipWind] = useState("20");
  const [shipGust, setShipGust] = useState("");
  const [data, setData] = useState<WxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownShip, setOwnShip] = useState<OwnShip>({});
  const [wsStatus, setWsStatus] = useState("Connecting to AIS WebSocket...");
  const [lastWsMessage, setLastWsMessage] = useState("");


  useEffect(() => {
    const wsUrl = getAisWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsStatus(`Connected: ${wsUrl}`);
    ws.onerror = () => setWsStatus(`AIS WebSocket error: ${wsUrl}`);
    ws.onclose = () => setWsStatus(`AIS WebSocket closed: ${wsUrl}`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        setLastWsMessage(JSON.stringify(msg).slice(0, 500));

        if (msg.type === "nmea" && typeof msg.line === "string" && msg.line.startsWith("!AIVDO")) {
          const decoded = decodeAisPosition(msg.line);

          if (decoded?.lat !== undefined && decoded?.lon !== undefined) {
            setOwnShip(decoded);
            setLat(decoded.lat.toFixed(6));
            setLon(decoded.lon.toFixed(6));
          }
        }
      } catch {
        // Keep the weather page running if a non-JSON or malformed message arrives.
      }
    };

    return () => ws.close();
  }, []);

  const forecastWind = data?.nws?.forecastWindKt ?? null;
  const observedShipWind = numOrNull(shipWind);
  const observedShipGust = numOrNull(shipGust);
  const pacificWind = data?.pacific?.parsed?.maxWindKt ?? null;
  const pacificSeas = data?.pacific?.parsed?.maxSeasFt ?? null;
  const pacificWindDisplay = data?.pacific?.parsed?.windDisplayText ?? (pacificWind !== null ? `${pacificWind} kt` : "--");
  const pacificSeasDisplay = data?.pacific?.parsed?.seasDisplayText ?? (pacificSeas !== null ? `${pacificSeas} ft` : "--");
  const ndbcWind = data?.ndbc?.windKt ?? null;
  const ndbcGust = data?.ndbc?.gustKt ?? null;
  const ndbcSeas = data?.ndbc?.waveFt ?? null;
  const operationalWind = safeMax([observedShipWind, observedShipGust, pacificWind, ndbcWind, ndbcGust, forecastWind]);
  const operationalSeas = safeMax([pacificSeas, ndbcSeas]);
  const windRealityText = rangeRealityText(observedShipWind, pacificWindDisplay, "wind");
  const seaRealityText = rangeRealityText(ndbcSeas, pacificSeasDisplay, "seas");
  const tone = alertTone(operationalWind, operationalSeas);

  const comparison = useMemo(() => diffText(observedShipWind, forecastWind), [observedShipWind, forecastWind]);

  async function loadWx() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wx-test?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as WxData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown weather load error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={pageClass}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className={headerClass}>
          <div>
            <p className={eyebrowClass}>NavDash 1.3 Weather</p>
            <h1 className={titleClass}>WX Test Console</h1>
            <p className={subtitleClass}>
              Official NWS forecast, NWS alerts, nearest NDBC observation, Pacific text products, and ship-observed wind comparison. Open-Meteo is not used on this page.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Link href="/" className={navButtonClass}>
              Nav Console
            </Link>
            <Link href="/official-weather" className={navButtonClass}>
              Official Weather
            </Link>
            <button type="button" onClick={toggleTheme} className={navButtonClass}>
              {nightMode ? "Day Mode" : "Night Mode"}
            </button>
          </div>
        </header>

        
        <section className="mb-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">AIS WebSocket Position</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Own Ship Auto Position</h2>
              <p className="mt-2 text-sm text-slate-300">
                Reading the same local WebSocket feed as Position Report: <span className="font-mono text-cyan-100">ws://this-computer:8081</span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              {wsStatus}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Latitude</p>
              <p className="mt-1 font-mono text-cyan-100">{ownShip.lat !== undefined ? toDDM(ownShip.lat, "lat") : "--"}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Longitude</p>
              <p className="mt-1 font-mono text-cyan-100">{ownShip.lon !== undefined ? toDDM(ownShip.lon, "lon") : "--"}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">SOG</p>
              <p className="mt-1 font-mono text-cyan-100">{ownShip.sog !== undefined ? `${ownShip.sog.toFixed(1)} kt` : "--"}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">COG</p>
              <p className="mt-1 font-mono text-cyan-100">{padCourse(ownShip.cog)}</p>
            </div>
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">HDG</p>
              <p className="mt-1 font-mono text-cyan-100">{padCourse(ownShip.heading)}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Last message: {lastWsMessage || "Waiting for !AIVDO own-ship AIS message..."}
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Latitude</label>
            <input value={lat} onChange={(e) => setLat(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300" />
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Longitude</label>
            <input value={lon} onChange={(e) => setLon(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300" />
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Ship Wind kt</label>
            <input value={shipWind} onChange={(e) => setShipWind(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300" />
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Ship Gust kt</label>
            <input value={shipGust} onChange={(e) => setShipGust(e.target.value)} placeholder="optional" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300" />
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={loadWx} disabled={loading} className="rounded-xl bg-cyan-300 px-5 py-2 font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Loading..." : "Refresh WX Test"}
          </button>
          <p className="text-sm text-slate-400">Default position is Guam / Apra Harbor area.</p>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-400/50 bg-red-950/30 p-4 text-red-100">{error}</div>}

        <section className={bridgeSummaryClass}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] opacity-80">Bridge Summary</p>
              <h2 className="mt-2 text-2xl font-semibold">Operational Weather Status: <span className={tone.wordClassName}>{tone.label}</span></h2>
              <p className="mt-2 text-sm opacity-85">Uses ship input, NDBC observation, NWS point forecast, and parsed NOAA Pacific text. Raw NOAA text remains displayed below.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className={summaryMiniCardClass}>
                <p className="text-xs uppercase tracking-[0.2em] opacity-70">Max Wind</p>
                <p className="mt-1 font-mono text-lg">{operationalWind ?? "--"} kt</p>
                <p className="mt-1 font-mono text-xs opacity-75">{pacificWindDisplay}</p>
              </div>
              <div className={summaryMiniCardClass}>
                <p className="text-xs uppercase tracking-[0.2em] opacity-70">Max Seas</p>
                <p className="mt-1 font-mono text-lg">{operationalSeas ?? "--"} ft</p>
                <p className="mt-1 font-mono text-xs opacity-75">{pacificSeasDisplay}</p>
              </div>
              <div className={summaryMiniCardClass}>
                <p className="text-xs uppercase tracking-[0.2em] opacity-70">Wind Reality Check</p>
                <p className="mt-1 font-mono text-lg">{windRealityText}</p>
                <p className="mt-1 font-mono text-xs opacity-75">Ship {observedShipWind ?? "--"} kt / High Seas {pacificWindDisplay}</p>
              </div>
              <div className={summaryMiniCardClass}>
                <p className="text-xs uppercase tracking-[0.2em] opacity-70">Sea Reality Check</p>
                <p className="mt-1 font-mono text-lg">{seaRealityText}</p>
                <p className="mt-1 font-mono text-xs opacity-75">NDBC {ndbcSeas ?? "--"} ft / High Seas {pacificSeasDisplay}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] opacity-70">Wind Alert Logic</p>
              <p className="mt-2 text-sm">Amber at 25 kt. Red at 35 kt.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] opacity-70">Sea Alert Logic</p>
              <p className="mt-2 text-sm">Amber at 10 ft. Red at 15 ft.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] opacity-70">Warnings Found</p>
              <p className="mt-2 text-sm">{data?.pacific?.parsed?.warnings?.length ? data.pacific.parsed.warnings[0] : "No warning keyword parsed yet."}</p>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Official Forecast</p>
            <h2 className="mt-2 text-xl font-semibold text-white">NWS Marine/Point Forecast</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p><span className="text-slate-500">Period:</span> {data?.nws?.forecastName ?? "No data loaded"}</p>
              <p><span className="text-slate-500">Wind:</span> {data?.nws?.windDirection ?? "--"} {data?.nws?.windSpeedText ?? "--"}</p>
              <p><span className="text-slate-500">Parsed max:</span> {forecastWind ?? "--"} kt</p>
              <p><span className="text-slate-500">Forecast:</span> {data?.nws?.shortForecast ?? "--"}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Observed Nearby</p>
            <h2 className="mt-2 text-xl font-semibold text-white">NDBC Station</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p><span className="text-slate-500">Station:</span> {data?.ndbc?.station ?? "No data loaded"}</p>
              <p><span className="text-slate-500">Distance:</span> {data?.ndbc?.distanceNm ?? "--"} NM</p>
              <p><span className="text-slate-500">Wind:</span> {data?.ndbc?.windKt ?? "--"} kt</p>
              <p><span className="text-slate-500">Gust:</span> {data?.ndbc?.gustKt ?? "--"} kt</p>
              <p><span className="text-slate-500">Seas:</span> {data?.ndbc?.waveFt ?? "--"} ft</p>
              {data?.ndbc?.note && <p className="text-amber-200">{data.ndbc.note}</p>}
            </div>
          </div>

          <div className={`rounded-2xl border p-5 ${statusClass(observedShipWind, forecastWind)}`}>
            <p className="text-xs uppercase tracking-[0.25em] opacity-80">Reality Check</p>
            <h2 className="mt-2 text-xl font-semibold">Forecast vs Ship</h2>
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="opacity-70">Forecast max:</span> {forecastWind ?? "--"} kt</p>
              <p><span className="opacity-70">Ship observed:</span> {observedShipWind ?? "--"} kt</p>
              <p><span className="opacity-70">Ship gust:</span> {shipGust || "--"} kt</p>
              <p className="pt-2 text-base font-semibold">{comparison}</p>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Wave Guidance</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Seas / Wave Check</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p><span className="text-slate-500">NDBC observed seas:</span> {ndbcSeas ?? "--"} ft</p>
              <p><span className="text-slate-500">NOAA text seas:</span> {pacificSeasDisplay}</p>
              <p><span className="text-slate-500">Highest working value:</span> {operationalSeas ?? "--"} ft</p>
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{data?.pacific?.parsed?.seasText || "Refresh to parse seas from NOAA text."}</pre>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Wind Guidance</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Forecast Timeline Seed</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-slate-500">Now</p><p className="font-mono text-cyan-100">{observedShipWind ?? "--"} kt</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-slate-500">NWS</p><p className="font-mono text-cyan-100">{forecastWind ?? "--"} kt</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-slate-500">Pacific Text</p><p className="font-mono text-cyan-100">{pacificWindDisplay}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-slate-500">NDBC</p><p className="font-mono text-cyan-100">{ndbcWind ?? "--"} kt</p></div>
            </div>
            <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{data?.pacific?.parsed?.windText || "Refresh to parse winds from NOAA text."}</pre>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Trend / Alert Logic</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Bridge Flags</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>{operationalWind !== null && operationalWind >= 25 ? "⚠ Wind amber/red threshold met." : "Wind below amber threshold from parsed sources."}</p>
              <p>{operationalSeas !== null && operationalSeas >= 10 ? "⚠ Seas amber/red threshold met." : "Seas below amber threshold from parsed sources."}</p>
              <p>{observedShipWind !== null && forecastWind !== null && observedShipWind - forecastWind >= 6 ? "⚠ Ship wind is materially above NWS point forecast." : "No large ship-vs-NWS wind gap detected."}</p>
              <p className="text-xs text-slate-500">Full +6/+12/+24/+48/+72 gridded timeline is the next NOMADS/GFS Wave step.</p>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Pacific Official Product</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Local / Regional Marine Text</h2>
            <p className="mt-2 text-sm text-slate-400">{data?.pacific?.localSource ?? "No Pacific product loaded"}</p>
            <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-4 font-mono text-xs leading-relaxed text-slate-200">
{data?.pacific?.localText ?? "Refresh WX Test to load the official local/regional Pacific marine product for this position."}
            </pre>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Pacific Official Product</p>
            <h2 className="mt-2 text-xl font-semibold text-white">High Seas / Offshore Text</h2>
            <p className="mt-2 text-sm text-slate-400">{data?.pacific?.highSeasSource ?? "No high seas product loaded"}</p>
            <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-4 font-mono text-xs leading-relaxed text-slate-200">
{data?.pacific?.highSeasText ?? "Refresh WX Test to load the official Pacific high seas/offshore product."}
            </pre>
            {data?.pacific?.highSeasNote ? <p className="mt-3 text-sm text-amber-100/80">{data.pacific.highSeasNote}</p> : null}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-700/70 bg-slate-900/70 p-5">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Alerts</p>
          {data?.nws?.alerts?.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.nws.alerts.map((alert, idx) => (
                <div key={`${alert.event}-${idx}`} className="rounded-xl border border-amber-300/40 bg-amber-950/20 p-4">
                  <p className="font-semibold text-amber-100">{alert.event}</p>
                  <p className="mt-1 text-sm text-amber-100/80">{alert.headline || "No headline provided"}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-amber-200/70">{alert.severity || "Unknown"} / {alert.urgency || "Unknown"}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No active alerts loaded or no active alerts for this point.</p>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-slate-700/70 bg-slate-900/70 p-5">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Notes</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>Weather guidance is provided for watch reference and should be compared with official marine forecasts.</li>
            <li>NWS forecast is official where NWS point/grid coverage exists.</li>
            <li>NDBC station data is observed data, but station coverage offshore can be sparse.</li>
            <li>Pacific text products are official NOAA/NWS products and are shown as raw bridge-readable text.</li>
            <li>The bridge summary parses NOAA text for quick flags, but the raw official text remains displayed and should be read directly.</li>
            <li>For full gridded offshore model work later, the next upgrade is NOAA NOMADS GFS/GFS Wave parsing.</li>
          </ul>
          {data?.errors?.length ? <p className="mt-4 text-sm text-amber-200">Warnings: {data.errors.join(" | ")}</p> : null}
          {data?.generatedAt ? <p className="mt-4 text-xs text-slate-500">Generated: {new Date(data.generatedAt).toLocaleString()}</p> : null}
        </section>
      </div>
    </main>
  );
}
