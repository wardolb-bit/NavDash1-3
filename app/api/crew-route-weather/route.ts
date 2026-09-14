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

function distanceNm(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function cumulativeDistanceToLegMidpoint(route: Waypoint[], activeIndex: number) {
  let total = 0;
  for (let i = 1; i < activeIndex; i += 1) total += distanceNm(route[i - 1], route[i]);
  if (activeIndex > 0 && activeIndex < route.length) total += distanceNm(route[activeIndex - 1], route[activeIndex]) / 2;
  return total;
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

    const rawActive = Number(body?.activeWaypointIndex);
    const activeIndex = Number.isFinite(rawActive)
      ? Math.max(1, Math.min(Math.round(rawActive), route.length - 1))
      : 1;

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
        // NOAA/NWS route weather remains the fallback if the wave endpoint is unavailable.
      }
    }

    const frames = merged.frames || [];
    if (!frames.length) return NextResponse.json({ error: "No route weather frames" }, { status: 502 });

    const now = Date.now();
    let selectedFrame = frames[0];
    let frameDelta = Math.abs(new Date(selectedFrame.validAt).getTime() - now);
    for (const frame of frames) {
      const delta = Math.abs(new Date(frame.validAt).getTime() - now);
      if (delta < frameDelta) {
        frameDelta = delta;
        selectedFrame = frame;
      }
    }

    const targetDistance = cumulativeDistanceToLegMidpoint(route, activeIndex);
    let selectedPoint = selectedFrame.points?.[0];
    let pointDelta = Number.POSITIVE_INFINITY;
    for (const point of selectedFrame.points || []) {
      const delta = Math.abs(Number(point.distanceNm) - targetDistance);
      if (delta < pointDelta) {
        pointDelta = delta;
        selectedPoint = point;
      }
    }

    if (!selectedPoint) return NextResponse.json({ error: "No weather sample for active leg" }, { status: 502 });

    const from = route[activeIndex - 1];
    const to = route[activeIndex];
    const legLabel = `${from?.name || `WP${activeIndex}`} to ${to?.name || `WP${activeIndex + 1}`}`;
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
      source: "NavDash route weather",
      routeLeg: legLabel,
      validAt: selectedFrame.validAt,
      nws: {
        shortForecast: `${legLabel} • ${windText} • ${seaText} • Valid ${validText}`,
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
          maxWindKt: selectedPoint.gustKt ?? selectedPoint.windKt,
          maxSeasFt: selectedPoint.waveHeightFt,
          warnings: [],
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Crew route weather failed" }, { status: 500 });
  }
}
