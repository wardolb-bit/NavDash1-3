"use client";

import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type RegionKey =
  | "singapore"
  | "philippines"
  | "southChinaSea"
  | "westPacific"
  | "guam"
  | "hawaii"
  | "alaska"
  | "usWestCoast"
  | "usEastCoast"
  | "gulfCaribbean"
  | "japan"
  | "unknown";

type OwnShip = {
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number | null;
};

type SourceCard = {
  id: string;
  name: string;
  agency: string;
  region: string;
  bestFor: string;
  products: string[];
  primaryUrl: string;
  secondaryUrl?: string;
  highlight?: boolean;
};

const SOURCES: SourceCard[] = [
  {
    id: "mss",
    name: "Singapore MSS Marine",
    agency: "Meteorological Service Singapore",
    region: "Singapore Strait / Malacca approaches / regional waters",
    bestFor:
      "Singapore Strait, port approaches, Malacca/South China Sea regional marine products.",
    products: [
      "Shipping bulletin",
      "Surface wind forecast",
      "Significant wave forecast",
      "Wind wave / swell products",
      "Tropical cyclone products",
    ],
    primaryUrl: "https://www.weather.gov.sg/weather-marine-shipping-bulletin",
    secondaryUrl: "https://www.weather.gov.sg/weather-marine-surface-wind",
  },
  {
    id: "hko",
    name: "HKO Marine Forecast",
    agency: "Hong Kong Observatory",
    region: "South China Sea / Western North Pacific",
    bestFor:
      "South China Sea and western North Pacific marine forecast areas and ship-focused weather pages.",
    products: [
      "Marine forecast",
      "Weather and sea state for marine areas",
      "Warnings",
      "Weather charts for western North Pacific and South China Sea",
    ],
    primaryUrl:
      "https://www.weather.gov.hk/en/wservice/tsheet/pms/fmar.htm?broadcast=&menu=services",
    secondaryUrl: "https://www.hko.gov.hk/en/wservice/tsheet/pms/weather_ship.htm",
  },
  {
    id: "jma",
    name: "JMA Marine / RSMC Tokyo",
    agency: "Japan Meteorological Agency",
    region: "Western North Pacific / Japan area / typhoon basin",
    bestFor:
      "Western North Pacific weather charts, marine warnings/forecasts, sea waves, and tropical cyclone information.",
    products: [
      "Marine warnings and forecasts",
      "Weather analysis maps",
      "Sea wave products",
      "RSMC Tokyo typhoon information",
    ],
    primaryUrl: "https://www.jma.go.jp/jma/indexe.html",
    secondaryUrl:
      "https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/RSMC_HP.htm",
  },
  {
    id: "pagasa",
    name: "PAGASA Marine",
    agency: "DOST-PAGASA",
    region: "Philippine waters / Sulu Sea / Luzon / Visayas / Mindanao waters",
    bestFor:
      "Philippine high seas/offshore forecasts, gale warnings, and tropical cyclone warnings for shipping.",
    products: [
      "High seas and offshore waters forecast",
      "Gale warning",
      "Tropical cyclone warning for shipping",
      "Storm surge products",
    ],
    primaryUrl: "https://www.pagasa.dost.gov.ph/marine/high-seas-forecast",
    secondaryUrl: "https://www.pagasa.dost.gov.ph/marine/gale-warning",
  },
  {
    id: "noaa-guam",
    name: "NWS Guam / Tiyan",
    agency: "U.S. National Weather Service",
    region: "Guam / CNMI / Mariana Islands / Micronesia",
    bestFor:
      "Guam, CNMI, and nearby Micronesia marine zones from the local Weather Forecast Office in Tiyan.",
    products: [
      "Guam/CNMI coastal waters forecast",
      "Marine weather statements",
      "Surf and small craft advisories",
      "Area forecast discussion",
      "Tropical cyclone local statements",
    ],
    primaryUrl: "https://www.weather.gov/gum/",
    secondaryUrl: "https://tgftp.nws.noaa.gov/data/raw/fz/",
  },
  {
    id: "noaa-honolulu",
    name: "NWS Honolulu / Central Pacific",
    agency: "U.S. National Weather Service",
    region: "Hawaii / Central North Pacific / high seas backup",
    bestFor:
      "Hawaii waters and North/Central Pacific high seas products. Use as backup for Guam/CNMI only when no local Guam product is available.",
    products: [
      "Hawaii coastal waters forecast",
      "Offshore waters forecast",
      "North Pacific high seas forecast",
      "Central Pacific hurricane products",
    ],
    primaryUrl: "https://www.weather.gov/hfo/marine",
    secondaryUrl: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn40.phfo.hsf.np.txt",
  },
  {
    id: "noaa-opc",
    name: "NOAA Ocean Prediction Center",
    agency: "NOAA / NWS OPC",
    region: "U.S. offshore and high seas Atlantic/Pacific products",
    bestFor:
      "Official high seas and offshore products when outside a local coastal forecast area.",
    products: [
      "Pacific high seas/offshore",
      "Atlantic high seas/offshore",
      "Surface analysis",
      "Ocean forecast charts",
    ],
    primaryUrl: "https://ocean.weather.gov/",
    secondaryUrl: "https://www.weather.gov/marine/",
  },
  {
    id: "nhc",
    name: "National Hurricane Center Marine",
    agency: "NOAA / NHC",
    region: "Tropical Atlantic / Caribbean / Gulf of Mexico / eastern Pacific",
    bestFor:
      "Tropical cyclone, Gulf, Caribbean, and eastern Pacific marine products.",
    products: [
      "Tropical weather discussion",
      "Offshore waters forecast",
      "High seas forecast",
      "Tropical cyclone advisories",
    ],
    primaryUrl: "https://www.nhc.noaa.gov/marine/",
    secondaryUrl: "https://www.nhc.noaa.gov/",
  },
  {
    id: "wmo",
    name: "WMO National Agency Directory",
    agency: "World Meteorological Organization",
    region: "Global official agency index",
    bestFor:
      "Finding the responsible national meteorological authority when operating outside familiar coverage areas.",
    products: [
      "Official agency links",
      "Marine links by national agency",
      "Global weather service references",
    ],
    primaryUrl: "https://wmo.int/marine-links-national-agencies",
    secondaryUrl: "https://worldweather.wmo.int/",
  },
];


