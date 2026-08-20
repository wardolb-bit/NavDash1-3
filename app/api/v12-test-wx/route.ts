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
  highSeas?: {
    product?: string;
    source?: string;
    issued?: string;
    text?: string;
    windText?: string;
    seasText?: string;
    note?: string;
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

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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


const HIGH_SEAS_PRODUCTS = [
  {
    id: "HSFEPI",
    name: "East and Central North Pacific High Seas Forecast",
    url: "https://tgftp.nws.noaa.gov/data/forecasts/marine/high_seas/north_pacific.txt",
    areaNote: "METAREA XII / East and Central North Pacific",
  },
  {
    id: "HSFEP1",
    name: "Northeast Pacific High Seas Forecast",
    url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn01.kwbc.hsf.ep1.txt",
    areaNote: "Northeast Pacific",
  },
  {
    id: "HSFNP",
    name: "North Mid-Pacific High Seas Forecast",
    url: "https://tgftp.nws.noaa.gov/data/raw/fz/fzpn40.phfo.hsf.np.txt",
    areaNote: "North Mid-Pacific",
  },
];

function highSeasProductsForPosition(lat: number, lon: number) {
  const normalizedLon = lon < 0 ? lon + 360 : lon;

  if (lat < 0) return [];

  // NOAA/NWS High Seas text products primarily cover the North Pacific east/central side.
  // This selector is intentionally broad for awareness use, not a legal METAREA boundary engine.
  if (normalizedLon >= 120 && normalizedLon <= 260) {
    return HIGH_SEAS_PRODUCTS;
  }

  return [];
}

function findIssuedLine(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    lines.find((line) => /\d{3,4}\s+UTC/.test(line)) ||
    lines.find((line) => /^FZ[A-Z0-9]{2}\d{2}/.test(line)) ||
    ""
  );
}

function extractFirstMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[0]?.replace(/\s+/g, " ").trim() || "";
}

function summarizeHighSeasText(text: string) {
  const cleaned = text.replace(/\r/g, "");
  const warning = extractFirstMatch(cleaned, /\.\.\.[A-Z ]*WARNING\.\.\.[\s\S]{0,700}?(?=\n\s*\.\.\.|FORECAST|\.24 HOUR|\$\$|$)/);
  const windText =
    warning ||
    extractFirstMatch(cleaned, /(WINDS?\s+(?:20|25|30|35|40|45|50|55|60)[\s\S]{0,160}?KT\.?)/i);
  const seasText =
    extractFirstMatch(cleaned, /(SEAS?\s+(?:LESS THAN\s+)?(?:\d+(?:\.\d+)?)(?:\s+TO\s+\d+(?:\.\d+)?)?\s*(?:FT|M)[\s\S]{0,120}?\.?)/i) ||
    extractFirstMatch(cleaned, /(SEAS?\s+\d+\s+TO\s+\d+\s+FT\.?)/i);

  return { windText, seasText };
}

async function readHighSeas(lat: number, lon: number) {
  const candidates = highSeasProductsForPosition(lat, lon);

  if (!candidates.length) {
    return {
      note: "NOAA/NWS High Seas text forecast is not selected for this position by the lab product selector.",
    };
  }

  for (const product of candidates) {
    try {
      const response = await fetch(product.url, {
        cache: "no-store",
        headers: { "User-Agent": "NavDash-v12-lab/1.0" },
      });

      if (!response.ok) continue;

      const text = await response.text();
      if (!text || !/HIGH SEAS FORECAST/i.test(text)) continue;

      const summary = summarizeHighSeasText(text);

      return {
        product: `${product.id} ${product.name}`,
        source: product.url,
        issued: findIssuedLine(text),
        text: text.slice(0, 5000),
        windText: summary.windText,
        seasText: summary.seasText,
        note: product.areaNote,
      };
    } catch {
      // Try the next product.
    }
  }

  return {
    note: "NOAA/NWS High Seas forecast could not be fetched for this position.",
  };
}


export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const lat = toNumber(search.get("lat"));
  const lon = toNumber(search.get("lon"));

  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json(
      {
        ok: false,
        generatedAt: new Date().toISOString(),
        position: null,
        errors: ["Live AIS latitude/longitude required. No default weather position is used."],
      },
      { status: 400 },
    );
  }

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
    out.errors.push(`NOAA/NWS point forecast unavailable for ${lat.toFixed(4)}, ${lon.toFixed(4)}: ${err instanceof Error ? err.message : "outside NOAA coverage or service unavailable"}`);
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
    out.highSeas = await readHighSeas(lat, lon);
  } catch (err) {
    out.highSeas = {
      note: `NOAA/NWS High Seas unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  if (out.errors.length) out.ok = false;
  return NextResponse.json(out);
}
