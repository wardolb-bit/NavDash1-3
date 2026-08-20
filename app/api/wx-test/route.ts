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

const NDBC_STATIONS = [
  { id: "52200", lat: 13.353, lon: 144.788, name: "Ipan, Guam" },
  { id: "52201", lat: 13.450, lon: 144.650, name: "Apra Harbor, Guam" },
  { id: "52202", lat: 13.696, lon: 144.833, name: "Ritidian Point, Guam" },
  { id: "52212", lat: 13.238, lon: 144.644, name: "Rota Channel" },
  { id: "52211", lat: 15.272, lon: 145.762, name: "Saipan" },
  { id: "51004", lat: 17.525, lon: -152.463, name: "Southeast Hawaii" },
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

function nearestStation(lat: number, lon: number) {
  let best = NDBC_STATIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const station of NDBC_STATIONS) {
    const d = haversineNm(lat, lon, station.lat, station.lon);
    if (d < bestDistance) {
      best = station;
      bestDistance = d;
    }
  }
  return { ...best, distanceNm: Math.round(bestDistance) };
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


function cleanTextProduct(text: string, maxChars = 4500): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, maxChars);
}

async function fetchFirstTextProduct(candidates: Array<{ source: string; url: string }>) {
  const errors: string[] = [];

  for (const item of candidates) {
    try {
      const text = await fetchText(item.url);
      const cleaned = cleanTextProduct(text);
      if (cleaned) return { source: item.source, text: cleaned, errors };
      errors.push(`${item.source}: empty product`);
    } catch (err) {
      errors.push(`${item.source}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { source: undefined, text: undefined, errors };
}

function pacificProductCandidates(lat: number, lon: number) {
  const inMarianas = lat > 10 && lat < 22 && lon > 138 && lon < 150;

  const local = inMarianas
    ? [
        {
          source: "NWS Guam Coastal Waters Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzmy50.pgum.cwf.myy.txt",
        },
        {
          source: "NWS Guam Area Forecast Discussion",
          url: "https://tgftp.nws.noaa.gov/data/raw/fx/fxmy50.pgum.afd.gum.txt",
        },
      ]
    : [];

  const highSeas = lon >= 100 && lon <= 180
    ? [
        {
          source: "NWS Honolulu North Pacific High Seas Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn40.phfo.hsf.np.txt",
        },
        {
          source: "NWS Honolulu Pacific Offshore Waters Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn26.phfo.off.hfo.txt",
        },
      ]
    : [
        {
          source: "NWS Eastern Pacific High Seas Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn02.kwbc.hsf.ep1.txt",
        },
        {
          source: "NWS Honolulu North Pacific High Seas Forecast",
          url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn40.phfo.hsf.np.txt",
        },
      ];

  return { local, highSeas };
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

async function readNdbcLatest(stationId: string) {
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

  try {
    const points = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`);
    const forecastUrl = points?.properties?.forecast;
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;

    if (forecastUrl) {
      const forecast = await fetchJson(forecastUrl);
      const first = forecast?.properties?.periods?.[0];
      out.nws = {
        gridOffice: points?.properties?.gridId,
        gridX: points?.properties?.gridX,
        gridY: points?.properties?.gridY,
        forecastName: first?.name,
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
    const inMarianas = lat > 10 && lat < 22 && lon > 138 && lon < 150;
    if (inMarianas) {
      out.errors.push(`NWS forecast unavailable: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  try {
    const station = nearestStation(lat, lon);
    const obs = await readNdbcLatest(station.id);
    out.ndbc = {
      station: `${station.id} ${station.name}`,
      distanceNm: station.distanceNm,
      windKt: obs?.windKt ?? null,
      gustKt: obs?.gustKt ?? null,
      waveFt: obs?.waveFt ?? null,
      rawLine: obs?.rawLine,
      note: obs ? undefined : "Station returned no usable latest observation.",
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
    const local = await fetchFirstTextProduct(candidates.local);
    const highSeas = await fetchFirstTextProduct(candidates.highSeas);

    const parsed = parsePacificTextProduct(highSeas.text || local.text);

    out.pacific = {
      localSource: local.source,
      localText: local.text,
      highSeasSource: highSeas.source,
      highSeasText: highSeas.text,
      highSeasNote: highSeas.text
        ? "Official text product loaded. Parsed bridge summary is advisory only; raw text remains the controlling product."
        : "No Pacific high seas text product loaded from the candidate endpoints.",
      parsed,
    };

    for (const msg of [...local.errors, ...highSeas.errors]) {
      if (msg) out.errors.push(`Pacific product: ${msg}`);
    }
  } catch (err) {
    out.errors.push(`Pacific products unavailable: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (out.errors.length) out.ok = false;
  return NextResponse.json(out);
}
