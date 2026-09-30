import { NextRequest, NextResponse } from "next/server";

type Waypoint = { name?: string; lat: number; lon: number };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  waveDirectionDeg?: number | null;
  source?: string;
  waveSource?: string;
};
type Frame = { validAt: string; points: ForecastPoint[] };
type WeatherResponse = { frames?: Frame[]; product?: string; provider?: string };
type WaveResponse = { frames?: Array<{ validAt: string; points: ForecastPoint[] }> };

const WX_ORIGIN = "https://wx.wardlab.dev";

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 3440.065;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function compass(deg: number | null | undefined) {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return "--";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const normalized = ((deg % 360) + 360) % 360;
  return dirs[Math.round(normalized / 22.5) % 16];
}

function mergeWave(base: WeatherResponse, wave: WaveResponse | null): WeatherResponse {
  if (!base.frames?.length || !wave?.frames?.length) return base;
  return {
    ...base,
    frames: base.frames.map((frame) => {
      const target = new Date(frame.validAt).getTime();
      let bestWaveFrame = wave.frames![0];
      let bestDelta = Math.abs(new Date(bestWaveFrame.validAt).getTime() - target);
      for (const candidate of wave.frames || []) {
        const delta = Math.abs(new Date(candidate.validAt).getTime() - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestWaveFrame = candidate;
        }
      }
      return {
        ...frame,
        points: frame.points.map((point) => {
          let nearest: ForecastPoint | undefined;
          let score = Number.POSITIVE_INFINITY;
          for (const candidate of bestWaveFrame?.points || []) {
            const delta = Math.abs(Number(candidate.distanceNm) - Number(point.distanceNm));
            if (delta < score) {
              score = delta;
              nearest = candidate;
            }
          }
          return nearest
            ? {
                ...point,
                waveHeightFt: nearest.waveHeightFt,
                wavePeriodSec: nearest.wavePeriodSec,
                waveDirectionDeg: nearest.waveDirectionDeg,
                waveSource: nearest.source,
              }
            : point;
        }),
      };
    }),
  };
}

function pickNearestForecastPoint(weather: WeatherResponse, shipLat: number, shipLon: number) {
  const frames = weather.frames || [];
  if (!frames.length) return null;

  const now = Date.now();
  let selectedFrame = frames[0];
  let bestTimeDelta = Math.abs(new Date(selectedFrame.validAt).getTime() - now);
  for (const frame of frames) {
    const frameTime = new Date(frame.validAt).getTime();
    if (!Number.isFinite(frameTime)) continue;
    const delta = Math.abs(frameTime - now);
    if (delta < bestTimeDelta) {
      bestTimeDelta = delta;
      selectedFrame = frame;
    }
  }

  const ship = { lat: shipLat, lon: shipLon };
  let selectedPoint: ForecastPoint | null = null;
  let nearestDistanceNm = Number.POSITIVE_INFINITY;
  for (const point of selectedFrame.points || []) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const delta = distanceNm(ship, point);
    if (delta < nearestDistanceNm) {
      nearestDistanceNm = delta;
      selectedPoint = point;
    }
  }

  return selectedPoint ? { point: selectedPoint, frame: selectedFrame, nearestDistanceNm } : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const route: Waypoint[] = (Array.isArray(body?.waypoints) ? body.waypoints : [])
      .map((wp: any) => ({
        name: typeof wp?.name === "string" ? wp.name : undefined,
        lat: Number(wp?.lat ?? wp?.latitude),
        lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
      }))
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);

    if (route.length < 2) return NextResponse.json({ error: "Route unavailable" }, { status: 400 });

    const shipLat = Number(body?.shipLat);
    const shipLon = Number(body?.shipLon);
    if (!Number.isFinite(shipLat) || !Number.isFinite(shipLon)) {
      return NextResponse.json({ error: "Ownship position unavailable" }, { status: 400 });
    }

    const windResponse = await fetch(`${WX_ORIGIN}/api/noaa-route-weather`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ waypoints: route }),
    });
    if (!windResponse.ok) return NextResponse.json({ error: "Route weather unavailable" }, { status: 502 });

    const windJson = (await windResponse.json()) as WeatherResponse;
    let merged = windJson;
    const basePoints = windJson.frames?.[0]?.points || [];
    const validTimes = windJson.frames?.map((frame) => frame.validAt) || [];

    if (basePoints.length && validTimes.length) {
      try {
        const waveResponse = await fetch(`${WX_ORIGIN}/api/gfs-wave-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            points: basePoints.map((point) => ({ lat: point.lat, lon: point.lon, distanceNm: point.distanceNm })),
            validTimes,
          }),
        });
        if (waveResponse.ok) merged = mergeWave(windJson, (await waveResponse.json()) as WaveResponse);
      } catch {
        // Keep NOAA/NWS route weather if the wave overlay is unavailable.
      }
    }

    const selected = pickNearestForecastPoint(merged, shipLat, shipLon);
    if (!selected) return NextResponse.json({ error: "No nearby forecast point available" }, { status: 502 });

    const selectedPoint = selected.point;
    const selectedFrame = selected.frame;
    const valid = new Date(selectedFrame.validAt);
    const validText = Number.isNaN(valid.getTime())
      ? selectedFrame.validAt
      : valid.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });

    const windText = selectedPoint.windKt == null
      ? "Wind --"
      : `${compass(selectedPoint.windDirectionDeg)} ${selectedPoint.windKt.toFixed(0)} kt${selectedPoint.gustKt == null ? "" : ` gust ${selectedPoint.gustKt.toFixed(0)} kt`}`;
    const seaText = selectedPoint.waveHeightFt == null
      ? "Seas --"
      : `Seas ${selectedPoint.waveHeightFt.toFixed(1)} ft${selectedPoint.wavePeriodSec == null ? "" : ` @ ${selectedPoint.wavePeriodSec.toFixed(0)} s`}${selectedPoint.waveDirectionDeg == null ? "" : ` ${compass(selectedPoint.waveDirectionDeg)}`}`;

    return NextResponse.json({
      source: "NavDash nearest forecast point",
      validAt: selectedFrame.validAt,
      forecastPointDistanceNm: selected.nearestDistanceNm,
      forecastPoint: { lat: selectedPoint.lat, lon: selectedPoint.lon },
      nws: {
        shortForecast: `${windText} • ${seaText} • nearest forecast point ${selected.nearestDistanceNm.toFixed(1)} NM away • Valid ${validText}`,
        forecastWindKt: selectedPoint.windKt,
        alerts: [],
      },
      ndbc: {
        windKt: selectedPoint.windKt,
        waveFt: selectedPoint.waveHeightFt,
      },
      pacific: {
        summaryText: `${windText} • ${seaText}`,
        parsed: {
          maxWindKt: selectedPoint.windKt,
          maxSeasFt: selectedPoint.waveHeightFt,
          warnings: [],
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Crew route weather failed" }, { status: 500 });
  }
}
