import { NextRequest, NextResponse } from "next/server";

type WxResponse = {
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
    rawLine?: string;
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

type NdbcStation = { id: string; lat: number; lon: number; name: string; coopsId?: string };
type TextProductCandidate = {
  source: string;
  url?: string;
  productType?: string;
  location?: string;
};
type LocalMarineProduct = {
  source?: string;
  text?: string;
  mode?: "local" | "regional";
  errors: string[];
};
type MarineZoneAnchor = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};
type MarineRegionProduct = {
  id: string;
  name: string;
  centerLat: number;
  centerLon: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  candidates: TextProductCandidate[];
  mode: "local" | "regional";
};

const NDBC_STATIONS: NdbcStation[] = [
  // NOAA/NOS Apra Harbor is exposed by NDBC as APRP7 / CO-OPS station 1630000.
  // It is not a normal offshore buoy, so readNdbcLatest has a CO-OPS fallback for it.
  { id: "APRP7", lat: 13.444, lon: 144.657, name: "Apra Harbor, Guam", coopsId: "1630000" },
  { id: "52200", lat: 13.353, lon: 144.788, name: "Ipan, Guam" },
  { id: "52202", lat: 13.696, lon: 144.833, name: "Ritidian Point, Guam" },
  { id: "52212", lat: 13.238, lon: 144.644, name: "Rota Channel" },
  { id: "52211", lat: 15.272, lon: 145.762, name: "Saipan" },
  { id: "51004", lat: 17.525, lon: -152.463, name: "Southeast Hawaii" },
];

const MARIANAS_MARINE_ZONES: MarineZoneAnchor[] = [
  { id: "PMZ151", name: "Guam Coastal Waters", lat: 13.4443, lon: 144.7937 },
  { id: "PMZ152", name: "Rota Coastal Waters", lat: 14.153, lon: 145.203 },
  { id: "PMZ153", name: "Tinian Coastal Waters", lat: 14.996, lon: 145.629 },
  { id: "PMZ154", name: "Saipan Coastal Waters", lat: 15.177, lon: 145.751 },
];