function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map(char => sixBitCharToValue(char).toString(2).padStart(6, "0"))
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
    const clean = sentence.split("*")[0];
    const parts = clean.split(",");
    if (parts.length < 7) return null;

    const payload = parts[5];
    if (!payload) return null;

    const bits = payloadToBits(payload);
    const messageType = getUnsigned(bits, 0, 6);

    if (![1, 2, 3, 18].includes(messageType)) return null;

    let sogStart = 50;
    let lonStart = 61;
    let latStart = 89;
    let cogStart = 116;
    let headingStart = 128;

    if (messageType === 18) {
      sogStart = 46;
      lonStart = 57;
      latStart = 85;
      cogStart = 112;
      headingStart = 124;
    }

    const sogRaw = getUnsigned(bits, sogStart, 10);
    const lonRaw = getSigned(bits, lonStart, 28);
    const latRaw = getSigned(bits, latStart, 27);
    const cogRaw = getUnsigned(bits, cogStart, 12);
    const headingRaw = getUnsigned(bits, headingStart, 9);

    const lon = lonRaw / 600000;
    const lat = latRaw / 600000;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return {
      lat,
      lon,
      sog: sogRaw === 1023 ? undefined : sogRaw / 10,
      cog: cogRaw === 3600 ? undefined : cogRaw / 10,
      heading: headingRaw === 511 ? undefined : headingRaw,
    };
  } catch {
    return null;
  }
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

    if (typeof msg?.line === "string") return msg.line;
  } catch {
    if (eventData.startsWith("!AI") || eventData.startsWith("$AI")) {
      return eventData;
    }
  }

  return null;
}


function classifyRegion(lat: number, lon: number): RegionKey {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "unknown";

  if (lat >= 10 && lat <= 22 && lon >= 138 && lon <= 150) return "guam";
  if (lat >= 10 && lat <= 35 && lon >= -170 && lon <= -140) return "hawaii";
  if (lat >= 48 && lat <= 72 && lon >= -180 && lon <= -125) return "alaska";
  if (lat >= 30 && lat <= 50 && lon >= -135 && lon <= -116) return "usWestCoast";
  if (lat >= 24 && lat <= 48 && lon >= -82 && lon <= -60) return "usEastCoast";
  if (lat >= 10 && lat <= 31 && lon >= -98 && lon <= -55) return "gulfCaribbean";
  if (lat >= 20 && lat <= 50 && lon >= 122 && lon <= 150) return "japan";
  if (lat >= -2 && lat <= 8 && lon >= 95 && lon <= 108) return "singapore";
  if (lat >= 3 && lat <= 22 && lon >= 115 && lon <= 130) return "philippines";
  if (lat >= 0 && lat <= 25 && lon >= 105 && lon <= 125) return "southChinaSea";
  if (lat >= 0 && lat <= 45 && lon >= 120 && lon <= 160) return "westPacific";

  return "unknown";
}

