import { NextRequest, NextResponse } from "next/server";

const NOAA_IDENTIFY_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer/identify";
const NDBC = "https://www.ndbc.noaa.gov";

function finiteNumber(value: string | null, fallback?: number) {
  const parsed = value === null ? Number.NaN : Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}
function normalizeLongitude(value: number) { return ((((value + 180) % 360) + 360) % 360) - 180; }
function longitudeNearReference(value: number, reference: number) {
  let adjusted = value;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}
function webMercator(lon: number, lat: number) {
  const x = (lon * 20037508.342789244) / 180;
  const clippedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = (Math.log(Math.tan(((90 + clippedLat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.342789244 / 180);
  return { x, y };
}
async function fetchNoaaIdentify(url: string, timeoutMs: number) {
  return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "NavDash/1.3 NOAA ENC identify" } });
}
function stationIdFromResults(results: any[]) {
  for (const result of results) {
    const attrs = result?.attributes || {};
    const candidates = [attrs.OBJNAM, attrs.NOBJNM, result?.value];
    for (const candidate of candidates) {
      const text = String(candidate || "");
      const match = text.match(/(?:NDBC|NOAA|DATA|BUOY|STATION)[^0-9]{0,30}(\d{5})\b/i) || text.match(/\b(5\d{4})\b/);
      if (match) return match[1];
    }
  }
  return null;
}
function fmt(value: unknown, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}
function parseLatestObservation(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const headers = lines[0].replace(/^#/, "").trim().split(/\s+/);
  const values = lines[2].split(/\s+/);
  const row: Record<string, string> = {};
  headers.forEach((key, i) => { row[key] = values[i] || ""; });
  const good = (key: string) => row[key] && row[key] !== "MM" ? row[key] : null;
  const y = Number(row.YY), m = Number(row.MM), d = Number(row.DD), h = Number(row.hh), min = Number(row.mm || 0);
  const observedAt = [y, m, d, h].every(Number.isFinite) ? new Date(Date.UTC(y, m - 1, d, h, min)).toISOString() : null;
  return { observedAt, WDIR: good("WDIR"), WSPD: good("WSPD"), GST: good("GST"), WVHT: good("WVHT"), DPD: good("DPD"), APD: good("APD"), MWD: good("MWD"), PRES: good("PRES"), ATMP: good("ATMP"), WTMP: good("WTMP") };
}
function parseStationPosition(html: string) {
  const plain = html.replace(/<[^>]+>/g, " ").replace(/&deg;|&#176;/gi, "°").replace(/\s+/g, " ");
  const match = plain.match(/(\d{1,2}\.\d+)\s*([NS])\s+(\d{1,3}\.\d+)\s*([EW])/i);
  if (!match) return null;
  let lat = Number(match[1]), lon = Number(match[3]);
  if (match[2].toUpperCase() === "S") lat = -lat;
  if (match[4].toUpperCase() === "W") lon = -lon;
  return { lat, lon };
}
async function enrichNdbc(results: any[]) {
  const station = stationIdFromResults(results);
  if (!station) return { results, ndbc: null };
  try {
    const [obsResponse, pageResponse] = await Promise.all([
      fetch(`${NDBC}/data/realtime2/${station}.txt`, { cache: "no-store", signal: AbortSignal.timeout(6500), headers: { "User-Agent": "NavDash/1.3 NDBC live buoy" } }),
      fetch(`${NDBC}/station_page.php?station=${station}`, { cache: "no-store", signal: AbortSignal.timeout(6500), headers: { "User-Agent": "NavDash/1.3 NDBC live buoy" } }),
    ]);
    if (!obsResponse.ok) return { results, ndbc: null };
    const observation = parseLatestObservation(await obsResponse.text());
    const position = pageResponse.ok ? parseStationPosition(await pageResponse.text()) : null;
    if (!observation) return { results, ndbc: null };
    const parts = [`LIVE NDBC ${station}`];
    if (position) parts.push(`station position ${position.lat.toFixed(3)}° ${position.lat >= 0 ? "N" : "S"}, ${Math.abs(position.lon).toFixed(3)}° ${position.lon >= 0 ? "E" : "W"}`);
    if (observation.WDIR && observation.WSPD) parts.push(`wind ${observation.WDIR}° ${fmt(Number(observation.WSPD) * 1.94384)} kt${observation.GST ? ` gust ${fmt(Number(observation.GST) * 1.94384)} kt` : ""}`);
    if (observation.WVHT) parts.push(`seas ${fmt(observation.WVHT)} m / ${fmt(Number(observation.WVHT) * 3.28084)} ft`);
    if (observation.DPD) parts.push(`dominant period ${fmt(observation.DPD)} s`);
    if (observation.MWD) parts.push(`wave dir ${fmt(observation.MWD, 0)}°`);
    if (observation.PRES) parts.push(`pressure ${fmt(observation.PRES)} hPa`);
    if (observation.WTMP) parts.push(`water ${fmt(observation.WTMP)}°C / ${fmt(Number(observation.WTMP) * 9 / 5 + 32)}°F`);
    if (observation.observedAt) parts.push(`obs ${observation.observedAt.replace("T", " ").replace(":00.000Z", "Z")}`);
    const note = parts.join(" · ");
    const enriched = results.map((result, index) => index === 0 ? { ...result, attributes: { ...(result.attributes || {}), INFORM: note, NDBC_STATION: station, NDBC_LAT: position?.lat, NDBC_LON: position?.lon } } : result);
    return { results: enriched, ndbc: { station, position, observation, source: "NOAA National Data Buoy Center" } };
  } catch { return { results, ndbc: null }; }
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const lat = finiteNumber(search.get("lat"));
  const rawLon = finiteNumber(search.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(rawLon) || Math.abs(lat!) > 90) return NextResponse.json({ error: "Valid lat/lon are required." }, { status: 400 });
  const lon = normalizeLongitude(rawLon!);
  const rawWest = finiteNumber(search.get("west"), rawLon! - 0.2)!;
  const rawEast = finiteNumber(search.get("east"), rawLon! + 0.2)!;
  const west = longitudeNearReference(rawWest, lon), east = longitudeNearReference(rawEast, lon);
  const south = finiteNumber(search.get("south"), lat! - 0.2)!, north = finiteNumber(search.get("north"), lat! + 0.2)!;
  const width = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("width"), 1200)!)));
  const height = Math.max(256, Math.min(4096, Math.round(finiteNumber(search.get("height"), 800)!)));
  const tolerance = Math.max(2, Math.min(24, Math.round(finiteNumber(search.get("tolerance"), 8)!)));
  const point = webMercator(lon, lat!), sw = webMercator(west, south), ne = webMercator(east, north);
  const params = new URLSearchParams({ userid: "", geometry: JSON.stringify({ x: point.x, y: point.y }), geometrytype: "esriGeometryPoint", sr: "102100", spatialreference: "102100", tolerance: String(tolerance), returngeometry: "false", mapextent: `${sw.x},${sw.y},${ne.x},${ne.y}`, imagedisplay: `${width},${height},96`, layers: "visible:1,2,3,4,5,6,7", f: "json" });
  const url = `${NOAA_IDENTIFY_URL}?${params.toString()}`;
  let lastError: unknown;
  for (const timeoutMs of [8000, 18000]) {
    try {
      const response = await fetchNoaaIdentify(url, timeoutMs);
      const text = await response.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { return NextResponse.json({ error: "NOAA returned a non-JSON response.", upstreamStatus: response.status, detail: text.slice(0, 500) }, { status: 502 }); }
      if (!response.ok || payload?.error) return NextResponse.json({ error: "NOAA ENC identify request failed.", upstreamStatus: response.status, detail: payload?.error || payload }, { status: 502 });
      const rawResults = Array.isArray(payload?.results) ? payload.results : [];
      const enriched = await enrichNdbc(rawResults);
      return NextResponse.json({ source: "NOAA Office of Coast Survey ENC Online", queriedAt: new Date().toISOString(), lat, lon, results: enriched.results, ndbc: enriched.ndbc });
    } catch (error) {
      lastError = error;
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!timedOut) break;
    }
  }
  const timedOut = lastError instanceof Error && (lastError.name === "TimeoutError" || lastError.name === "AbortError");
  return NextResponse.json({ error: timedOut ? "NOAA ENC lookup timed out after retry." : "Unable to reach NOAA ENC Online.", detail: lastError instanceof Error ? lastError.message : String(lastError) }, { status: 502 });
}
