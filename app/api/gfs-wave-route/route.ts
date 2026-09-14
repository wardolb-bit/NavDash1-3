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

const BASE = "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_hawaii.json";
const UA = "NavDash route weather preview (wardmaritimegroup.com)";

function to360(lon: number) {
  const v = lon < 0 ? lon + 360 : lon;
  return ((v % 360) + 360) % 360;
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mToFt(v: number | null) {
  return v === null ? null : Number((v * 3.28084).toFixed(1));
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

    if (!points.length || !validTimes.length) {
      return NextResponse.json({ error: "Wave request requires route points and forecast valid times." }, { status: 400 });
    }

    const minLat = Math.max(18.0, Math.min(...points.map((p) => p.lat)) - 0.25);
    const maxLat = Math.min(23.0, Math.max(...points.map((p) => p.lat)) + 0.25);
    const lons = points.map((p) => to360(p.lon));
    const minLon = Math.max(199.0, Math.min(...lons) - 0.25);
    const maxLon = Math.min(208.0, Math.max(...lons) + 0.25);

    const start = new Date(Math.min(...validTimes.map((d) => d.getTime())));
    const end = new Date(Math.max(...validTimes.map((d) => d.getTime())));
    const t0 = start.toISOString().replace(".000Z", "Z");
    const t1 = end.toISOString().replace(".000Z", "Z");

    // PacIOOS Hawaii regional WW3 dimensions are time, depth, latitude, longitude.
    const slice = `[(%s):(%e)][(0.0)][(${minLat.toFixed(2)}):(${maxLat.toFixed(2)})][(${minLon.toFixed(2)}):(${maxLon.toFixed(2)})]`;
    const query = ["Thgt", "Tper", "Tdir"]
      .map((name) => `${name}${slice.replace("%s", t0).replace("%e", t1)}`)
      .join(",");
    const url = `${BASE}?${encodeURI(query)}`;

    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `WaveWatch request failed (${response.status}).`, detail: text.slice(0, 240) },
        { status: 502 },
      );
    }

    const json = await response.json();
    const columns: string[] = json?.table?.columnNames || [];
    const rows: any[][] = json?.table?.rows || [];
    const idx = {
      time: columns.indexOf("time"),
      lat: columns.indexOf("latitude"),
      lon: columns.indexOf("longitude"),
      h: columns.indexOf("Thgt"),
      p: columns.indexOf("Tper"),
      d: columns.indexOf("Tdir"),
    };

    if (idx.time < 0 || idx.lat < 0 || idx.lon < 0 || idx.h < 0) {
      return NextResponse.json({ error: "WaveWatch response did not contain expected fields." }, { status: 502 });
    }

    const parsed = rows.map((row) => ({
      time: new Date(row[idx.time]).getTime(),
      lat: Number(row[idx.lat]),
      lon: Number(row[idx.lon]),
      h: num(row[idx.h]),
      p: idx.p >= 0 ? num(row[idx.p]) : null,
      d: idx.d >= 0 ? num(row[idx.d]) : null,
    })).filter((row) =>
      Number.isFinite(row.time) &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon)
    );

    const frames: WaveFrame[] = validTimes.map((validAt) => {
      const targetTime = validAt.getTime();
      const resultPoints = points.map((point): WavePoint => {
        const targetLon = to360(point.lon);
        let best: (typeof parsed)[number] | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const row of parsed) {
          const dtHours = Math.abs(row.time - targetTime) / 3600000;
          if (dtHours > 1.6) continue;
          const dLat = row.lat - point.lat;
          const dLon = row.lon - targetLon;
          const spatial = dLat * dLat + dLon * dLon;
          const score = spatial + dtHours * 0.02;
          if (score < bestScore) {
            best = row;
            bestScore = score;
          }
        }

        return {
          lat: point.lat,
          lon: point.lon,
          distanceNm: point.distanceNm,
          waveHeightFt: mToFt(best?.h ?? null),
          wavePeriodSec: best?.p === null || best?.p === undefined ? null : Number(best.p.toFixed(0)),
          waveDirectionDeg: best?.d === null || best?.d === undefined ? null : Number(best.d.toFixed(0)),
          source: "PacIOOS WaveWatch III Hawaii regional (~5 km; island-shadowing aware)",
        };
      });

      return { validAt: validAt.toISOString(), points: resultPoints };
    });

    const populated = frames.reduce((count, frame) => count + frame.points.filter((p) => p.waveHeightFt !== null).length, 0);

    return NextResponse.json({
      provider: "PacIOOS / NOAA IOOS",
      product: "WaveWatch III Hawaii regional wave model (~5 km)",
      generatedAt: new Date().toISOString(),
      populatedPointCount: populated,
      frames,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WaveWatch route sampling failed." },
      { status: 500 },
    );
  }
}
