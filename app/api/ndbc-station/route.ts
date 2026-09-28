import { NextRequest, NextResponse } from "next/server";

const NDBC = "https://www.ndbc.noaa.gov";

function clean(value: string | undefined) {
  const text = String(value || "").trim();
  return text && text !== "MM" ? text : null;
}

function numberOrNull(value: string | undefined) {
  const text = clean(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseLatest(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const headers = lines[0].replace(/^#/, "").trim().split(/\s+/);
  const units = lines[1].replace(/^#/, "").trim().split(/\s+/);
  const values = lines[2].trim().split(/\s+/);
  const row: Record<string, string> = {};
  headers.forEach((key, index) => { row[key] = values[index] || ""; });
  const year = Number(row.YY);
  const month = Number(row.MM);
  const day = Number(row.DD);
  const hour = Number(row.hh);
  const minute = Number(row.mm || 0);
  const observedAt = [year, month, day, hour].every(Number.isFinite)
    ? new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
    : null;
  return {
    observedAt,
    windDirectionDeg: numberOrNull(row.WDIR),
    windSpeedMs: numberOrNull(row.WSPD),
    gustMs: numberOrNull(row.GST),
    waveHeightM: numberOrNull(row.WVHT),
    dominantPeriodS: numberOrNull(row.DPD),
    averagePeriodS: numberOrNull(row.APD),
    meanWaveDirectionDeg: numberOrNull(row.MWD),
    pressureHpa: numberOrNull(row.PRES),
    airTempC: numberOrNull(row.ATMP),
    waterTempC: numberOrNull(row.WTMP),
  };
}

function parseStationPosition(html: string) {
  const plain = html.replace(/<[^>]+>/g, " ").replace(/&deg;|&#176;/gi, "°").replace(/\s+/g, " ");
  const match = plain.match(/(-?\d{1,2}\.\d+)\s*([NS])\s+(-?\d{1,3}\.\d+)\s*([EW])/i);
  if (!match) return null;
  let lat = Number(match[1]);
  let lon = Number(match[3]);
  if (match[2].toUpperCase() === "S") lat = -Math.abs(lat);
  if (match[4].toUpperCase() === "W") lon = -Math.abs(lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function parseStationName(html: string) {
  const match = html.match(/<h1[^>]*>\s*Station\s+[^-]+-\s*([^<]+)<\/h1>/i);
  return match?.[1]?.trim() || null;
}

export async function GET(request: NextRequest) {
  const station = String(request.nextUrl.searchParams.get("station") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(station)) {
    return NextResponse.json({ error: "Valid NDBC station ID required." }, { status: 400 });
  }

  try {
    const [latestResponse, stationResponse] = await Promise.all([
      fetch(`${NDBC}/data/realtime2/${encodeURIComponent(station)}.txt`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "NavDash/1.3 NDBC live buoy" },
      }),
      fetch(`${NDBC}/station_page.php?station=${encodeURIComponent(station)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "NavDash/1.3 NDBC live buoy" },
      }),
    ]);

    if (!latestResponse.ok) {
      return NextResponse.json({ error: "NDBC station observations unavailable.", upstreamStatus: latestResponse.status }, { status: 404 });
    }

    const latestText = await latestResponse.text();
    const stationHtml = stationResponse.ok ? await stationResponse.text() : "";
    const observation = parseLatest(latestText);
    const position = parseStationPosition(stationHtml);

    return NextResponse.json({
      source: "NOAA National Data Buoy Center",
      station,
      name: parseStationName(stationHtml),
      position,
      observation,
      stationUrl: `${NDBC}/station_page.php?station=${encodeURIComponent(station)}`,
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to reach NOAA NDBC.", detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
