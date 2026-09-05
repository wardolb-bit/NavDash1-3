"use client";

import { useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };
type ForecastRow = { valid?: string; label?: string; windKt?: number | null; windDir?: number | null; gustKt?: number | null; seasFt?: number | null; swellFt?: number | null; pressureHpa?: number | null };
type OverlayPoint = { lat: number; lon: number; timeline?: ForecastRow[]; windKt?: number | null; windDir?: number | null; gustKt?: number | null; seasFt?: number | null; swellFt?: number | null; pressureHpa?: number | null };
type RoutePayload = { hasRoute?: boolean; routeName?: string; waypoints?: Waypoint[] };
type GribPayload = { hasGrib?: boolean; fileName?: string; overlayPoints?: OverlayPoint[] };
type Sample = { lat: number; lon: number; course: number; distanceNm: number };
type Candidate = {
  label: string;
  offsetNm: number;
  points: Waypoint[];
  distanceNm: number;
  addedNm: number;
  addedHours: number;
  maxWind: number;
  maxSeas: number;
  maxRisk: number;
  avgRisk: number;
  highCount: number;
  cautionCount: number;
  safetyScore: number;
  efficiencyScore: number;
  totalScore: number;
  reason: string;
};

const EARTH_RADIUS_NM = 3440.065;
const CANDIDATE_OFFSETS_NM = [0, -20, 20, -40, 40, -60, 60];

function rad(value: number) { return (value * Math.PI) / 180; }
function deg(value: number) { return (value * 180) / Math.PI; }
function norm360(value: number) { return ((value % 360) + 360) % 360; }
function normLon(value: number) {
  let next = value;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}
