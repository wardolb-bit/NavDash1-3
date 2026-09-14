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

function cumulativeWaypointDistances(route: Waypoint[]) {
  const out: number[] = [0];
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += distanceNm(route[i - 1], route[i]);
    out.push(total);
  }
  return out;
}

function shipDistanceAlongRoute(route: Waypoint[], shipLat: number, shipLon: number) {
  const cumulative = cumulativeWaypointDistances(route);
  let best = { xte: Number.POSITIVE_INFINITY, distanceNm: 0 };

  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    const refLat = (shipLat + a.lat + b.lat) / 3;
    const refLon = (shipLon + a.lon + b.lon) / 3;
    const cosLat = Math.cos(toRad(refLat));
    const p = { x: (shipLon - refLon) * 60 * cosLat, y: (shipLat - refLat) * 60 };
    const s = { x: (a.lon - refLon) * 60 * cosLat, y: (a.lat - refLat) * 60 };
    const e = { x: (b.lon - refLon) * 60 * cosLat, y: (b.lat - refLat) * 60 };
    const vx = e.x - s.x;
    const vy = e.y - s.y;
    const wx = p.x - s.x;
    const wy = p.y - s.y;
    const len2 = vx * vx + vy * vy;
    const ratio = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    const dx = p.x - (s.x + ratio * vx);
    const dy = p.y - (s.y + ratio * vy);
    const xte = Math.sqrt(dx * dx + dy * dy);
    const legNm = distanceNm(a, b);
    const along = cumulative[i - 1] + legNm * ratio;
    if (xte < best.xte) best = { xte, distanceNm: along };
  }

  return best.distanceNm;
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

function pickHoverSample(weather: WeatherResponse, routeDistanceNm: number, departureMs: number, speedKt: number) {
  const frames = weather.frames || [];
  if (!frames.length || !frames[0]?.points?.length) return null;

  const sampleCount = frames[0].points.length;
  let sampleIndex = Math.max(0, sampleCount - 1);
  for (let i = 0; i < sampleCount - 1; i += 1) {
    const a = Number(frames[0].points[i]?.distanceNm);
    const b = Number(frames[0].points[i + 1]?.distanceNm);
    if (routeDistanceNm >= a && routeDistanceNm < b) {
      sampleIndex = i;
      break;
    }
  }

  const distance = Number(frames[0].points[sampleIndex]?.distanceNm || 0);
  const etaMs = departureMs + (distance / speedKt) * 3600000;

  let selectedFrame = frames[0];
  let bestDelta = Math.abs(new Date(selectedFrame.validAt).getTime() - etaMs);
  for (const frame of frames) {
    const delta = Math.abs(new Date(frame.validAt).getTime() - etaMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      selectedFrame = frame;
    }
  }

  const point = selectedFrame.points?.[sampleIndex];
  return point ? { point, frame: selectedFrame } : null;
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
    const speedKt = Number(body?.speedKt);
    const departureMs = new Date(String(body?.departure || "")).getTime();
    if (!Number.isFinite(shipLat) || !Number.isFinite(shipLon)) {
      return NextResponse.json({ error: "Ownship position unavailable" }, { status: 400 });
    }
    if (!Number.isFinite(speedKt) || speedKt <= 0 || !Number.isFinite(departureMs)) {
      return NextResponse.json({ error: "Shared weather planning state unavailable" }, { status: 409 });
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

    const ownshipDistanceNm = shipDistanceAlongRoute(route, shipLat, shipLon);
    const selected = pickHoverSample(merged, ownshipDistanceNm, departureMs, speedKt);
    if (!selected) return NextResponse.json({ error: "No weather sample for ownship route segment" }, { status: 502 });

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
      source: "NavDash route hover sample",
      validAt: selectedFrame.validAt,
      distanceNm: selectedPoint.distanceNm,
      departure: new Date(departureMs).toISOString(),
      speedKt,
      nws: {
        shortForecast: `${windText} • ${seaText} • ${selectedPoint.distanceNm.toFixed(0)} NM along route • Valid ${validText}`,
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