function regionLabel(region: RegionKey) {
  switch (region) {
    case "singapore":
      return "Singapore / Malacca Approaches";
    case "philippines":
      return "Philippine Waters";
    case "southChinaSea":
      return "South China Sea";
    case "westPacific":
      return "Western North Pacific";
    case "guam":
      return "Guam / CNMI Area";
    case "hawaii":
      return "Hawaii / Central Pacific";
    case "alaska":
      return "Alaska Waters";
    case "usWestCoast":
      return "U.S. West Coast";
    case "usEastCoast":
      return "U.S. East Coast";
    case "gulfCaribbean":
      return "Gulf / Caribbean";
    case "japan":
      return "Japan / Western North Pacific";
    default:
      return "Undetermined";
  }
}

function recommendedSourceIds(region: RegionKey) {
  switch (region) {
    case "singapore":
      return ["mss", "wmo"];
    case "philippines":
      return ["pagasa", "jma", "wmo"];
    case "southChinaSea":
      return ["hko", "mss", "pagasa", "wmo"];
    case "westPacific":
      return ["jma", "hko", "wmo"];
    case "guam":
      return ["noaa-guam", "noaa-honolulu", "jma", "wmo"];
    case "hawaii":
      return ["noaa-honolulu", "noaa-opc", "wmo"];
    case "alaska":
      return ["noaa-opc", "wmo"];
    case "usWestCoast":
      return ["noaa-opc", "wmo"];
    case "usEastCoast":
      return ["noaa-opc", "nhc", "wmo"];
    case "gulfCaribbean":
      return ["nhc", "noaa-opc", "wmo"];
    case "japan":
      return ["jma", "hko", "wmo"];
    default:
      return ["wmo", "noaa-opc", "jma"];
  }
}

function recommendationNote(region: RegionKey) {
  switch (region) {
    case "guam":
      return "Use Guam/Tiyan local marine products first. Honolulu high seas is backup only if a local Guam/CNMI product is unavailable.";
    case "hawaii":
      return "Use Honolulu marine products first, then OPC/high seas for wider offshore context.";
    case "philippines":
      return "Use PAGASA first for Philippine waters, with JMA/HKO only for wider western Pacific context.";
    case "southChinaSea":
      return "Use the nearest responsible regional agency first; HKO and MSS are useful around the northern and southern South China Sea respectively.";
    case "singapore":
      return "Use Singapore MSS first for Singapore Strait and Malacca approaches.";
    case "japan":
      return "Use JMA first for Japan and western North Pacific waters.";
    case "usWestCoast":
    case "usEastCoast":
    case "alaska":
      return "Use NOAA/OPC and local NWS marine pages for U.S. offshore waters.";
    case "gulfCaribbean":
      return "Use NHC first for Gulf, Caribbean, tropical Atlantic, and eastern Pacific marine products.";
    case "westPacific":
      return "Use JMA/HKO for western Pacific regional guidance unless a closer national service applies.";
    default:
      return "Position is outside a tightened local rule. Start with the WMO national agency directory, then choose the responsible national or high-seas authority.";
  }
}

