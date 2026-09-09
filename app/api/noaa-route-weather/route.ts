import { NextResponse } from "next/server";

type Waypoint = { lat: number; lon: number; name?: string };
type SamplePoint = { lat: number; lon: number; distanceNm: number };
type GridValue = { validTime?: string; value?: number | null };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  source: string;
};

type MarkerFrame = {
  validAt: string;
  points: ForecastPoint[];
};

type NdfdSeries = { times: Date[]; values: Array<number | null> };

const UA = "NavDash NOAA route weather (wardmaritimegroup.com)";
const TARGET_HOURS = [0, 3, 6, 9, 12, 18, 24];
const SAMPLE_SPACING_NM = 35;
const MAX_SAMPLES = 9;

function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeSamples(route: Waypoint[]): SamplePoint[] {
  if (route.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) cumulative.push(cumulative[i - 1] + nmBetween(route[i - 1], route[i]));
  const total = cumulative[cumulative.length - 1];
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / SAMPLE_SPACING_NM) + 1));
  const samples: SamplePoint[] = [];
  for (let s = 0; s < count; s += 1) {
    const target = count === 1 ? 0 : total * (s / (count - 1));
    let leg = 0;
    while (leg < cumulative.length - 2 && cumulative[leg + 1] < target) leg += 1;
    const a = route[leg];
    const b = route[leg + 1];
    const legNm = Math.max(0.0001, cumulative[leg + 1] - cumulative[leg]);
    const f = Math.max(0, Math.min(1, (target - cumulative[leg]) / legNm));
    let lonB = b.lon;
    while (lonB - a.lon > 180) lonB -= 360;
    while (lonB - a.lon < -180) lonB += 360;
    let lon = a.lon + (lonB - a.lon) * f;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    samples.push({ lat: a.lat + (b.lat - a.lat) * f, lon, distanceNm: target });
  }
  return samples;
}

function parseDurationMs(duration: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration || "");
  if (!match) return 3600000;
  return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60000;
}

function valueAt(values: GridValue[] | undefined, time: Date) {
  if (!Array.isArray(values)) return null;
  const t = time.getTime();
  for (const item of values) {
    if (!item?.validTime) continue;
    const [startRaw, durationRaw = "PT1H"] = item.validTime.split("/");
    const start = new Date(startRaw).getTime();
    if (!Number.isFinite(start)) continue;
    const end = start + parseDurationMs(durationRaw);
    if (t >= start && t < end) return typeof item.value === "number" && Number.isFinite(item.value) ? item.value : null;
  }
  return null;
}

