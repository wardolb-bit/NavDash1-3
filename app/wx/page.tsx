"use client";

import { useEffect, useState } from "react";
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
    forecastLocation?: string;
    forecastDistanceNm?: number;
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
    summarySource?: string;
    summaryMode?: "local" | "regional" | "offshore";
    summaryText?: string;
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

function nextNoaaCycleRefresh(now = new Date()) {
  const refreshDelayMinutes = 35;
  const cycleHours = [0, 6, 12, 18];

  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of cycleHours) {
      const candidate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + dayOffset,
        hour,
        refreshDelayMinutes,
        0,
        0,
      ));

      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }

  return new Date(now.getTime() + 6 * 60 * 60 * 1000);
}

function formatUtcClock(date: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return "--";
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}

function formatCountdown(target: Date | null, tick = 0) {
  void tick;
  if (!target) return "--";

  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "due now";

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export default function WxTestPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();

  const pageClass = nightMode
    ? "min-h-screen bg-slate-950 text-slate-100"
    : "min-h-screen bg-white text-slate-950";

  const headerClass = nightMode
    ? "mb-4 rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl"
    : "mb-4 rounded-[2rem] border border-slate-300 bg-white p-5 shadow-sm";

  const navButtonClass = nightMode
    ? "inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center text-2xl font-bold text-slate-100 hover:bg-white/15"
    : "inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-center text-2xl font-bold text-slate-900 hover:bg-white";

  const eyebrowClass = nightMode
    ? "text-2xl font-bold uppercase tracking-[0.18em] text-slate-400"
    : "text-2xl font-bold uppercase tracking-[0.18em] text-slate-500";

  const titleClass = nightMode
    ? "mt-2 text-4xl font-black tracking-tight text-white"
    : "mt-2 text-4xl font-black tracking-tight text-slate-950";

  const subtitleClass = nightMode
    ? "mt-2 max-w-3xl text-2xl text-slate-400"
    : "mt-2 max-w-3xl text-2xl text-slate-600";

  const bridgeSummaryClass = nightMode
    ? "mt-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5"
    : "mt-4 rounded-2xl border border-slate-300 bg-white p-5";

  const summaryMiniCardClass = nightMode
    ? "rounded-xl border border-white/10 bg-black/20 p-3"
    : "rounded-xl border border-slate-300 bg-slate-50 p-3";

  const panelClass = nightMode
    ? "rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5"
    : "rounded-2xl border border-slate-300 bg-white p-5";

  const compactPanelClass = nightMode
    ? "rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4"
    : "rounded-2xl border border-slate-300 bg-white p-4";

  const innerCardClass = nightMode
    ? "rounded-xl border border-slate-700/70 bg-slate-950/50 p-3"
    : "rounded-xl border border-slate-300 bg-slate-50 p-3";

  const labelClass = nightMode
    ? "text-2xl uppercase tracking-[0.25em] text-cyan-300/80"
    : "text-2xl uppercase tracking-[0.25em] text-slate-500";

  const smallLabelClass = nightMode
    ? "text-2xl uppercase tracking-[0.2em] text-slate-500"
    : "text-2xl uppercase tracking-[0.2em] text-slate-500";

  const cardTitleClass = nightMode
    ? "mt-2 text-2xl font-semibold text-white"
    : "mt-2 text-2xl font-semibold text-slate-950";

  const bodyTextClass = nightMode ? "text-slate-300" : "text-slate-700";
  const mutedTextClass = nightMode ? "text-slate-400" : "text-slate-500";
  const valueTextClass = nightMode ? "text-cyan-100" : "text-slate-950";
  const subtleTextClass = nightMode ? "text-slate-500" : "text-slate-500";


  const preClass = nightMode
    ? "mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 font-mono text-2xl text-slate-300"
    : "mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-300 bg-white p-3 font-mono text-2xl text-slate-950";

  const productPreClass = nightMode
    ? "mt-4 h-[42vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-4 font-mono text-2xl leading-relaxed text-slate-200"
    : "mt-4 h-[42vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-300 bg-white p-4 font-mono text-2xl leading-relaxed text-slate-950";

  const refreshButtonClass = nightMode
    ? "rounded-2xl bg-cyan-300 px-8 py-5 text-2xl font-black text-slate-950 shadow-lg shadow-cyan-950/20 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
    : "rounded-2xl bg-slate-900 px-8 py-5 text-2xl font-black text-white shadow-lg shadow-slate-900/20 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60";

  const [data, setData] = useState<WxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownShip, setOwnShip] = useState<OwnShip>({});
  const [wsStatus, setWsStatus] = useState("Connecting to AIS WebSocket...");
  const [lastWsMessage, setLastWsMessage] = useState("");
  const [lastAutoRefresh, setLastAutoRefresh] = useState<Date | null>(null);
  const [nextAutoRefresh, setNextAutoRefresh] = useState<Date | null>(null);
  const [countdownTick, setCountdownTick] = useState(0);


  useEffect(() => {
    const wsUrl = getAisWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsStatus(`Connected: ${wsUrl}`);
    ws.onerror = () => setWsStatus(`AIS WebSocket error: ${wsUrl}`);
    ws.onclose = () => setWsStatus(`AIS WebSocket closed: ${wsUrl}`);

    ws.onmessage = (event) => {
      try {
        let msg: any = event.data;

        try {
          msg = JSON.parse(event.data);
        } catch {
          // Some feeds may send plain NMEA text instead of JSON.
        }

        setLastWsMessage(typeof msg === "string" ? msg.slice(0, 500) : JSON.stringify(msg).slice(0, 500));

        const parsedLat = Number(msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude);
        const parsedLon = Number(msg?.lon ?? msg?.lng ?? msg?.longitude ?? msg?.position?.lon ?? msg?.position?.lng ?? msg?.position?.longitude);

        if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
          const parsedOwnShip = {
            lat: parsedLat,
            lon: parsedLon,
            sog: Number.isFinite(Number(msg?.sog ?? msg?.speed)) ? Number(msg?.sog ?? msg?.speed) : undefined,
            cog: Number.isFinite(Number(msg?.cog ?? msg?.course)) ? Number(msg?.cog ?? msg?.course) : undefined,
            heading: Number.isFinite(Number(msg?.heading ?? msg?.hdg)) ? Number(msg?.heading ?? msg?.hdg) : null,
          };

          setOwnShip(parsedOwnShip);
          return;
        }

        const nmeaLine =
          typeof msg === "string"
            ? msg.trim()
            : typeof msg?.line === "string"
              ? msg.line.trim()
              : "";

        if (nmeaLine.startsWith("!AIVDO")) {
          const decoded = decodeAisPosition(nmeaLine);

          if (decoded?.lat !== undefined && decoded?.lon !== undefined) {
            setOwnShip(decoded);
          }
        }
      } catch {
        // Keep the weather page running if a non-JSON or malformed message arrives.
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    if (ownShip.lat === undefined || ownShip.lon === undefined) {
      setNextAutoRefresh(null);
      return;
    }

    const schedule = () => {
      const next = nextNoaaCycleRefresh(new Date());
      setNextAutoRefresh(next);
      return next;
    };

    const next = schedule();
    const delayMs = Math.max(1000, next.getTime() - Date.now());

    const timer = window.setTimeout(() => {
      loadWx("auto");
      setLastAutoRefresh(new Date());
      schedule();
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [ownShip.lat, ownShip.lon]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownTick((value) => value + 1);
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  const forecastWind = data?.nws?.forecastWindKt ?? null;
  const pacificWind = data?.pacific?.parsed?.maxWindKt ?? null;
  const pacificSeas = data?.pacific?.parsed?.maxSeasFt ?? null;
  const pacificWindDisplay = data?.pacific?.parsed?.windDisplayText ?? (pacificWind !== null ? `${pacificWind} kt` : "--");
  const pacificSeasDisplay = data?.pacific?.parsed?.seasDisplayText ?? (pacificSeas !== null ? `${pacificSeas} ft` : "--");
  const bridgeForecastSource = data?.pacific?.summarySource ?? data?.pacific?.localSource ?? data?.pacific?.highSeasSource ?? "No forecast source loaded";
  const bridgeForecastMode = data?.pacific?.summaryMode === "local" ? "Nearest local forecast" : data?.pacific?.summaryMode === "regional" ? "Regional forecast" : data?.pacific?.summaryMode === "offshore" ? "Offshore forecast" : "Forecast source";
  const ndbcWind = data?.ndbc?.windKt ?? null;
  const ndbcGust = data?.ndbc?.gustKt ?? null;
  const ndbcSeas = data?.ndbc?.waveFt ?? null;
  const operationalWind = safeMax([pacificWind, ndbcWind, ndbcGust, forecastWind]);
  const operationalSeas = safeMax([pacificSeas, ndbcSeas]);
  const tone = alertTone(operationalWind, operationalSeas);


  async function loadWx(mode: "manual" | "auto" = "manual") {
    if (ownShip.lat === undefined || ownShip.lon === undefined) {
      setError("Current own-ship position is not available yet. Weather refresh waits for live AIS position.");
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wx?lat=${encodeURIComponent(ownShip.lat.toFixed(6))}&lon=${encodeURIComponent(ownShip.lon.toFixed(6))}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as WxData;
      setData(json);

      if (mode === "auto") {
        setLastAutoRefresh(new Date());
      }

      setNextAutoRefresh(nextNoaaCycleRefresh(new Date()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown weather load error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={pageClass}>
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-3 py-3 sm:px-4 lg:px-5">
        <header className={headerClass}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className={eyebrowClass}>NavDash Weather</p>
              <h1 className={titleClass}>WX Dashboard</h1>
              <p className={subtitleClass}>
                Official marine forecast source selected from actual vessel position, with NWS alerts and nearest usable observation where available.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-1 xl:min-w-[160px]">
              <button type="button" onClick={toggleTheme} className={navButtonClass}>
                {nightMode ? "Day Mode" : "Night Mode"}
              </button>
            </div>
          </div>
        </header>

        
        <section className={panelClass}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className={labelClass}>AIS WebSocket Position</p>
              <h2 className={cardTitleClass}>Own Ship Auto Position</h2>
              <p className="mt-2 text-2xl text-slate-300">
                Reading the same local WebSocket feed as Position Report: <span className={`font-mono ${valueTextClass}`}>ws://this-computer:8081</span>
              </p>
            </div>
            <div className={`rounded-xl border px-4 py-3 text-2xl ${nightMode ? "border-slate-700 bg-slate-950/70 text-slate-300" : "border-slate-300 bg-slate-50 text-slate-700"}`}>
              {wsStatus}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className={innerCardClass}>
              <p className={smallLabelClass}>Latitude</p>
              <p className={`mt-1 font-mono ${valueTextClass}`}>{ownShip.lat !== undefined ? toDDM(ownShip.lat, "lat") : "--"}</p>
            </div>
            <div className={innerCardClass}>
              <p className={smallLabelClass}>Longitude</p>
              <p className={`mt-1 font-mono ${valueTextClass}`}>{ownShip.lon !== undefined ? toDDM(ownShip.lon, "lon") : "--"}</p>
            </div>
            <div className={innerCardClass}>
              <p className={smallLabelClass}>SOG</p>
              <p className={`mt-1 font-mono ${valueTextClass}`}>{ownShip.sog !== undefined ? `${ownShip.sog.toFixed(1)} kt` : "--"}</p>
            </div>
            <div className={innerCardClass}>
              <p className={smallLabelClass}>COG</p>
              <p className={`mt-1 font-mono ${valueTextClass}`}>{padCourse(ownShip.cog)}</p>
            </div>
            <div className={innerCardClass}>
              <p className={smallLabelClass}>HDG</p>
              <p className={`mt-1 font-mono ${valueTextClass}`}>{padCourse(ownShip.heading)}</p>
            </div>
          </div>

          <p className="mt-3 text-2xl text-slate-500">
            Last message: {lastWsMessage || "Waiting for !AIVDO own-ship AIS message..."}
          </p>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => loadWx("manual")} disabled={loading || ownShip.lat === undefined || ownShip.lon === undefined} className={refreshButtonClass}>
            {loading ? "Loading..." : "Refresh WX"}
          </button>
          <div className={compactPanelClass}>
            <p className={labelClass}>NOAA Auto Update</p>
            <p className="mt-1 font-mono text-2xl">
              Next: {formatUtcClock(nextAutoRefresh)}{" "}
              <span className={mutedTextClass}>({formatCountdown(nextAutoRefresh, countdownTick)})</span>
            </p>
            <p className={`mt-1 text-2xl ${mutedTextClass}`}>
              Cycles: 0000 / 0600 / 1200 / 1800 UTC + 35 min
              {lastAutoRefresh ? ` | Last auto: ${formatUtcClock(lastAutoRefresh)}` : ""}
            </p>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-400/50 bg-red-950/30 p-4 text-red-100">{error}</div>}

        <section className={bridgeSummaryClass}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-2xl uppercase tracking-[0.25em] opacity-80">Bridge Summary</p>
              <h2 className="mt-2 text-2xl font-semibold">Operational Weather Status: <span className={tone.wordClassName}>{tone.label}</span></h2>
              <p className="mt-2 text-2xl opacity-85">Uses ship input, nearest usable observation, nearest configured official marine source, and offshore text only as fallback. Raw official text remains displayed below.</p>
              <p className="mt-2 font-mono text-2xl opacity-80">{bridgeForecastMode}: {bridgeForecastSource}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-2xl">
              <div className={summaryMiniCardClass}>
                <p className="text-2xl uppercase tracking-[0.2em] opacity-70">Max Wind</p>
                <p className="mt-1 font-mono text-2xl">{operationalWind ?? "--"} kt</p>
                <p className="mt-1 font-mono text-2xl opacity-75">{pacificWindDisplay}</p>
              </div>
              <div className={summaryMiniCardClass}>
                <p className="text-2xl uppercase tracking-[0.2em] opacity-70">Max Seas</p>
                <p className="mt-1 font-mono text-2xl">{operationalSeas ?? "--"} ft</p>
                <p className="mt-1 font-mono text-2xl opacity-75">{pacificSeasDisplay}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-2xl uppercase tracking-[0.2em] opacity-70">Wind Alert Logic</p>
              <p className="mt-2 text-2xl">Amber at 25 kt. Red at 35 kt.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-2xl uppercase tracking-[0.2em] opacity-70">Sea Alert Logic</p>
              <p className="mt-2 text-2xl">Amber at 10 ft. Red at 15 ft.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-2xl uppercase tracking-[0.2em] opacity-70">Warnings Found</p>
              <p className="mt-2 text-2xl">{data?.pacific?.parsed?.warnings?.length ? data.pacific.parsed.warnings[0] : "No warning keyword parsed yet."}</p>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={panelClass}>
            <p className={labelClass}>Official Forecast</p>
            <h2 className={cardTitleClass}>NWS Marine/Point Forecast</h2>
            <div className={`mt-4 space-y-3 text-2xl ${bodyTextClass}`}>
              <p><span className={subtleTextClass}>Nearest location:</span> {data?.nws?.forecastLocation ?? "--"}{typeof data?.nws?.forecastDistanceNm === "number" ? ` / ${data.nws.forecastDistanceNm} NM` : ""}</p>
              <p><span className={subtleTextClass}>Period:</span> {data?.nws?.forecastName ?? "No data loaded"}</p>
              <p><span className={subtleTextClass}>Wind:</span> {data?.nws?.windDirection ?? "--"} {data?.nws?.windSpeedText ?? "--"}</p>
              <p><span className={subtleTextClass}>Parsed max:</span> {forecastWind ?? "--"} kt</p>
              <p><span className={subtleTextClass}>Forecast:</span> {data?.nws?.shortForecast ?? "--"}</p>
            </div>
          </div>

          <div className={panelClass}>
            <p className={labelClass}>Observed Nearby</p>
            <h2 className={cardTitleClass}>NDBC Station</h2>
            <div className={`mt-4 space-y-3 text-2xl ${bodyTextClass}`}>
              <p><span className={subtleTextClass}>Station:</span> {data?.ndbc?.station ?? "No data loaded"}</p>
              <p><span className={subtleTextClass}>Distance:</span> {data?.ndbc?.distanceNm ?? "--"} NM</p>
              <p><span className={subtleTextClass}>Wind:</span> {data?.ndbc?.windKt ?? "--"} kt</p>
              <p><span className={subtleTextClass}>Gust:</span> {data?.ndbc?.gustKt ?? "--"} kt</p>
              <p><span className={subtleTextClass}>Seas:</span> {data?.ndbc?.waveFt ?? "--"} ft</p>
              {data?.ndbc?.note && <p className="text-amber-200">{data.ndbc.note}</p>}
            </div>
          </div>

        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3 2xl:grid-cols-3">
          <div className={panelClass}>
            <p className={labelClass}>Wave Guidance</p>
            <h2 className={cardTitleClass}>Seas / Wave Check</h2>
            <div className={`mt-4 space-y-3 text-2xl ${bodyTextClass}`}>
              <p><span className={subtleTextClass}>NDBC observed seas:</span> {ndbcSeas ?? "--"} ft</p>
              <p><span className={subtleTextClass}>Official text seas:</span> {pacificSeasDisplay}</p>
              <p><span className={subtleTextClass}>Highest working value:</span> {operationalSeas ?? "--"} ft</p>
              <pre className={preClass}>{data?.pacific?.parsed?.seasText || "Refresh to parse seas from NOAA text."}</pre>
            </div>
          </div>

          <div className={panelClass}>
            <p className={labelClass}>Wind Guidance</p>
            <h2 className={cardTitleClass}>Forecast Timeline Seed</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-2xl text-slate-300">
              <div className={innerCardClass}><p className={subtleTextClass}>NDBC Gust</p><p className={`font-mono ${valueTextClass}`}>{ndbcGust ?? "--"} kt</p></div>
              <div className={innerCardClass}><p className={subtleTextClass}>NWS</p><p className={`font-mono ${valueTextClass}`}>{forecastWind ?? "--"} kt</p></div>
              <div className={innerCardClass}><p className={subtleTextClass}>Official Text</p><p className={`font-mono ${valueTextClass}`}>{pacificWindDisplay}</p></div>
              <div className={innerCardClass}><p className={subtleTextClass}>NDBC</p><p className={`font-mono ${valueTextClass}`}>{ndbcWind ?? "--"} kt</p></div>
            </div>
            <pre className={preClass}>{data?.pacific?.parsed?.windText || "Refresh to parse winds from NOAA text."}</pre>
          </div>

          <div className={panelClass}>
            <p className={labelClass}>Trend / Alert Logic</p>
            <h2 className={cardTitleClass}>Bridge Flags</h2>
            <div className={`mt-4 space-y-3 text-2xl ${bodyTextClass}`}>
              <p>{operationalWind !== null && operationalWind >= 25 ? "⚠ Wind amber/red threshold met." : "Wind below amber threshold from parsed sources."}</p>
              <p>{operationalSeas !== null && operationalSeas >= 10 ? "⚠ Seas amber/red threshold met." : "Seas below amber threshold from parsed sources."}</p>
              <p className="text-2xl text-slate-500">Full +6/+12/+24/+48/+72 gridded timeline is the next NOMADS/GFS Wave step.</p>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={panelClass}>
            <p className={labelClass}>Official Marine Product</p>
            <h2 className={cardTitleClass}>Local / Regional Marine Text</h2>
            <p className={`mt-2 text-2xl ${mutedTextClass}`}>{data?.pacific?.localSource ?? "No local/regional forecast loaded"}</p>
            <pre className={productPreClass}>
{data?.pacific?.localText ?? "Refresh WX to load the nearest local/regional official marine forecast for this position."}
            </pre>
          </div>

          <div className={panelClass}>
            <p className={labelClass}>Offshore Backup Product</p>
            <h2 className={cardTitleClass}>High Seas / Offshore Text</h2>
            <p className={`mt-2 text-2xl ${mutedTextClass}`}>{data?.pacific?.highSeasSource ?? "No high seas product loaded"}</p>
            <pre className={productPreClass}>
{data?.pacific?.highSeasText ?? "Refresh WX to load an official high seas/offshore backup product where one is configured for this position."}
            </pre>
            {data?.pacific?.highSeasNote ? <p className="mt-3 text-2xl text-amber-100/80">{data.pacific.highSeasNote}</p> : null}
          </div>
        </section>

        <section className={`mt-4 ${panelClass}`}>
          <p className={labelClass}>Alerts</p>
          {data?.nws?.alerts?.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.nws.alerts.map((alert, idx) => (
                <div key={`${alert.event}-${idx}`} className="rounded-xl border border-amber-300/40 bg-amber-950/20 p-4">
                  <p className="font-semibold text-amber-100">{alert.event}</p>
                  <p className="mt-1 text-2xl text-amber-100/80">{alert.headline || "No headline provided"}</p>
                  <p className="mt-2 text-2xl uppercase tracking-[0.2em] text-amber-200/70">{alert.severity || "Unknown"} / {alert.urgency || "Unknown"}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-2xl text-slate-400">No active alerts loaded or no active alerts for this point.</p>
          )}
        </section>

        <section className={`mt-4 ${panelClass}`}>
          <p className={labelClass}>Notes</p>
          <ul className={`mt-4 list-disc space-y-2 pl-5 text-2xl ${bodyTextClass}`}>
            <li>This is the production weather page. Source selection is based on actual vessel position.</li>
            <li>NWS forecast is official where NWS point/grid coverage exists.</li>
            <li>NDBC station data is observed data, but station coverage offshore can be sparse.</li>
            <li>Official text products are shown as raw bridge-readable text where NavDash can fetch them.</li>
            <li>The bridge summary parses official text for quick flags, but the raw official text remains displayed and should be read directly.</li>
            <li>For full gridded offshore model work later, the next upgrade is NOAA NOMADS GFS/GFS Wave parsing.</li>
          </ul>
          {data?.errors?.length ? <p className="mt-4 text-2xl text-amber-200">Warnings: {data.errors.join(" | ")}</p> : null}
          {data?.generatedAt ? <p className="mt-4 text-2xl text-slate-500">Generated: {new Date(data.generatedAt).toLocaleString()}</p> : null}
        </section>
      </div>
    </main>
  );
}