const WORLD_MARINE_REGIONS: MarineRegionProduct[] = [
  {
    id: "marianas",
    name: "Guam / CNMI official marine products",
    centerLat: 14.4,
    centerLon: 145.2,
    bounds: { minLat: 10, maxLat: 22, minLon: 138, maxLon: 150 },
    mode: "local",
    candidates: [
      { source: "NWS Guam Coastal Waters Forecast", productType: "CWF", location: "GUM" },
      { source: "NWS Guam Area Forecast Discussion", productType: "AFD", location: "GUM" },
    ],
  },
  {
    id: "hawaii",
    name: "Hawaii offshore waters",
    centerLat: 21.3,
    centerLon: -157.8,
    bounds: { minLat: 10, maxLat: 35, minLon: -170, maxLon: -140 },
    mode: "regional",
    candidates: [
      { source: "NWS Honolulu Offshore Waters Forecast", url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn26.phfo.txt" },
      { source: "NWS Honolulu Offshore Waters Forecast", url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn26.phfo.off.hfo.txt" },
    ],
  },
  {
    id: "us-west-coast",
    name: "U.S. West Coast / eastern North Pacific marine products",
    centerLat: 38,
    centerLon: -124,
    bounds: { minLat: 30, maxLat: 50, minLon: -135, maxLon: -116 },
    mode: "regional",
    candidates: [
      { source: "NOAA OPC Pacific Offshore Waters", url: "https://ocean.weather.gov/Pac_tab.php" },
      { source: "NWS Marine Forecasts", url: "https://www.weather.gov/marine/" },
    ],
  },
  {
    id: "us-alaska",
    name: "Alaska marine products",
    centerLat: 58,
    centerLon: -150,
    bounds: { minLat: 48, maxLat: 72, minLon: -180, maxLon: -125 },
    mode: "regional",
    candidates: [
      { source: "NWS Alaska Marine Forecasts", url: "https://www.weather.gov/afc/marine" },
      { source: "NOAA OPC Pacific Offshore Waters", url: "https://ocean.weather.gov/Pac_tab.php" },
    ],
  },
  {
    id: "us-east-coast",
    name: "U.S. East Coast / western North Atlantic marine products",
    centerLat: 37,
    centerLon: -73,
    bounds: { minLat: 24, maxLat: 48, minLon: -82, maxLon: -60 },
    mode: "regional",
    candidates: [
      { source: "NOAA OPC Atlantic Offshore Waters", url: "https://ocean.weather.gov/Atl_tab.php" },
      { source: "NWS Marine Forecasts", url: "https://www.weather.gov/marine/" },
    ],
  },
  {
    id: "us-gulf",
    name: "Gulf of Mexico marine products",
    centerLat: 26,
    centerLon: -90,
    bounds: { minLat: 18, maxLat: 31, minLon: -98, maxLon: -80 },
    mode: "regional",
    candidates: [
      { source: "National Hurricane Center Gulf of Mexico Marine Forecasts", url: "https://www.nhc.noaa.gov/marine/" },
      { source: "NWS Marine Forecasts", url: "https://www.weather.gov/marine/" },
    ],
  },
  {
    id: "us-caribbean",
    name: "Caribbean / Puerto Rico / U.S. Virgin Islands marine products",
    centerLat: 18,
    centerLon: -66,
    bounds: { minLat: 10, maxLat: 24, minLon: -82, maxLon: -55 },
    mode: "regional",
    candidates: [
      { source: "National Hurricane Center Caribbean Marine Forecasts", url: "https://www.nhc.noaa.gov/marine/" },
      { source: "NWS San Juan Marine Forecasts", url: "https://www.weather.gov/sju/marine" },
    ],
  },
  {
    id: "american-samoa",
    name: "American Samoa marine products",
    centerLat: -14.3,
    centerLon: -170.7,
    bounds: { minLat: -18, maxLat: -10, minLon: -174, maxLon: -166 },
    mode: "local",
    candidates: [
      { source: "NWS Pago Pago Coastal Waters Forecast", url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzzs50.nstu.txt" },
      { source: "NWS Pago Pago Forecast Office", url: "https://www.weather.gov/ppg/" },
    ],
  },
  {
    id: "us-central-pacific",
    name: "U.S. central Pacific island waters",
    centerLat: 10,
    centerLon: -170,
    bounds: { minLat: -5, maxLat: 20, minLon: -180, maxLon: -155 },
    mode: "regional",
    candidates: [
      { source: "NWS Honolulu Pacific Island Forecasts", url: "https://www.weather.gov/hfo/" },
      { source: "NWS Honolulu Offshore Waters Forecast", url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn26.phfo.txt" },
    ],
  },
  {
    id: "japan-west-pacific",
    name: "Japan / western North Pacific marine products",
    centerLat: 32,
    centerLon: 138,
    bounds: { minLat: 22, maxLat: 48, minLon: 122, maxLon: 155 },
    mode: "regional",
    candidates: [
      { source: "Japan Meteorological Agency Marine Warnings", url: "https://www.jma.go.jp/bosai/map.html#contents=seawarn" },
      { source: "Japan Meteorological Agency Weather Warnings", url: "https://www.jma.go.jp/bosai/warning/" },
    ],
  },
  {
    id: "philippines",
    name: "Philippines / western Pacific marine products",
    centerLat: 13,
    centerLon: 123,
    bounds: { minLat: 3, maxLat: 24, minLon: 115, maxLon: 132 },
    mode: "regional",
    candidates: [
      { source: "PAGASA High Seas Forecast", url: "https://www.pagasa.dost.gov.ph/marine/high-seas-forecast" },
      { source: "PAGASA Gale Warning", url: "https://www.pagasa.dost.gov.ph/marine/gale-warning" },
    ],
  },
  {
    id: "hong-kong-south-china-sea",
    name: "Hong Kong / South China Sea marine products",
    centerLat: 21.8,
    centerLon: 114.2,
    bounds: { minLat: 15, maxLat: 24, minLon: 108, maxLon: 122 },
    mode: "regional",
    candidates: [
      { source: "Hong Kong Observatory Marine Forecast", url: "https://www.hko.gov.hk/en/wservice/tsheet/pms/fmar.htm" },
    ],
  },
  {
    id: "singapore-malacca",
    name: "Singapore Strait / Malacca marine products",
    centerLat: 1.3,
    centerLon: 103.8,
    bounds: { minLat: -3, maxLat: 8, minLon: 95, maxLon: 110 },
    mode: "regional",
    candidates: [
      { source: "Meteorological Service Singapore Marine Forecast", url: "https://www.weather.gov.sg/weather-marine-shipping-bulletin" },
    ],
  },
  {
    id: "australia",
    name: "Australia marine products",
    centerLat: -25,
    centerLon: 134,
    bounds: { minLat: -45, maxLat: -5, minLon: 110, maxLon: 160 },
    mode: "regional",
    candidates: [
      { source: "Australian Bureau of Meteorology Marine Forecasts", url: "http://www.bom.gov.au/marine/" },
    ],
  },
  {
    id: "new-zealand",
    name: "New Zealand coastal and high seas products",
    centerLat: -41,
    centerLon: 174,
    bounds: { minLat: -55, maxLat: -25, minLon: 160, maxLon: 180 },
    mode: "regional",
    candidates: [
      { source: "MetService New Zealand Marine", url: "https://www.metservice.com/marine" },
    ],
  },
];

function toNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rNm = 3440.065;
  const deg = Math.PI / 180;
  const dLat = (bLat - aLat) * deg;
  const dLon = (bLon - aLon) * deg;
  const lat1 = aLat * deg;
  const lat2 = bLat * deg;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * rNm * Math.asin(Math.sqrt(h));
}

function nearestStationsFromList(lat: number, lon: number, stations: NdbcStation[], limit = 8) {
  return stations
    .map((station) => ({ ...station, distanceNm: Math.round(haversineNm(lat, lon, station.lat, station.lon)) }))
    .filter((station) => Number.isFinite(station.distanceNm))
    .sort((a, b) => a.distanceNm - b.distanceNm)
    .slice(0, limit);
}

function nearestStation(lat: number, lon: number) {
  return nearestStationsFromList(lat, lon, NDBC_STATIONS, 1)[0];
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function nearestActiveNdbcStations(lat: number, lon: number, limit = 8) {
  try {
    const xml = await fetchText("https://www.ndbc.noaa.gov/activestations.xml");
    const stations: NdbcStation[] = [];
    const stationRegex = /<station\b([^>]*)\/>/gi;
    const attr = (chunk: string, key: string) => {
      const match = chunk.match(new RegExp(`${key}="([^"]*)"`, "i"));
      return match ? decodeXml(match[1]) : undefined;
    };

    let match: RegExpExecArray | null;
    while ((match = stationRegex.exec(xml)) !== null) {
      const attrs = match[1];
      const id = attr(attrs, "id");
      const name = attr(attrs, "name") || id;
      const stationLat = Number(attr(attrs, "lat"));
      const stationLon = Number(attr(attrs, "lon"));
      if (!id || !Number.isFinite(stationLat) || !Number.isFinite(stationLon)) continue;
      stations.push({ id: id.toUpperCase(), name: name || id.toUpperCase(), lat: stationLat, lon: stationLon });
    }

    const dynamic = nearestStationsFromList(lat, lon, stations, limit);
    const known = nearestStationsFromList(lat, lon, NDBC_STATIONS, limit);
    const byId = new Map<string, NdbcStation & { distanceNm: number }>();
    for (const station of [...dynamic, ...known]) byId.set(station.id, station);
    return Array.from(byId.values()).sort((a, b) => a.distanceNm - b.distanceNm).slice(0, limit);
  } catch {
    return nearestStationsFromList(lat, lon, NDBC_STATIONS, limit);
  }
}

function parseNwsWindKt(text?: string): number | null {
  if (!text) return null;

  const regex = /(\d+)\s*(?:to|-)?\s*(\d+)?\s*(kt|kts|knots|mph)/gi;
  const vals: number[] = [];
  let sawMph = false;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    vals.push(Number(match[1]));
    if (match[2]) vals.push(Number(match[2]));
    if (/mph/i.test(match[3])) sawMph = true;
  }

  if (!vals.length) return null;
  const max = Math.max(...vals);
  return sawMph ? Math.round(max * 0.868976) : max;
}

function ndbcMsToKt(value: string | undefined): number | null {
  if (!value || value === "MM") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1.94384);
}

function ndbcMetersToFt(value: string | undefined): number | null {
  if (!value || value === "MM") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 3.28084 * 10) / 10;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "NavDash 1.3 Weather",
      Accept: "application/geo+json, application/json",
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "NavDash 1.3 Weather" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchLatestNwsProductText(productType: string, location: string) {
  const list = await fetchJson(`https://api.weather.gov/products/types/${productType}/locations/${location}`);
  const products = Array.isArray(list?.["@graph"]) ? list["@graph"] : [];
  const first = products[0];
  const id = first?.id;

  if (!id) throw new Error(`No ${productType} product listed for ${location}`);

  const product = await fetchJson(`https://api.weather.gov/products/${id}`);
  const text = product?.productText;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`Latest ${productType} product for ${location} had no text`);
  }

  return text;
}