function unwrapLonNear(value: number, reference: number) {
  let next = value;
  while (next - reference > 180) next -= 360;
  while (next - reference < -180) next += 360;
  return next;
}
function distanceNm(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(unwrapLonNear(b.lon, a.lon) - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a: Waypoint, b: Waypoint) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dLon = rad(unwrapLonNear(b.lon, a.lon) - a.lon);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return norm360(deg(Math.atan2(y, x)));
}
function destinationPoint(start: Waypoint, courseDeg: number, nm: number): Waypoint {
  const angular = nm / EARTH_RADIUS_NM;
  const brg = rad(courseDeg);
  const p1 = rad(start.lat);
  const l1 = rad(start.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(angular) + Math.cos(p1) * Math.sin(angular) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(angular) * Math.cos(p1), Math.cos(angular) - Math.sin(p1) * Math.sin(p2));
  return { ...start, lat: deg(p2), lon: normLon(deg(l2)) };
}
function interpolate(a: Waypoint, b: Waypoint, fraction: number): Waypoint {
  const lonB = unwrapLonNear(b.lon, a.lon);
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: normLon(a.lon + (lonB - a.lon) * fraction) };
}
function routeDistance(points: Waypoint[]) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += distanceNm(points[i], points[i + 1]);
  return total;
}
function localRouteBearing(route: Waypoint[], index: number) {
  if (route.length < 2) return 0;
  if (index <= 0) return bearing(route[0], route[1]);
  if (index >= route.length - 1) return bearing(route[route.length - 2], route[route.length - 1]);
  return bearing(route[index - 1], route[index + 1]);
}
function offsetRoute(route: Waypoint[], offsetNm: number) {
  if (!offsetNm || route.length < 3) return route.map((point) => ({ ...point }));
  return route.map((point, index) => {
    if (index === 0 || index === route.length - 1) return { ...point };
    const taper = Math.sin(Math.PI * (index / (route.length - 1)));
    const routeBearing = localRouteBearing(route, index);
    const offsetBearing = norm360(routeBearing + (offsetNm > 0 ? 90 : -90));
    const shifted = destinationPoint(point, offsetBearing, Math.abs(offsetNm) * taper);
    return { ...point, lat: shifted.lat, lon: shifted.lon };
  });
}
function sampleRoute(route: Waypoint[], spacingNm = 35): Sample[] {
  const samples: Sample[] = [];
  let cumulative = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i];
    const to = route[i + 1];
    const legNm = distanceNm(from, to);
    const course = bearing(from, to);
    const count = Math.max(1, Math.ceil(legNm / spacingNm));
    for (let n = 0; n < count; n += 1) {
      const fraction = n / count;
      const point = interpolate(from, to, fraction);
      samples.push({ lat: point.lat, lon: point.lon, course, distanceNm: cumulative + legNm * fraction });
    }
    cumulative += legNm;
  }
  const last = route[route.length - 1];
  if (last && route.length > 1) samples.push({ lat: last.lat, lon: last.lon, course: bearing(route[route.length - 2], last), distanceNm: cumulative });
  return samples;
}
function nearestOverlay(points: OverlayPoint[], lat: number, lon: number) {
  let best: OverlayPoint | null = null;
  let bestNm = Number.POSITIVE_INFINITY;
  const target = { lat, lon };
  for (const point of points) {
    const nm = distanceNm(target, point);
    if (nm < bestNm) { bestNm = nm; best = point; }
  }
  return { point: best, distanceNm: bestNm };
}
function rowForEta(point: OverlayPoint, eta: Date): ForecastRow | null {
  const timeline = Array.isArray(point.timeline) ? point.timeline : [];
  if (timeline.length) {
    let best: ForecastRow | null = null;
    let delta = Number.POSITIVE_INFINITY;
    for (const row of timeline) {
      if (!row.valid) continue;
      const date = new Date(row.valid);
      if (Number.isNaN(date.getTime())) continue;
      const next = Math.abs(date.getTime() - eta.getTime());
      if (next < delta) { delta = next; best = row; }
    }
    if (best) return best;
  }
  return {
    windKt: point.windKt ?? null,
    windDir: point.windDir ?? null,
    gustKt: point.gustKt ?? null,
    seasFt: point.seasFt ?? null,
    swellFt: point.swellFt ?? null,
    pressureHpa: point.pressureHpa ?? null,
  };
}
function relativeAngle(a: number, b: number) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}
function weatherRisk(row: ForecastRow | null, course: number) {
  if (!row) return { risk: 90, wind: 0, seas: 0, level: "NO DATA" as const };
  const wind = Math.max(row.windKt ?? 0, row.gustKt ?? 0);
  const seas = Math.max(row.seasFt ?? 0, row.swellFt ?? 0);
  const pressure = row.pressureHpa ?? 1013;
  let risk = 0;
  risk += Math.max(0, wind - 20) * 1.15;
  risk += Math.max(0, wind - 30) * 2.4;
  risk += Math.max(0, seas - 6) * 2.1;
  risk += Math.max(0, seas - 10) * 5.0;
  risk += Math.max(0, 1008 - pressure) * 0.7;
  if (row.windDir !== null && row.windDir !== undefined && Number.isFinite(row.windDir) && wind >= 15) {
    const angle = relativeAngle(row.windDir, course);
    if (angle <= 45) risk += seas * 1.7 + wind * 0.18;
    else if (angle <= 120) risk += seas * 1.15 + wind * 0.09;
    else risk += seas * 0.45;
  }
  const level = wind >= 40 || seas >= 15 ? "HIGH" : wind >= 30 || seas >= 10 ? "CAUTION" : "NORMAL";
  if (level === "HIGH") risk += 95;
  else if (level === "CAUTION") risk += 28;
  return { risk, wind, seas, level };
}
function candidateLabel(offsetNm: number) {
  if (offsetNm === 0) return "LOADED ROUTE";
  return `${Math.abs(offsetNm)} NM ${offsetNm > 0 ? "STARBOARD" : "PORT"}`;
}
function scoreCandidate(route: Waypoint[], offsetNm: number, baseDistanceNm: number, overlays: OverlayPoint[], speedKt: number, start: Date): Candidate {
  const points = offsetRoute(route, offsetNm);
  const samples = sampleRoute(points);
  const distance = routeDistance(points);
  let totalRisk = 0;
  let maxRisk = 0;
  let maxWind = 0;
  let maxSeas = 0;
  let highCount = 0;
  let cautionCount = 0;
  let dataMisses = 0;

  for (const sample of samples) {
    const nearest = nearestOverlay(overlays, sample.lat, sample.lon);
    if (!nearest.point || nearest.distanceNm > 160) {
      dataMisses += 1;
      totalRisk += 80;
      maxRisk = Math.max(maxRisk, 80);
      continue;
    }
    const eta = new Date(start.getTime() + (sample.distanceNm / Math.max(0.1, speedKt)) * 3600000);
    const wx = weatherRisk(rowForEta(nearest.point, eta), sample.course);
    totalRisk += wx.risk;
    maxRisk = Math.max(maxRisk, wx.risk);
    maxWind = Math.max(maxWind, wx.wind);
    maxSeas = Math.max(maxSeas, wx.seas);
    if (wx.level === "HIGH") highCount += 1;
    if (wx.level === "CAUTION") cautionCount += 1;
  }

  const avgRisk = samples.length ? totalRisk / samples.length : 100;
  const addedNm = Math.max(0, distance - baseDistanceNm);
  const addedHours = addedNm / Math.max(0.1, speedKt);
  const safetyPenalty = avgRisk * 0.72 + maxRisk * 0.28 + highCount * 45 + cautionCount * 8 + dataMisses * 10;
  const safetyScore = Math.max(0, Math.min(100, 100 - safetyPenalty * 0.72));
  const efficiencyScore = Math.max(0, Math.min(100, 100 - addedNm * 0.8 - addedHours * 4.5));
  const totalScore = safetyScore * 0.8 + efficiencyScore * 0.2 - highCount * 22;
  const reason = highCount > 0
    ? `Avoid if practicable: ${highCount} high-risk weather sample${highCount === 1 ? "" : "s"}.`
    : cautionCount > 0
      ? `${cautionCount} caution sample${cautionCount === 1 ? "" : "s"}; best safety/efficiency trade among tested corridors.`
      : addedNm <= 2
        ? "Loaded route remains the best safety/efficiency balance."
        : `Reduces weather exposure for ${addedNm.toFixed(0)} NM of extra steaming.`;

  return { label: candidateLabel(offsetNm), offsetNm, points, distanceNm: distance, addedNm, addedHours, maxWind, maxSeas, maxRisk, avgRisk, highCount, cautionCount, safetyScore, efficiencyScore, totalScore, reason };
}
function routePath(points: Waypoint[], width: number, height: number, allPoints: Waypoint[]) {
  if (!points.length || !allPoints.length) return "";
  const unwrapped: { lat: number; lon: number }[] = [];
  let reference = allPoints[0].lon;
  for (const point of allPoints) {
    const lon = unwrapLonNear(point.lon, reference);
    unwrapped.push({ lat: point.lat, lon });
    reference = lon;
  }
  const minLat = Math.min(...unwrapped.map((p) => p.lat));
  const maxLat = Math.max(...unwrapped.map((p) => p.lat));
  const minLon = Math.min(...unwrapped.map((p) => p.lon));
  const maxLon = Math.max(...unwrapped.map((p) => p.lon));
  const pad = 12;
  const latSpan = Math.max(0.01, maxLat - minLat);
  const lonSpan = Math.max(0.01, maxLon - minLon);
  let ref = points[0].lon;
  return points.map((point, index) => {
    const lon = unwrapLonNear(point.lon, ref);
    ref = lon;
    const x = pad + ((lon - minLon) / lonSpan) * (width - pad * 2);
    const y = pad + ((maxLat - point.lat) / latSpan) * (height - pad * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}
function formatHours(hours: number) {
  if (hours <= 0.05) return "+0h";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `+${whole}h ${minutes}m`;
}

export default function WeatherRouteRecommendation() {
  const { dayMode } = useBridgeTheme();
  const [routeData, setRouteData] = useState<RoutePayload | null>(null);
  const [gribData, setGribData] = useState<GribPayload | null>(null);
  const [speedKt, setSpeedKt] = useState(9);
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState("Loading route and GRIB…");

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [routeResponse, gribResponse] = await Promise.all([
          fetch("/api/route-state", { cache: "no-store" }),
          fetch("/api/grib-summary", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        setRouteData(routeResponse.ok ? await routeResponse.json() : null);
        setGribData(gribResponse.ok ? await gribResponse.json() : null);
        setStatus("Recommendation updated");
      } catch {
        if (!cancelled) setStatus("Waiting for route / GRIB data");
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const analysis = useMemo(() => {
    const route = (routeData?.waypoints || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    const overlays = (gribData?.overlayPoints || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (route.length < 2 || overlays.length < 2) return null;
    const baseDistance = routeDistance(route);
    const candidates = CANDIDATE_OFFSETS_NM.map((offset) => scoreCandidate(route, offset, baseDistance, overlays, speedKt, new Date()))
      .sort((a, b) => b.totalScore - a.totalScore);
    return { route, candidates, best: candidates[0] };
  }, [gribData, routeData, speedKt]);

  const shell = dayMode ? "border-slate-300 bg-white/95 text-slate-950 shadow-slate-900/20" : "border-white/15 bg-[#06111f]/95 text-slate-100 shadow-black/50";
  const muted = dayMode ? "text-slate-600" : "text-slate-400";
  const card = dayMode ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.055]";
  const allPlotPoints = analysis ? [...analysis.route, ...analysis.best.points] : [];
  const loadedPath = analysis ? routePath(analysis.route, 410, 126, allPlotPoints) : "";
  const recommendedPath = analysis ? routePath(analysis.best.points, 410, 126, allPlotPoints) : "";

  return (
    <aside className={`fixed bottom-4 right-4 z-[70] w-[min(460px,calc(100vw-24px))] rounded-2xl border shadow-2xl backdrop-blur-xl ${shell}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f2b84b]">WX ROUTING</div>
          <div className="text-sm font-black uppercase tracking-[0.08em]">Safest + Most Efficient Route</div>
        </div>
        <button type="button" onClick={() => setCollapsed((value) => !value)} className={`rounded-lg border px-3 py-1.5 text-xs font-black ${dayMode ? "border-slate-300 bg-white" : "border-white/15 bg-white/10"}`}>
          {collapsed ? "SHOW" : "HIDE"}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-[72vh] overflow-y-auto px-4 pb-4">
          {!analysis ? (
            <div className={`rounded-xl border p-3 text-sm ${card}`}>
              <div className="font-black">NO RECOMMENDATION YET</div>
              <div className={`mt-1 text-xs ${muted}`}>Load an RTZ route and GRIB file. NavDash will evaluate the loaded track plus 20, 40 and 60 NM port/starboard weather corridors.</div>
            </div>
          ) : (
            <>
              <div className={`rounded-xl border p-3 ${card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${muted}`}>Weather recommendation</div>
                    <div className="mt-1 text-xl font-black text-[#f2b84b]">{analysis.best.label}</div>
                  </div>
                  <div className={`rounded-full px-2.5 py-1 text-[10px] font-black ${analysis.best.highCount ? "bg-red-500/20 text-red-400" : analysis.best.cautionCount ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                    {analysis.best.highCount ? "NOT RECOMMENDED" : analysis.best.cautionCount ? "ACCEPTABLE" : "RECOMMENDED"}
                  </div>
                </div>
                <div className={`mt-2 text-xs leading-5 ${muted}`}>{analysis.best.reason}</div>
              </div>

              <div className={`mt-3 rounded-xl border p-2 ${card}`}>
                <svg viewBox="0 0 410 126" className="h-28 w-full" role="img" aria-label="Loaded route and weather recommended route schematic">
                  <path d={loadedPath} fill="none" stroke="#64748b" strokeWidth="3" strokeDasharray="7 6" opacity="0.8" />
                  <path d={recommendedPath} fill="none" stroke="#f2b84b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className={`flex items-center justify-between px-1 text-[10px] font-bold ${muted}`}>
                  <span>--- Loaded RTZ</span><span className="text-[#f2b84b]">━━ Recommended</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["SAFETY", analysis.best.safetyScore.toFixed(0)],
                  ["EFFICIENCY", analysis.best.efficiencyScore.toFixed(0)],
                  ["DISTANCE", `${analysis.best.distanceNm.toFixed(0)} NM`],
                  ["MAX WIND", `${analysis.best.maxWind.toFixed(0)} KT`],
                  ["MAX SEAS", `${analysis.best.maxSeas.toFixed(1)} FT`],
                  ["ETA DELTA", formatHours(analysis.best.addedHours)],
                ].map(([label, value]) => (
                  <div key={label} className={`rounded-lg border p-2 ${card}`}>
                    <div className={`text-[9px] font-black tracking-[0.14em] ${muted}`}>{label}</div>
                    <div className="mt-1 text-sm font-black">{value}</div>
                  </div>
                ))}
              </div>

              <div className={`mt-3 rounded-xl border p-3 ${card}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className={`text-[10px] font-black uppercase tracking-[0.16em] ${muted}`}>Planning speed</div>
                  <div className="flex items-center gap-2">
                    <input aria-label="Weather routing planning speed" type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(event) => setSpeedKt(Math.max(1, Number(event.target.value) || 1))} className={`w-20 rounded-md border px-2 py-1 text-right text-sm font-black ${dayMode ? "border-slate-300 bg-white" : "border-white/15 bg-black/30"}`} />
                    <span className={`text-xs font-bold ${muted}`}>KT</span>
                  </div>
                </div>
                <div className={`mt-2 text-[10px] leading-4 ${muted}`}>Safety is weighted 80%. HIGH weather is heavily penalized before distance or ETA are considered.</div>
              </div>

              <div className="mt-3 space-y-1.5">
                {analysis.candidates.slice(0, 3).map((candidate, index) => (
                  <div key={candidate.label} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${card}`}>
                    <div><span className="mr-2 font-black text-[#f2b84b]">#{index + 1}</span><span className="font-black">{candidate.label}</span></div>
                    <div className={muted}>{candidate.safetyScore.toFixed(0)} SAFE · {candidate.addedNm > 0.5 ? `+${candidate.addedNm.toFixed(0)} NM` : "BASE"}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={`mt-3 text-[9px] leading-4 ${muted}`}>
            Advisory weather-routing aid only. The suggested corridor is not checked for charted dangers, shoal water, TSS, restricted areas, traffic, or regulatory constraints. Validate any deviation on ECDIS and with the bridge team before use.
          </div>
          <div className={`mt-1 text-[9px] ${muted}`}>{status}{gribData?.fileName ? ` · ${gribData.fileName}` : ""}</div>
        </div>
      )}
    </aside>
  );
}
