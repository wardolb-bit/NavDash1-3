import { NextResponse } from "next/server";

type Point = { lat: number; lon: number; distanceNm: number };
type WavePoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg: number | null;
  source: string;
};
type WaveFrame = { validAt: string; points: WavePoint[] };

type NoaaPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
};
type NoaaFrame = { validAt: string; points: NoaaPoint[] };
type NdfdSeries = { times: Date[]; values: Array<number | null> };

const UA = "NavDash route wave fallback (wardmaritimegroup.com)";

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 3440.065;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

function extractWaveSeries(parameters: string, layouts: Map<string, Date[]>): NdfdSeries | null {
  const re = /<wave-height\b([^>]*)>([\s\S]*?)<\/wave-height>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(parameters))) {
    const opening = `<wave-height${match[1]}>`;
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
    if (delta < bestDelta) {
      best = value;
      bestDelta = delta;
    }
  }
  return bestDelta <= 7 * 3600000 ? best : null;
}

async function sampleOceanicWave(points: Point[], validTimes: Date[]) {
  const empty = points.map(() => validTimes.map(() => null as number | null));
  if (!points.length || !validTimes.length) return empty;
  try {
    const params = new URLSearchParams();
    params.set("listLatLon", points.map((point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`).join(" "));
    params.set("product", "time-series");
    params.set("begin", validTimes[0].toISOString());
    params.set("end", validTimes[validTimes.length - 1].toISOString());
    params.set("Unit", "e");
    params.set("waveh", "waveh");
    params.set("XMLformat", "DWML");

    const response = await fetch(`https://digital.weather.gov/xml/sample_products/browser_interface/ndfdXMLclient.php?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml" },
      cache: "no-store",
    });
    if (!response.ok) return empty;
    const xml = await response.text();
    if (!/<dwml\b/i.test(xml)) return empty;

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

    return points.map((_, index) => {
      const block = blocks.get(locationKeys[index]) || Array.from(blocks.values())[index];
      const wave = block ? extractWaveSeries(block, layouts) : null;
      return validTimes.map((validAt) => nearestSeriesValue(wave, validAt));
    });
  } catch {
    return empty;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const points: Point[] = (Array.isArray(body?.points) ? body.points : [])
      .map((p: any) => ({
        lat: Number(p?.lat),
        lon: Number(p?.lon),
        distanceNm: Number(p?.distanceNm),
      }))
      .filter((p: Point) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.distanceNm) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180
      );

    const validTimes = (Array.isArray(body?.validTimes) ? body.validTimes : [])
      .map((value: unknown) => new Date(String(value)))
      .filter((d: Date) => Number.isFinite(d.getTime()));

    if (points.length < 2 || !validTimes.length) {
      return NextResponse.json({ error: "Wave request requires route points and forecast valid times." }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const [noaaResponse, oceanicWave] = await Promise.all([
      fetch(`${origin}/api/noaa-route-weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: points.map((point, index) => ({
            lat: point.lat,
            lon: point.lon,
            name: `Route sample ${index + 1}`,
          })),
        }),
        cache: "no-store",
      }),
      sampleOceanicWave(points, validTimes),
    ]);

    const noaaJson = await noaaResponse.json();
    const noaaFrames: NoaaFrame[] = noaaResponse.ok && Array.isArray(noaaJson?.frames) ? noaaJson.frames : [];

    const frames: WaveFrame[] = validTimes.map((validAt, validIndex) => {
      const targetTime = validAt.getTime();
      let frame = noaaFrames[0] || null;
      let frameDelta = frame ? Math.abs(new Date(frame.validAt).getTime() - targetTime) : Number.POSITIVE_INFINITY;

      for (const candidate of noaaFrames) {
        const delta = Math.abs(new Date(candidate.validAt).getTime() - targetTime);
        if (delta < frameDelta) {
          frame = candidate;
          frameDelta = delta;
        }
      }

      const resultPoints = points.map((point, pointIndex): WavePoint => {
        let nearest: NoaaPoint | null = null;
        let nearestNm = Number.POSITIVE_INFINITY;

        for (const candidate of frame?.points || []) {
          if (candidate.waveHeightFt === null) continue;
          const distance = nmBetween(point.lat, point.lon, candidate.lat, candidate.lon);
          if (distance < nearestNm) {
            nearest = candidate;
            nearestNm = distance;
          }
        }

        const local = nearest && nearestNm <= 18 ? nearest : null;
        const oceanic = oceanicWave[pointIndex]?.[validIndex] ?? null;
        const waveHeightFt = local?.waveHeightFt ?? oceanic;
        const wavePeriodSec = local?.wavePeriodSec ?? null;

        return {
          lat: point.lat,
          lon: point.lon,
          distanceNm: point.distanceNm,
          waveHeightFt,
          wavePeriodSec,
          waveDirectionDeg: null,
          source: local
            ? `NOAA/NWS route marine grid (${nearestNm.toFixed(1)} nm source distance)`
            : oceanic !== null
              ? "NOAA/NDFD Oceanic wave grid (exact route sample)"
              : "NOAA wave guidance unavailable at this sample",
        };
      });

      return { validAt: validAt.toISOString(), points: resultPoints };
    });

    const populated = frames.reduce(
      (count, frame) => count + frame.points.filter((point) => point.waveHeightFt !== null).length,
      0,
    );

    return NextResponse.json({
      provider: "NOAA / National Weather Service",
      product: "NWS route marine waves + NDFD Oceanic gap fill",
      generatedAt: new Date().toISOString(),
      populatedPointCount: populated,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NOAA/NWS route wave sampling failed." },
      { status: 500 },
    );
  }
}