async function fetchTextProductCandidate(item: TextProductCandidate) {
  if (item.productType && item.location) {
    return fetchLatestNwsProductText(item.productType, item.location);
  }

  if (item.url) return fetchText(item.url);

  throw new Error("Forecast candidate has no URL or NWS product lookup");
}

function cleanTextProduct(text: string, maxChars = 4500): string {
  const readable = /<html|<!doctype|<body|<div|<p[\s>]/i.test(text)
    ? text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
    : text;

  return readable
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trimEnd())
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

async function fetchFirstTextProduct(candidates: TextProductCandidate[]) {
  const errors: string[] = [];

  for (const item of candidates) {
    try {
      const text = await fetchTextProductCandidate(item);
      const cleaned = cleanTextProduct(text);
      if (cleaned) return { source: item.source, text: cleaned, errors };
      errors.push(`${item.source}: empty product`);
    } catch (err) {
      errors.push(`${item.source}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { source: undefined, text: undefined, errors };
}

function closestMarineZone(lat: number, lon: number, zones: MarineZoneAnchor[]) {
  return zones
    .map((zone) => ({ ...zone, distanceNm: haversineNm(lat, lon, zone.lat, zone.lon) }))
    .sort((a, b) => a.distanceNm - b.distanceNm)[0];
}

function pointInBounds(lat: number, lon: number, bounds: MarineRegionProduct["bounds"]) {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon;
}

function selectMarineRegion(lat: number, lon: number) {
  return WORLD_MARINE_REGIONS
    .filter((region) => pointInBounds(lat, lon, region.bounds))
    .map((region) => ({
      ...region,
      distanceNm: haversineNm(lat, lon, region.centerLat, region.centerLon),
    }))
    .sort((a, b) => a.distanceNm - b.distanceNm)[0];
}

function extractZoneText(productText: string, zoneId: string) {
  const lines = productText.replace(/\r/g, "").split("\n");
  const zoneStartPattern = new RegExp(`^${zoneId}(?:-|>|\\b)`);
  const anyZoneStartPattern = /^PMZ\d{3}(?:-|>|\b)/;
  const start = lines.findIndex((line) => zoneStartPattern.test(line.trim()));
  if (start < 0) return undefined;

  const selected: string[] = [];

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > start && anyZoneStartPattern.test(line.trim())) break;
    selected.push(line);
  }

  const cleaned = selected
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || undefined;
}

async function fetchMarianasMarineProduct(lat: number, lon: number): Promise<LocalMarineProduct> {
  const zone = closestMarineZone(lat, lon, MARIANAS_MARINE_ZONES);
  const region = WORLD_MARINE_REGIONS.find((item) => item.id === "marianas");
  const candidates = region?.candidates || [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const text = cleanTextProduct(await fetchTextProductCandidate(candidate), 8000);
      const zoneText = extractZoneText(text, zone.id);

      if (zoneText) {
        return {
          source: `${candidate.source} - ${zone.id} ${zone.name} (${Math.round(zone.distanceNm)} NM from vessel)`,
          text: zoneText,
          mode: "local",
          errors,
        };
      }

      if (text) {
        return {
          source: `${candidate.source} - nearest zone ${zone.id} ${zone.name} not found; showing Guam/CNMI product`,
          text: summarizeTextProductForNws(text),
          mode: "regional",
          errors,
        };
      }

      errors.push(`${candidate.source}: empty product`);
    } catch (err) {
      errors.push(`${candidate.source}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { errors };
}

async function fetchPositionLocalMarineProduct(lat: number, lon: number): Promise<LocalMarineProduct> {
  if (isMarianasWaters(lat, lon)) {
    return fetchMarianasMarineProduct(lat, lon);
  }

  const region = selectMarineRegion(lat, lon);

  if (region) {
    const result = await fetchFirstTextProduct(region.candidates);

    return {
      ...result,
      source: result.source
        ? `${result.source} - ${region.name}`
        : undefined,
      mode: result.text ? region.mode : undefined,
    };
  }

  return {
    errors: [`No configured position-specific official marine source for ${lat.toFixed(3)}, ${lon.toFixed(3)}. Add a regional source for this operating area before treating the weather page as local guidance.`],
  };
}

function pacificProductCandidates(lat: number, lon: number) {
  const inMarianas = lat > 10 && lat < 22 && lon > 138 && lon < 150;
  const inHawaiiRegion = lat > 10 && lat < 35 && lon > -170 && lon < -140;
  const inAlaskaRegion = lat >= 48 && lat <= 72 && lon >= -180 && lon <= -125;
  const inUsWestCoast = lat >= 30 && lat <= 50 && lon >= -135 && lon <= -116;
  const inUsEastCoast = lat >= 24 && lat <= 48 && lon >= -82 && lon <= -60;
  const inGulf = lat >= 18 && lat <= 31 && lon >= -98 && lon <= -80;
  const inCaribbean = lat >= 10 && lat <= 24 && lon >= -82 && lon <= -55;
  const inAmericanSamoa = lat >= -18 && lat <= -10 && lon >= -174 && lon <= -166;

  const local = inMarianas
    ? [
        {
          source: "NWS Guam Coastal Waters Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzmy50.pgum.txt",
        },
        {
          source: "NWS Guam Area Forecast Discussion",
          productType: "AFD",
          location: "GUM",
        },
      ]
    : [];

  const regional = inHawaiiRegion
    ? [
        {
          source: "NWS Honolulu Offshore Waters Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn26.phfo.txt",
        },
      ]
    : inUsEastCoast
    ? [
        { source: "NOAA OPC Atlantic Offshore Waters", url: "https://ocean.weather.gov/Atl_tab.php" },
      ]
    : inGulf || inCaribbean
    ? [
        { source: "National Hurricane Center Marine Forecasts", url: "https://www.nhc.noaa.gov/marine/" },
      ]
    : inAlaskaRegion || inUsWestCoast
    ? [
        { source: "NOAA OPC Pacific Offshore Waters", url: "https://ocean.weather.gov/Pac_tab.php" },
      ]
    : inAmericanSamoa
    ? [
        { source: "NWS Pago Pago Forecast Office", url: "https://www.weather.gov/ppg/" },
      ]
    : [];

  const highSeas = inMarianas || inHawaiiRegion || inAlaskaRegion || inUsWestCoast || inAmericanSamoa
    ? [
        {
          source: "NWS Honolulu North Pacific High Seas Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn40.phfo.hsf.np.txt",
        },
      ]
    : inUsEastCoast
    ? [
        { source: "NOAA OPC Atlantic High Seas / Offshore Products", url: "https://ocean.weather.gov/Atl_tab.php" },
      ]
    : inGulf || inCaribbean
    ? [
        { source: "National Hurricane Center Tropical Atlantic Marine Products", url: "https://www.nhc.noaa.gov/marine/" },
      ]
    : lon < -80 && lon > -180
    ? [
        {
          source: "NWS Eastern Pacific High Seas Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn02.kwbc.hsf.ep1.txt",
        },
      ]
    : [];

  return { local, regional, highSeas };
}

function nwsSummaryText(nws?: WxResponse["nws"]) {
  if (!nws) return undefined;
  const parts = [
    nws.forecastName ? `${nws.forecastName}.` : undefined,
    nws.shortForecast,
    nws.windDirection || nws.windSpeedText ? `Wind ${[nws.windDirection, nws.windSpeedText].filter(Boolean).join(" ")}.` : undefined,
    nws.detailedForecast,
  ].filter(Boolean);
  return parts.join("\n").trim() || undefined;
}

function relativeLocationFromPoints(points: any) {
  const props = points?.properties?.relativeLocation?.properties;
  if (!props?.city) return {};
  const distanceMeters = Number(props?.distance?.value);
  const distanceNm = Number.isFinite(distanceMeters) ? Math.round((distanceMeters / 1852) * 10) / 10 : undefined;
  return {
    forecastLocation: [props.city, props.state].filter(Boolean).join(", "),
    forecastDistanceNm: distanceNm,
  };
}

function isMarianasWaters(lat: number, lon: number) {
  return lat > 10 && lat < 22 && lon > 138 && lon < 150;
}

function summarizeTextProductForNws(text?: string) {
  if (!text) return undefined;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const zoneStart = lines.findIndex((line) => /^PMZ\d{3}-/.test(line));
  const usable = zoneStart >= 0 ? lines.slice(zoneStart) : lines;

  return usable
    .filter((line) => !/^\$\$/.test(line))
    .slice(0, 18)
    .join("\n")
    .slice(0, 1800);
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
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? Math.max(...clean) : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function parseMaxWindKtFromText(text: string) {
  const windWords = "(?:wind|winds)";
  const number = "(\\d{1,3}(?:\\.\\d+)?)";
  const range = `${number}(?:\\s*(?:to|-|–|through)\\s*${number})?`;
  const ktUnit = "(?:kt|kts|knots)\\b";
  const mphUnit = "(?:mph)\\b";
  const msUnit = "(?:m/s|mps|meters\\s+per\\s+second|metres\\s+per\\s+second)\\b";

  const ktValues = [
    ...parseNumberGroups(text, new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${windWords}[^\\n\\r.]{0,120}\\b(?:less\\s+than|below|under|to)\\s+${number}\\s*${ktUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?[^\\n\\r.]{0,80}${windWords}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${ktUnit}(?:\\s*(?:or\\s+less|or\\s+lower))?`, "gi")),
  ];

  const mphValues = [
    ...parseNumberGroups(text, new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${mphUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${mphUnit}[^\\n\\r.]{0,80}${windWords}`, "gi")),
  ];

  const msValues = [
    ...parseNumberGroups(text, new RegExp(`${windWords}[^\\d\\n\\r]{0,80}${range}\\s*${msUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${msUnit}[^\\n\\r.]{0,80}${windWords}`, "gi")),
  ];

  const values = [
    maxOrNull(ktValues),
    maxOrNull(mphValues) === null ? null : Math.round((maxOrNull(mphValues) as number) * 0.868976),
    maxOrNull(msValues) === null ? null : Math.round((maxOrNull(msValues) as number) * 1.94384),
  ].filter((value): value is number => value !== null && Number.isFinite(value));

  return values.length ? Math.max(...values) : null;
}

function parseWindRangeDisplay(text: string) {
  const patterns = [
    /(?:wind|winds)[^\d\n\r]{0,80}(\d{1,3}(?:\.\d+)?)\s*(?:to|-|–|through)\s*(\d{1,3}(?:\.\d+)?)\s*(?:kt|kts|knots)\b/gi,
    /(\d{1,3}(?:\.\d+)?)\s*(?:to|-|–|through)\s*(\d{1,3}(?:\.\d+)?)\s*(?:kt|kts|knots)\b/gi,
  ];

  let best: { low: number; high: number } | null = null;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      const low = Math.min(a, b);
      const high = Math.max(a, b);

      if (!best || high > best.high) best = { low, high };
    }
  }

  if (best) return `${formatNumber(best.low)} to ${formatNumber(best.high)} kt`;

  const maxWind = parseMaxWindKtFromText(text);
  return maxWind !== null ? `${formatNumber(maxWind)} kt` : undefined;
}

function parseMaxSeasFtFromText(text: string) {
  const seaWords = "(?:combined\\s+seas|seas|sea|significant\\s+wave\\s+height|wave\\s+heights?|wind\\s+waves?|waves?|swell|surf)";
  const number = "(\\d{1,2}(?:\\.\\d+)?)";
  const range = `${number}(?:\\s*(?:to|-|–|through)\\s*${number})?`;
  const feetUnit = "(?:ft|feet|foot)";
  const meterUnit = "(?:m|meter|meters|metre|metres)\\b";

  const feetValues = [
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${range}\\s*${feetUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\n\\r.]{0,140}(?:building|subsiding|rising|lowering|increasing|decreasing|becoming|less\\s+than)[^\\d\\n\\r]{0,60}${range}\\s*${feetUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\n\\r.]{0,140}\\b(?:to|less\\s+than)\\s+${number}\\s*${feetUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${feetUnit}[^\\n\\r.]{0,90}${seaWords}`, "gi")),
  ];

  const meterValues = [
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\d\\n\\r]{0,90}${range}\\s*${meterUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\n\\r.]{0,140}(?:building|subsiding|rising|lowering|increasing|decreasing|becoming|less\\s+than)[^\\d\\n\\r]{0,60}${range}\\s*${meterUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${seaWords}[^\\n\\r.]{0,140}\\b(?:to|less\\s+than)\\s+${number}\\s*${meterUnit}`, "gi")),
    ...parseNumberGroups(text, new RegExp(`${range}\\s*${meterUnit}[^\\n\\r.]{0,90}${seaWords}`, "gi")),
  ];

  const maxFeet = maxOrNull(feetValues);
  const maxMeters = maxOrNull(meterValues);
  const maxMetersAsFeet = maxMeters === null ? null : Math.round(maxMeters * 3.28084);

  if (maxFeet === null) return maxMetersAsFeet;
  if (maxMetersAsFeet === null) return maxFeet;
  return Math.max(maxFeet, maxMetersAsFeet);
}

function parseSeasRangeDisplay(text: string) {
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

  let best: { low: number; high: number; unit: "m" | "ft" } | null = null;

  for (const pattern of meterPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const highFt = high * 3.28084;

      if (!best || highFt > (best.unit === "m" ? best.high * 3.28084 : best.high)) {
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

  if (best?.unit === "m") {
    return `${formatNumber(best.low)} to ${formatNumber(best.high)} m / ${Math.round(best.low * 3.28084)} to ${Math.round(best.high * 3.28084)} ft`;
  }

  if (best?.unit === "ft") {
    return `${formatNumber(best.low)} to ${formatNumber(best.high)} ft`;
  }

  const maxSeas = parseMaxSeasFtFromText(text);
  return maxSeas !== null ? `${formatNumber(maxSeas)} ft` : undefined;
}

function parsePacificTextProduct(text?: string) {
  if (!text) {
    return {
      maxWindKt: null,
      maxSeasFt: null,
      windText: undefined,
      seasText: undefined,
      windDisplayText: undefined,
      seasDisplayText: undefined,
      warnings: [] as string[],
    };
  }

  const warnings: string[] = [];
  const windSnips: string[] = [];
  const seaSnips: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (/GALE|STORM|HURRICANE|TYPHOON|TROPICAL|WARNING/.test(upper)) {
      if (warnings.length < 6) warnings.push(line.slice(0, 180));
    }

    if (/WIND|WINDS|KT|KNOT|MPH|M\/S/.test(upper) && parseMaxWindKtFromText(line) !== null) {
      if (windSnips.length < 5) windSnips.push(line.slice(0, 220));
    }

    if (/(SEA|SEAS|SWELL|WAVE|WAVES|FT|FEET| M\b|METERS|METRES)/.test(upper) && parseMaxSeasFtFromText(line) !== null) {
      if (seaSnips.length < 5) seaSnips.push(line.slice(0, 220));
    }
  }

  return {
    maxWindKt: parseMaxWindKtFromText(text),
    maxSeasFt: parseMaxSeasFtFromText(text),
    windText: windSnips.join("\n"),
    seasText: seaSnips.join("\n"),
    windDisplayText: parseWindRangeDisplay(text),
    seasDisplayText: parseSeasRangeDisplay(text),
    warnings,
  };
}

async function readCoopsWindLatest(stationId: string) {
  const url = [
    "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
    `?date=latest&station=${stationId}`,
    "&product=wind&time_zone=gmt&units=metric&format=json",
  ].join("");

  const json = await fetchJson(url);
  const row = Array.isArray(json?.data) ? json.data[0] : undefined;
  if (!row) return null;

  const windKt = ndbcMsToKt(row.s);
  const gustKt = ndbcMsToKt(row.g);
  const direction = row.d && row.d !== "MM" ? `${row.d}°` : undefined;
  const timestamp = row.t || "latest";

  return {
    windKt,
    gustKt,
    waveFt: null,
    rawLine: `NOAA CO-OPS wind | ${timestamp} | ${direction ? `${direction} ` : ""}${row.s ?? "MM"} m/s | gust ${row.g ?? "MM"} m/s`,
  };
}

async function readNdbcLatest(stationId: string, coopsId?: string) {
  try {
    const text = await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`);
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 3) return null;

    const header = lines[0].replace(/^#/, "").trim().split(/\s+/);
    const units = lines[1];
    const dataLine = lines[2].trim();
    const data = dataLine.split(/\s+/);

    const indexOf = (key: string) => header.indexOf(key);
    const wspd = data[indexOf("WSPD")];
    const gst = data[indexOf("GST")];
    const wvht = data[indexOf("WVHT")];

    return {
      windKt: ndbcMsToKt(wspd),
      gustKt: ndbcMsToKt(gst),
      waveFt: ndbcMetersToFt(wvht),
      rawLine: `${header.join(" ")} | ${units} | ${dataLine}`,
    };
  } catch (err) {
    if (!coopsId) throw err;
    const coops = await readCoopsWindLatest(coopsId);
    if (coops) return coops;
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const lat = toNumber(search.get("lat"), 13.4443);
  const lon = toNumber(search.get("lon"), 144.7937);

  const out: WxResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    position: { lat, lon },
    errors: [],
  };
  const quietPointForecastErrors: string[] = [];

  try {
    const points = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`);
    const forecastUrl = points?.properties?.forecast;
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;

    if (forecastUrl) {
      const forecast = await fetchJson(forecastUrl);
      const first = forecast?.properties?.periods?.[0];
      const relativeLocation = relativeLocationFromPoints(points);

      out.nws = {
        gridOffice: points?.properties?.gridId,
        gridX: points?.properties?.gridX,
        gridY: points?.properties?.gridY,
        forecastName: first?.name,
        forecastLocation: relativeLocation.forecastLocation,
        forecastDistanceNm: relativeLocation.forecastDistanceNm,
        shortForecast: first?.shortForecast,
        detailedForecast: first?.detailedForecast,
        windSpeedText: first?.windSpeed,
        windDirection: first?.windDirection,
        forecastWindKt: parseNwsWindKt(first?.windSpeed || first?.detailedForecast),
        alerts: [],
      };
    }

    try {
      const alerts = await fetchJson(alertsUrl);
      const features = Array.isArray(alerts?.features) ? alerts.features : [];
      if (!out.nws) out.nws = { alerts: [] };
      out.nws.alerts = features.slice(0, 5).map((f: any) => ({
        event: f?.properties?.event || "Alert",
        headline: f?.properties?.headline,
        severity: f?.properties?.severity,
        urgency: f?.properties?.urgency,
      }));
    } catch (err) {
      out.errors.push(`NWS alerts unavailable: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  } catch (err) {
    const local = await fetchPositionLocalMarineProduct(lat, lon);
    const detailedForecast = summarizeTextProductForNws(local.text);

    if (detailedForecast) {
      out.nws = {
        forecastName: "Nearest Marine Forecast",
        shortForecast: local.source || "Nearest configured official marine forecast",
        detailedForecast,
        forecastWindKt: parseNwsWindKt(detailedForecast),
        alerts: [],
      };
    } else {
      quietPointForecastErrors.push(`NWS point forecast unavailable outside coverage: ${err instanceof Error ? err.message : "unknown error"}`);
      for (const msg of local.errors) out.errors.push(`Local marine product: ${msg}`);
    }
  }

  try {
    const stations = await nearestActiveNdbcStations(lat, lon, 8);
    let selected = stations[0] || nearestStation(lat, lon);
    let obs: Awaited<ReturnType<typeof readNdbcLatest>> | null = null;
    const obsErrors: string[] = [];

    for (const station of stations) {
      try {
        const candidateObs = await readNdbcLatest(station.id, station.coopsId);
        if (candidateObs && (candidateObs.windKt !== null || candidateObs.gustKt !== null || candidateObs.waveFt !== null)) {
          selected = station;
          obs = candidateObs;
          break;
        }
        obsErrors.push(`${station.id}: no usable latest observation`);
      } catch (err) {
        obsErrors.push(`${station.id}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    out.ndbc = {
      station: selected ? `${selected.id} ${selected.name}` : "No nearby NDBC station",
      distanceNm: selected?.distanceNm,
      windKt: obs?.windKt ?? null,
      gustKt: obs?.gustKt ?? null,
      waveFt: obs?.waveFt ?? null,
      rawLine: obs?.rawLine,
      note: obs
        ? undefined
        : `Nearest NDBC stations checked, but no usable latest observation returned. ${obsErrors.slice(0, 3).join("; ")}`,
    };
  } catch (err) {
    const station = nearestStation(lat, lon);
    out.ndbc = {
      station: `${station.id} ${station.name}`,
      distanceNm: station.distanceNm,
      windKt: null,
      gustKt: null,
      waveFt: null,
      note: `NDBC observation unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  try {
    const candidates = pacificProductCandidates(lat, lon);
    const local = await fetchPositionLocalMarineProduct(lat, lon);
    const highSeas = await fetchFirstTextProduct(candidates.highSeas);

    const summaryText = local.text || highSeas.text;
    const summarySource = local.text
      ? local.source
      : highSeas.source
        ? `${highSeas.source} - no local/area marine forecast available`
        : undefined;
    const summaryMode: "local" | "regional" | "offshore" = local.mode || "offshore";
    const parsed = parsePacificTextProduct(summaryText);

    out.pacific = {
      summarySource,
      summaryMode,
      summaryText,
      localSource: local.source || "No local/area marine forecast available for this position",
      localText: local.text,
      highSeasSource: highSeas.source,
      highSeasText: highSeas.text,
      highSeasNote: highSeas.text
        ? summaryMode === "local"
          ? "Bridge summary is using the nearest configured local marine forecast source for vessel position; high seas/offshore is retained below as backup."
          : summaryMode === "regional"
            ? "Bridge summary is using the nearest configured regional marine product; high seas/offshore is retained below as backup."
            : "No local/area marine forecast was available, so Bridge Summary is using the nearest configured high seas/offshore product."
        : "No local/area marine forecast or high seas/offshore text product loaded from the candidate endpoints.",
      parsed,
    };

    const hasOfficialMarineFallback = Boolean(summaryText);
    if (!hasOfficialMarineFallback) {
      for (const msg of quietPointForecastErrors) out.errors.push(msg);
    }

    for (const msg of [...local.errors, ...highSeas.errors]) {
      if (!msg) continue;
      if (hasOfficialMarineFallback && /404|No configured position-specific/i.test(msg)) continue;
      out.errors.push(`Marine source: ${msg}`);
    }
  } catch (err) {
    for (const msg of quietPointForecastErrors) out.errors.push(msg);
    out.errors.push(`Marine sources unavailable: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (out.errors.length) out.ok = false;
  return NextResponse.json(out);
}