function formatCoord(value: number, type: "lat" | "lon") {
  if (!Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi =
    type === "lat"
      ? value >= 0
        ? "N"
        : "S"
      : value >= 0
        ? "E"
        : "W";

  const width = type === "lat" ? 2 : 3;

  return `${deg.toString().padStart(width, "0")}° ${min
    .toFixed(3)
    .padStart(6, "0")}' ${hemi}`;
}

export default function OfficialWeatherPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const dayMode = !nightMode;
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [useAisPosition, setUseAisPosition] = useState(true);
  const [aisConnected, setAisConnected] = useState(false);
  const [aisStatus, setAisStatus] = useState("AIS position waiting");
  const [lastAisAt, setLastAisAt] = useState<number | null>(null);

  useEffect(() => {
    const wsUrl = getAisWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setAisConnected(true);
      setAisStatus("AIS websocket connected");
    };

    ws.onmessage = event => {
      const line = getNmeaLineFromMessage(String(event.data));
      if (!line) return;

      if (!line.startsWith("!AIVDO") && !line.startsWith("$AIVDO")) return;

      const decoded = decodeAisPosition(line);
      if (decoded?.lat === undefined || decoded?.lon === undefined) return;

      setAisConnected(true);
      setLastAisAt(Date.now());
      setAisStatus("AIS position live");

      if (useAisPosition) {
        setManualLat(decoded.lat.toFixed(6));
        setManualLon(decoded.lon.toFixed(6));
      }
    };

    ws.onerror = () => {
      setAisConnected(false);
      setAisStatus("AIS websocket error");
    };

    ws.onclose = () => {
      setAisConnected(false);
      setAisStatus("AIS websocket disconnected");
    };

    return () => ws.close();
  }, [useAisPosition]);

  const lat = Number(manualLat);
  const lon = Number(manualLon);
  const hasPosition =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;

  const positionSourceLabel = useAisPosition ? "AIS auto-fill" : "Manual entry";

  const region = hasPosition ? classifyRegion(lat, lon) : "unknown";
  const recommendedIds = useMemo(() => recommendedSourceIds(region), [region]);
  const sourceNote = recommendationNote(region);

  const sortedSources = useMemo(() => {
    return [...SOURCES].sort((a, b) => {
      const aRank = recommendedIds.indexOf(a.id);
      const bRank = recommendedIds.indexOf(b.id);

      if (aRank === -1 && bRank === -1) return a.name.localeCompare(b.name);
      if (aRank === -1) return 1;
      if (bRank === -1) return -1;

      return aRank - bRank;
    });
  }, [recommendedIds]);

  const theme = dayMode
    ? {
        page: "min-h-screen bg-slate-100 text-slate-950",
        shell: "mx-auto max-w-7xl px-5 py-6",
        panel: "rounded-[2rem] border border-slate-300 bg-white p-5 shadow-sm",
        card: "rounded-3xl border border-slate-300 bg-slate-50 p-5 shadow-sm",
        soft: "rounded-2xl border border-slate-300 bg-white p-4",
        muted: "text-slate-500",
        title: "text-slate-950",
        button:
          "rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100",
        primaryButton:
          "rounded-2xl border border-[#f2b84b]/50 bg-[#f2b84b] px-4 py-3 text-sm font-black text-slate-950 hover:brightness-105",
        input:
          "rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-950 outline-none focus:border-[#f2b84b]",
        badge: "rounded-2xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800",
      }
    : {
        page:
          "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(242,184,75,.18),transparent_28%),#07111d] text-slate-100",
        shell: "mx-auto max-w-7xl px-5 py-6",
        panel:
          "rounded-[2rem] border border-white/10 bg-white/[.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl",
        card:
          "rounded-3xl border border-white/10 bg-[#0d1824]/88 p-5 shadow-xl shadow-black/25 backdrop-blur-xl",
        soft: "rounded-2xl border border-white/10 bg-black/25 p-4",
        muted: "text-slate-400",
        title: "text-white",
        button:
          "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-slate-100 hover:bg-white/15",
        primaryButton:
          "rounded-2xl border border-[#f2b84b]/50 bg-[#f2b84b] px-4 py-3 text-sm font-black text-[#111827] shadow-lg shadow-[#f2b84b]/10 hover:brightness-110",
        input:
          "rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm text-white outline-none focus:border-[#f2b84b]",
        badge:
          "rounded-2xl bg-emerald-400 px-3 py-2 text-xs font-black text-[#06111f]",
      };

  return (
    <main className={theme.page}>
      <div className={theme.shell}>
        <header className={`${theme.panel} mb-5`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-3xl border border-[#f2b84b]/45 bg-[#f2b84b]/15 text-3xl font-black text-[#f2b84b]">
                O
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.42em] text-[#f2b84b]">
                  M/V MB480 
                </div>
                <h1 className={`text-4xl font-black tracking-tight ${theme.title}`}>
                  Official Weather
                </h1>
                <div className={`mt-1 text-sm ${theme.muted}`}>
                  Government and official meteorological source launcher for bridge weather checks.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button className={theme.button} onClick={toggleTheme}>
                {dayMode ? "Bridge Night" : "Day Mode"}
              </button>
            </div>
          </div>
        </header>

        <section className="mb-5 grid gap-5 lg:grid-cols-12">
          <div className={`${theme.card} lg:col-span-5`}>
            <div className="mb-3 text-sm font-bold uppercase tracking-[.22em] text-[#f2b84b]">
              Position / Region Selector
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className={`text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                  Latitude
                </span>
                <input
                  className={theme.input}
                  value={manualLat}
                  onChange={(event) => {
                    setManualLat(event.target.value);
                    setUseAisPosition(false);
                    setAisStatus("Manual position entry");
                  }}
                  placeholder="Example: 13.4443"
                />
              </label>
              <label className="grid gap-2">
                <span className={`text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                  Longitude
                </span>
                <input
                  className={theme.input}
                  value={manualLon}
                  onChange={(event) => {
                    setManualLon(event.target.value);
                    setUseAisPosition(false);
                    setAisStatus("Manual position entry");
                  }}
                  placeholder="Example: 144.7937"
                />
              </label>
            </div>

            <div className={`${theme.soft} mt-4`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className={`text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                    Position Source
                  </div>
                  <div className="mt-1 text-sm font-black">
                    {positionSourceLabel}
                  </div>
                  <div className={`mt-1 text-xs ${theme.muted}`}>
                    {aisStatus}
                    {lastAisAt ? ` / ${Math.round((Date.now() - lastAisAt) / 1000)} sec ago` : ""}
                  </div>
                </div>
                <button
                  className={theme.button}
                  onClick={() => {
                    setUseAisPosition(true);
                    setAisStatus(aisConnected ? "AIS auto-fill armed" : "AIS position waiting");
                  }}
                  type="button"
                >
                  Use AIS Position
                </button>
              </div>
            </div>

            <div className={`${theme.soft} mt-4`}>
              <div className={`text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                Suggested Region
              </div>
              <div className="mt-2 text-2xl font-black">{regionLabel(region)}</div>
              <div className={`mt-2 text-sm ${theme.muted}`}>
                {hasPosition
                  ? `${formatCoord(lat, "lat")} / ${formatCoord(lon, "lon")}`
                  : "Enter a position to sort the official sources by likely usefulness."}
              </div>
              <div className={`mt-3 text-sm leading-6 ${theme.muted}`}>
                {sourceNote}
              </div>
            </div>
          </div>

          <div className={`${theme.card} lg:col-span-7`}>
            <div className="mb-3 text-sm font-bold uppercase tracking-[.22em] text-[#f2b84b]">
              Use Guidance
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className={theme.soft}>
                <div className="text-lg font-black">Official Products</div>
                <div className={`mt-2 text-sm leading-6 ${theme.muted}`}>
                  Use these links for government or official meteorological authority products.
                </div>
              </div>
              <div className={theme.soft}>
                <div className="text-lg font-black">WX Dashboard</div>
                <div className={`mt-2 text-sm leading-6 ${theme.muted}`}>
                  v0.1.0
                </div>
              </div>
              <div className={theme.soft}>
                <div className="text-lg font-black">Attention</div>
                <div className={`mt-2 text-sm leading-6 ${theme.muted}`}>
                  The infomation here is from official sources, but confirm validity and issue times on the source pages before using. 
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          {sortedSources.map((source) => {
            const recommended = recommendedIds.includes(source.id);
            const priority = recommendedIds.indexOf(source.id) + 1;

            return (
              <article key={source.id} className={theme.card}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className={`text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                      {source.agency}
                    </div>
                    <h2 className="mt-1 text-2xl font-black text-[#f2b84b]">
                      {source.name}
                    </h2>
                    <div className={`mt-1 text-sm ${theme.muted}`}>{source.region}</div>
                  </div>
                  {recommended && <div className={theme.badge}>Priority {priority}</div>}
                </div>

                <p className="mt-4 text-sm leading-6">{source.bestFor}</p>

                <div className="mt-4">
                  <div className={`mb-2 text-xs font-bold uppercase tracking-[.18em] ${theme.muted}`}>
                    Products
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {source.products.map((product) => (
                      <span
                        key={product}
                        className={
                          dayMode
                            ? "rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                            : "rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-xs font-bold text-slate-200"
                        }
                      >
                        {product}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    className={theme.primaryButton}
                    href={source.primaryUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Primary
                  </a>
                  {source.secondaryUrl && (
                    <a
                      className={theme.button}
                      href={source.secondaryUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Related
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <footer className={`mt-6 rounded-3xl border p-4 text-sm leading-6 ${
          dayMode
            ? "border-slate-300 bg-white text-slate-600"
            : "border-white/10 bg-black/25 text-slate-400"
        }`}>
          This page is a source launcher and coverage guide. Confirm issue times and product validity on the official agency pages before using information in an operational weather brief.
        </footer>
      </div>
    </main>
  );
}
