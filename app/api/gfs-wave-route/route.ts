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

type ErddapRow = {
  time: Date;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg: number | null;
};

const ERDDAP_BASE = "https://erddap.aoml.noaa.gov/hdb/erddap/griddap";

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 3440.065;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function to360(lon: number) {
  const value = lon % 360;
  return value < 0 ? value + 360 : value;
}

function rounded(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function parseErddapJson(json: any): ErddapRow[] {
  const table = json?.table;
  const columns: string[] = Array.isArray(table?.columnNames) ? table.columnNames : [];
  const rows: any[][] = Array.isArray(table?.rows) ? table.rows : [];
  const timeIndex = columns.indexOf("time");
  const hIndex = columns.indexOf("Thgt");
  const pIndex = columns.indexOf("Tper");
  const dIndex = columns.indexOf("Tdir");
  if (timeIndex < 0 || hIndex < 0) return [];

  return rows.map((row) => {
    const time = new Date(String(row[timeIndex]));
    const h = Number(row[hIndex]);
    const p = pIndex >= 0 ? Number(row[pIndex]) : NaN;
    const d = dIndex >= 0 ? Number(row[dIndex]) : NaN;
    return {
      time,
      waveHeightFt: Number.isFinite(h) ? h * 3.28084 : null,
      wavePeriodSec: Number.isFinite(p) ? p : null,
      waveDirectionDeg: Number.isFinite(d) ? d : null,
    };
  }).filter((row) => Number.isFinite(row.time.getTime()));
}

async function fetchGlobalWw3AtPoint(point: Point, validTimes: Date[]) {
  if (!validTimes.length) return [] as ErddapRow[];
  const datasetYear = validTimes[0].getUTCFullYear();
  const dataset = `WaveWatch_${datasetYear}`;
  const start = validTimes[0].toISOString();
  const end = validTimes[validTimes.length - 1].toISOString();
  const lon = to360(point.lon);
  const axis = `[(${start}):1:(${end})][(${point.lat.toFixed(4)})][(${lon.toFixed(4)})]`;
  const query = `Thgt${axis},Tper${axis},Tdir${axis}`;
  const url = `${ERDDAP_BASE}/${dataset}.json?${query}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "NavDash route wave coverage" },
      cache: "no-store",
    });
    if (!response.ok) return [];
    return parseErddapJson(await response.json());
  } catch {
    return [];
  }
}

function nearestErddap(rows: ErddapRow[], target: Date) {
  let best: ErddapRow | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.waveHeightFt === null) continue;
    const delta = Math.abs(row.time.getTime() - target.getTime());
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return bestDelta <= 2 * 3600000 ? best : null;
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
    const noaaResponsePromise = fetch(`${origin}/api/noaa-route-weather`, {
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
    });

    const ww3ByPointPromise = Promise.all(points.map((point) => fetchGlobalWw3AtPoint(point, validTimes)));
    const [noaaResponse, ww3ByPoint] = await Promise.all([noaaResponsePromise, ww3ByPointPromise]);

    const noaaJson = await noaaResponse.json();
    const noaaFrames: NoaaFrame[] = noaaResponse.ok && Array.isArray(noaaJson?.frames) ? noaaJson.frames : [];

    const frames: WaveFrame[] = validTimes.map((validAt) => {
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

        if (nearest && nearestNm <= 18) {
          return {
            lat: point.lat,
            lon: point.lon,
            distanceNm: point.distanceNm,
            waveHeightFt: nearest.waveHeightFt,
            wavePeriodSec: nearest.wavePeriodSec,
            waveDirectionDeg: null,
            source: `NOAA/NWS route marine grid (${nearestNm.toFixed(1)} nm source distance)`,
          };
        }

        const ww3 = nearestErddap(ww3ByPoint[pointIndex] || [], validAt);
        if (ww3) {
          return {
            lat: point.lat,
            lon: point.lon,
            distanceNm: point.distanceNm,
            waveHeightFt: rounded(ww3.waveHeightFt, 1),
            wavePeriodSec: rounded(ww3.wavePeriodSec, 0),
            waveDirectionDeg: rounded(ww3.waveDirectionDeg, 0),
            source: "NOAA ERDDAP / PacIOOS global WaveWatch III",
          };
        }

        return {
          lat: point.lat,
          lon: point.lon,
          distanceNm: point.distanceNm,
          waveHeightFt: null,
          wavePeriodSec: null,
          waveDirectionDeg: null,
          source: "No NOAA/NWS or NOAA-hosted WW3 wave value available",
        };
      });

      return { validAt: validAt.toISOString(), points: resultPoints };
    });

    const populated = frames.reduce(
      (count, frame) => count + frame.points.filter((point) => point.waveHeightFt !== null).length,
      0,
    );
    const total = frames.reduce((count, frame) => count + frame.points.length, 0);

    return NextResponse.json({
      provider: "NOAA / NWS + NOAA ERDDAP",
      product: "NWS marine grids with global WaveWatch III fallback",
      generatedAt: new Date().toISOString(),
      populatedPointCount: populated,
      totalPointCount: total,
      coveragePercent: total ? Math.round((populated / total) * 100) : 0,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Route wave sampling failed." },
      { status: 500 },
    );
  }
}