function kmhToKt(v: number | null) { return v === null ? null : v * 0.5399568; }
function mToFt(v: number | null) { return v === null ? null : v * 3.28084; }
function rounded(v: number | null, digits = 0) { return v === null ? null : Number(v.toFixed(digits)); }

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function samplePointForecast(point: SamplePoint, validTimes: Date[]) {
  try {
    const meta = await fetchJson(`https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
    const gridUrl = meta?.properties?.forecastGridData;
    if (!gridUrl) return null;
    const grid = await fetchJson(gridUrl);
    const props = grid?.properties || {};
    const source = `${props.gridId || meta?.properties?.gridId || "NWS"} ${props.gridX ?? meta?.properties?.gridX ?? ""},${props.gridY ?? meta?.properties?.gridY ?? ""}`.trim();
    return validTimes.map((validAt): ForecastPoint => ({
      lat: point.lat,
      lon: point.lon,
      distanceNm: point.distanceNm,
      windKt: rounded(kmhToKt(valueAt(props.windSpeed?.values, validAt))),
      windDirectionDeg: rounded(valueAt(props.windDirection?.values, validAt)),
      gustKt: rounded(kmhToKt(valueAt(props.windGust?.values, validAt))),
      waveHeightFt: rounded(mToFt(valueAt(props.waveHeight?.values, validAt)), 1),
      wavePeriodSec: rounded(valueAt(props.wavePeriod?.values, validAt)),
      source,
    }));
  } catch {
    return null;
  }
}

function xmlDecode(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function attr(tag: string, name: string) {
  const match = new RegExp(`${name}=["']([^"']+)["']`, "i").exec(tag);
  return match ? xmlDecode(match[1]) : "";
}

function valuesFromXml(block: string) {
  const values: Array<number | null> = [];
  const re = /<value\b[^>]*\/>|<value\b[^>]*>([\s\S]*?)<\/value>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const raw = typeof match[1] === "string" ? match[1].replace(/<[^>]+>/g, "").trim() : "";
    const value = Number(raw);
    values.push(raw !== "" && Number.isFinite(value) ? value : null);
  }
  return values;
}

function parseTimeLayouts(xml: string) {
  const layouts = new Map<string, Date[]>();
  const re = /<time-layout\b[^>]*>([\s\S]*?)<\/time-layout>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const block = match[1];
    const key = /<layout-key\b[^>]*>([\s\S]*?)<\/layout-key>/i.exec(block)?.[1]?.trim();
    if (!key) continue;
    const times: Date[] = [];
    const timeRe = /<start-valid-time\b[^>]*>([\s\S]*?)<\/start-valid-time>/gi;
    let timeMatch: RegExpExecArray | null;
    while ((timeMatch = timeRe.exec(block))) {
      const time = new Date(timeMatch[1].trim());
      if (Number.isFinite(time.getTime())) times.push(time);
    }
    layouts.set(key, times);
  }
  return layouts;
}

function extractSeries(parameters: string, layouts: Map<string, Date[]>, tagName: string, type?: string): NdfdSeries | null {
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(parameters))) {
    const opening = `<${tagName}${match[1]}>`;
    if (type && attr(opening, "type").toLowerCase() !== type.toLowerCase()) continue;
    const layoutKey = attr(opening, "time-layout");
    const times = layouts.get(layoutKey) || [];
    const values = valuesFromXml(match[2]);
    if (times.length && values.length) return { times, values };
  }
  return null;
}

function nearestSeriesValue(series: NdfdSeries | null, target: Date) {
  if (!series) return null;
  let best: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < series.times.length; i += 1) {
    const value = series.values[i];
    if (value === null || value === undefined) continue;
    const delta = Math.abs(series.times[i].getTime() - target.getTime());
    if (delta < bestDelta) { best = value; bestDelta = delta; }
  }
  return bestDelta <= 7 * 3600000 ? best : null;
}

async function sampleOceanicNdfd(points: SamplePoint[], validTimes: Date[]) {
  if (!points.length) return [] as Array<ForecastPoint[] | null>;
  try {
    const params = new URLSearchParams();
    params.set("listLatLon", points.map((point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`).join(" "));
    params.set("product", "time-series");
    params.set("begin", validTimes[0].toISOString());
    params.set("end", validTimes[validTimes.length - 1].toISOString());
    params.set("Unit", "e");
    params.set("wspd", "wspd");
    params.set("wdir", "wdir");
    params.set("wgust", "wgust");
    params.set("waveh", "waveh");
    params.set("XMLformat", "DWML");

    const response = await fetch(`https://digital.weather.gov/xml/sample_products/browser_interface/ndfdXMLclient.php?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml" },
      cache: "no-store",
    });
    if (!response.ok) return points.map(() => null);
    const xml = await response.text();
    if (!/<dwml\b/i.test(xml)) return points.map(() => null);

    const layouts = parseTimeLayouts(xml);
    const blocks = new Map<string, string>();
    const paramRe = /<parameters\b([^>]*)>([\s\S]*?)<\/parameters>/gi;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(xml))) {
      const opening = `<parameters${paramMatch[1]}>`;
      const locationKey = attr(opening, "applicable-location");
      if (locationKey) blocks.set(locationKey, paramMatch[2]);
    }

    const locationKeys: string[] = [];
    const locationRe = /<location\b[^>]*>([\s\S]*?)<\/location>/gi;
    let locationMatch: RegExpExecArray | null;
    while ((locationMatch = locationRe.exec(xml))) {
      const key = /<location-key\b[^>]*>([\s\S]*?)<\/location-key>/i.exec(locationMatch[1])?.[1]?.trim();
      if (key) locationKeys.push(key);
    }

    return points.map((point, index) => {
      const block = blocks.get(locationKeys[index]) || Array.from(blocks.values())[index];
      if (!block) return null;
      const wind = extractSeries(block, layouts, "wind-speed", "sustained");
      const gust = extractSeries(block, layouts, "wind-speed", "gust");
      const direction = extractSeries(block, layouts, "direction", "wind");
      const wave = extractSeries(block, layouts, "wave-height");
      const rows = validTimes.map((validAt): ForecastPoint => ({
        lat: point.lat,
        lon: point.lon,
        distanceNm: point.distanceNm,
        windKt: rounded(nearestSeriesValue(wind, validAt)),
        windDirectionDeg: rounded(nearestSeriesValue(direction, validAt)),
        gustKt: rounded(nearestSeriesValue(gust, validAt)),
        waveHeightFt: rounded(nearestSeriesValue(wave, validAt), 1),
        wavePeriodSec: null,
        source: "NDFD Oceanic",
      }));
      return rows.some((row) => row.windKt !== null || row.gustKt !== null || row.waveHeightFt !== null) ? rows : null;
    });
  } catch {
    return points.map(() => null);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const route: Waypoint[] = (Array.isArray(body?.waypoints) ? body.waypoints : [])
      .map((wp: any) => ({ lat: Number(wp?.lat), lon: Number(wp?.lon), name: typeof wp?.name === "string" ? wp.name : undefined }))
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
    if (route.length < 2) return NextResponse.json({ error: "Route requires at least two valid waypoints." }, { status: 400 });

    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const validTimes = TARGET_HOURS.map((hours) => new Date(now.getTime() + hours * 3600000));
    const samples = routeSamples(route);

    const pointResults = await Promise.all(samples.map((point) => samplePointForecast(point, validTimes)));
    const missingIndexes = pointResults.map((result, index) => result ? -1 : index).filter((index) => index >= 0);
    if (missingIndexes.length) {
      const oceanic = await sampleOceanicNdfd(missingIndexes.map((index) => samples[index]), validTimes);
      missingIndexes.forEach((sampleIndex, fallbackIndex) => {
        if (oceanic[fallbackIndex]) pointResults[sampleIndex] = oceanic[fallbackIndex];
      });
    }

    const usable = pointResults.filter((result): result is ForecastPoint[] => Array.isArray(result));
    const frames: MarkerFrame[] = validTimes.map((validAt, frameIndex) => ({
      validAt: validAt.toISOString(),
      points: usable.map((rows) => rows[frameIndex]).filter(Boolean),
    }));

    const usedOceanic = usable.some((rows) => rows.some((row) => row.source === "NDFD Oceanic"));
    const usedPointGrid = usable.some((rows) => rows.some((row) => row.source !== "NDFD Oceanic"));
    const product = usedOceanic && usedPointGrid
      ? "NWS point grids + NDFD Oceanic marine grids"
      : usedOceanic
        ? "NDFD Oceanic marine grids"
        : "NWS Digital Forecast Database route sampling";

    return NextResponse.json({
      version: 2,
      provider: "NOAA / National Weather Service",
      product,
      generatedAt: new Date().toISOString(),
      sampleCount: samples.length,
      coveredSampleCount: usable.length,
      frames,
      note: usable.length < samples.length
        ? "Some route points were outside available NOAA/NWS gridded forecast coverage and were omitted."
        : usedOceanic
          ? "Offshore points are using the NDFD Oceanic marine forecast grid."
          : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NOAA route weather failed." }, { status: 500 });
  }
}
