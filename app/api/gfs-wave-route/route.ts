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

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 3440.065;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

    // Route-weather already obtains official NWS/NDFD wave guidance. Do not overwrite
    // those values with a separate broad-ocean model. Re-sample the same official
    // NOAA route grid here so the existing merge path remains backward-compatible.
    const origin = new URL(request.url).origin;
    const noaaResponse = await fetch(`${origin}/api/noaa-route-weather`, {
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

    const noaaJson = await noaaResponse.json();
    if (!noaaResponse.ok || !Array.isArray(noaaJson?.frames)) {
      return NextResponse.json(
        { error: noaaJson?.error || "NOAA/NWS route wave sampling failed." },
        { status: noaaResponse.ok ? 502 : noaaResponse.status },
      );
    }

    const noaaFrames: NoaaFrame[] = noaaJson.frames;
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

      const resultPoints = points.map((point): WavePoint => {
        let nearest: NoaaPoint | null = null;
        let nearestNm = Number.POSITIVE_INFINITY;

        for (const candidate of frame?.points || []) {
          const distance = nmBetween(point.lat, point.lon, candidate.lat, candidate.lon);
          if (distance < nearestNm) {
            nearest = candidate;
            nearestNm = distance;
          }
        }

        // Never borrow a wave value from a distant marine grid point. Missing is safer
        // than confidently displaying a sea state from somewhere else.
        const usable = nearest && nearestNm <= 18 ? nearest : null;
        return {
          lat: point.lat,
          lon: point.lon,
          distanceNm: point.distanceNm,
          waveHeightFt: usable?.waveHeightFt ?? null,
          wavePeriodSec: usable?.wavePeriodSec ?? null,
          waveDirectionDeg: null,
          source: usable
            ? `NOAA/NWS route marine grid (${nearestNm.toFixed(1)} nm source distance)`
            : "NOAA/NWS route marine grid - no nearby wave value",
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
      product: "NWS/NDFD route marine wave grid",
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
