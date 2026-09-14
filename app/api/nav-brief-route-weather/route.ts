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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    if (route.length < 2) {
      return NextResponse.json({ ok: false, error: "Route unavailable" }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const windResponse = await fetch(`${origin}/api/noaa-route-weather`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ waypoints: route }),
    });

    if (!windResponse.ok) {
      return NextResponse.json({ ok: false, error: `NavDash route weather returned ${windResponse.status}` }, { status: 502 });
    }

    const windJson = (await windResponse.json()) as WeatherResponse;
    let merged = windJson;
    const basePoints = windJson.frames?.[0]?.points || [];
    const validTimes = windJson.frames?.map((frame) => frame.validAt) || [];
    let waveOverlay = false;

    if (basePoints.length && validTimes.length) {
      try {
        const waveResponse = await fetch(`${origin}/api/gfs-wave-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            points: basePoints.map((point) => ({ lat: point.lat, lon: point.lon, distanceNm: point.distanceNm })),
            validTimes,
          }),
        });

        if (waveResponse.ok) {
          merged = mergeWave(windJson, (await waveResponse.json()) as WaveResponse);
          waveOverlay = true;
        }
      } catch {
        // Keep current NOAA/NWS route weather if wave guidance is unavailable.
      }
    }

    return NextResponse.json({
      ok: true,
      source: "NavDash production weather",
      product: merged.product || windJson.product || "NavDash route weather",
      provider: merged.provider || windJson.provider || "NOAA / NWS",
      waveOverlay,
      frames: merged.frames || [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Nav Brief route weather failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
