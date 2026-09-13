"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Waypoint = { name: string; lat: number; lon: number };
type ForecastPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  source: string;
};
type Frame = { validAt: string; points: ForecastPoint[] };
type WeatherResponse = {
  provider: string;
  product: string;
  generatedAt: string;
  sampleCount: number;
  coveredSampleCount: number;
  frames: Frame[];
  note?: string | null;
};
type EncounterPoint = ForecastPoint & { eta: Date; validAt: Date; deltaHours: number };

function nmBetween(a: Waypoint, b: Waypoint) {
  const r = 3440.065;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeLengthNm(route: Waypoint[]) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += nmBetween(route[i - 1], route[i]);
  return total;
}

function parseRtz(text: string): Waypoint[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const nodes = Array.from(doc.querySelectorAll("waypoint"));
  return nodes.map((node, index) => {
    const pos = node.querySelector("position");
    const lat = Number(pos?.getAttribute("lat"));
    const lon = Number(pos?.getAttribute("lon"));
    const name = node.getAttribute("name") || node.getAttribute("id") || `WP${String(index + 1).padStart(2, "0")}`;
    return { name, lat, lon };
  }).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon) && Math.abs(wp.lat) <= 90 && Math.abs(wp.lon) <= 180);
}

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Pacific/Honolulu",
  }).format(date) + " HST";
}

function compass(deg: number | null) {
  if (deg === null || !Number.isFinite(deg)) return "--";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function maxBy(points: ForecastPoint[], key: "waveHeightFt" | "windKt" | "gustKt") {
  return points.reduce<ForecastPoint | null>((best, p) => {
    const value = p[key];
    if (value === null || !Number.isFinite(value)) return best;
    if (!best || best[key] === null || (value as number) > (best[key] as number)) return p;
    return best;
  }, null);
}

export default function RouteWeatherLabPage() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const weatherLayerRef = useRef<any>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [routeName, setRouteName] = useState("No route loaded");
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [status, setStatus] = useState("Load an RTZ route to begin.");
  const [speedKt, setSpeedKt] = useState(9);
  const [departure, setDeparture] = useState(() => {
    const now = new Date();
    const hst = new Date(now.toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    hst.setMinutes(0, 0, 0);
    const yyyy = hst.getFullYear();
    const mm = String(hst.getMonth() + 1).padStart(2, "0");
    const dd = String(hst.getDate()).padStart(2, "0");
    const hh = String(hst.getHours()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:00`;
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [showWind, setShowWind] = useState(true);
  const [showSeas, setShowSeas] = useState(true);
  const [mode, setMode] = useState<"encounter" | "time">("encounter");

  const totalNm = useMemo(() => routeLengthNm(route), [route]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!mapEl.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapEl.current) return;
      if (!document.querySelector('link[data-route-weather-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-route-weather-leaflet", "true");
        document.head.appendChild(link);
      }
      const map = L.map(mapEl.current, { attributionControl: false, zoomControl: true }).setView([20.8, -157.3], 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      weatherLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 100);
    }
    init();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    async function drawRoute() {
      const map = mapRef.current;
      const layer = routeLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      if (route.length < 2) return;
      const latlngs = route.map((wp) => [wp.lat, wp.lon] as [number, number]);
      L.polyline(latlngs, { color: "#22d3ee", weight: 3, opacity: 0.95 }).addTo(layer);
      route.forEach((wp, i) => {
        L.circleMarker([wp.lat, wp.lon], { radius: 4, color: "#f1d56b", weight: 2, fillColor: "#071019", fillOpacity: 1 })
          .bindTooltip(`${i + 1}. ${wp.name}`, { direction: "top" }).addTo(layer);
      });
      map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });
    }
    drawRoute();
  }, [route]);

  const encounter = useMemo<EncounterPoint[]>(() => {
    if (!weather?.frames?.length || !Number.isFinite(speedKt) || speedKt <= 0) return [];
    const dep = new Date(`${departure}:00-10:00`);
    if (!Number.isFinite(dep.getTime())) return [];
    const count = weather.frames[0]?.points?.length || 0;
    const rows: EncounterPoint[] = [];
    for (let i = 0; i < count; i += 1) {
      const first = weather.frames[0].points[i];
      if (!first) continue;
      const eta = new Date(dep.getTime() + (first.distanceNm / speedKt) * 3600000);
      let bestFrame = weather.frames[0];
      let bestDelta = Math.abs(new Date(bestFrame.validAt).getTime() - eta.getTime());
      for (const frame of weather.frames) {
        const delta = Math.abs(new Date(frame.validAt).getTime() - eta.getTime());
        if (delta < bestDelta) { bestFrame = frame; bestDelta = delta; }
      }
      const p = bestFrame.points[i];
      if (!p) continue;
      rows.push({ ...p, eta, validAt: new Date(bestFrame.validAt), deltaHours: bestDelta / 3600000 });
    }
    return rows;
  }, [weather, speedKt, departure]);

  const displayedPoints = useMemo<ForecastPoint[]>(() => {
    if (!weather) return [];
    if (mode === "encounter") return encounter;
    return weather.frames[frameIndex]?.points || [];
  }, [weather, encounter, mode, frameIndex]);

  const maxSeas = useMemo(() => maxBy(displayedPoints, "waveHeightFt"), [displayedPoints]);
  const maxWind = useMemo(() => maxBy(displayedPoints, "windKt"), [displayedPoints]);
  const maxGust = useMemo(() => maxBy(displayedPoints, "gustKt"), [displayedPoints]);
  const selectedFrame = weather?.frames?.[frameIndex];

  useEffect(() => {
    async function drawWeather() {
      const layer = weatherLayerRef.current;
      if (!mapRef.current || !layer) return;
      const L = await import("leaflet");
      layer.clearLayers();
      displayedPoints.forEach((p) => {
        const wave = p.waveHeightFt;
        const wind = p.windKt;
        const color = wave === null ? "#64748b" : wave >= 10 ? "#ef4444" : wave >= 7 ? "#f59e0b" : wave >= 5 ? "#eab308" : "#22c55e";
        const seaText = wave === null ? "SEA --" : `${wave.toFixed(1)} FT`;
        const windText = wind === null ? "WIND --" : `${compass(p.windDirectionDeg)} ${wind.toFixed(0)} KT`;
        const label = [showSeas ? seaText : "", showWind ? windText : ""].filter(Boolean).join(" · ");
        const icon = L.divIcon({
          className: "",
          html: `<div style="transform:translate(-50%,-100%);white-space:nowrap;background:rgba(4,8,12,.92);border:1px solid ${color};color:#e2e8f0;padding:4px 6px;font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 1px 4px rgba(0,0,0,.45)">${label || "ROUTE WX"}</div><div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #071019;transform:translate(-50%,-50%)"></div>`,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        });
        const marker = L.marker([p.lat, p.lon], { icon, interactive: true });
        marker.bindPopup([
          showSeas ? `<b>Seas:</b> ${wave === null ? "No wave grid" : `${wave.toFixed(1)} ft`}` : "",
          showWind ? `<b>Wind:</b> ${wind === null ? "--" : `${compass(p.windDirectionDeg)} ${wind.toFixed(0)} kt`}` : "",
          p.gustKt !== null && showWind ? `<b>Gust:</b> ${p.gustKt.toFixed(0)} kt` : "",
          `<b>Source:</b> ${p.source}`,
        ].filter(Boolean).join("<br/>")).addTo(layer);
      });
    }
    drawWeather();
  }, [displayedPoints, showWind, showSeas]);

  async function loadRouteFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseRtz(text);
      if (parsed.length < 2) throw new Error("No usable RTZ waypoints found.");
      setRoute(parsed);
      setRouteName(file.name);
      setWeather(null);
      setFrameIndex(0);
      setStatus(`${parsed.length} waypoints loaded. Ready to analyze NOAA route weather.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read route.");
    }
  }

  async function analyze() {
    if (route.length < 2) return;
    setStatus("Sampling NOAA/NWS weather along the route…");
    setWeather(null);
    try {
      const response = await fetch("/api/noaa-route-weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: route }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Route weather request failed.");
      setWeather(json);
      setFrameIndex(0);
      setStatus(json.note || `Weather loaded from ${json.product}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Weather analysis failed.");
    }
  }

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-amber-500/25 bg-[#071019] px-3 py-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH ROUTE WEATHER LAB</div>
          <div className="text-sm font-black">Route-specific weather encounter preview</div>
        </div>
        <Link href="/" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">NAV CONSOLE</Link>
      </div>

      <div className="mb-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="border border-slate-700/50 bg-[#071019] p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD RTZ<input type="file" accept=".rtz,.xml,text/xml" className="hidden" onChange={(e) => e.target.files?.[0] && loadRouteFile(e.target.files[0])} /></label>
            <button type="button" disabled={route.length < 2} onClick={analyze} className="border border-emerald-400/40 bg-[#08130f] px-3 py-2 text-[10px] font-black text-emerald-200 disabled:opacity-40">ANALYZE ROUTE</button>
            <button type="button" onClick={() => setMode("encounter")} className={`border px-3 py-2 text-[10px] font-black ${mode === "encounter" ? "border-[#c9a227] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>ROUTE ENCOUNTER</button>
            <button type="button" disabled={!weather} onClick={() => setMode("time")} className={`border px-3 py-2 text-[10px] font-black disabled:opacity-40 ${mode === "time" ? "border-[#c9a227] text-[#f1d56b]" : "border-slate-700 text-slate-400"}`}>WEATHER TIME</button>
          </div>

          <div ref={mapEl} style={{ width: "100%", height: "62vh", minHeight: 500, background: "#0a141d" }} />

          {weather && mode === "time" && (
            <div className="mt-2 border border-slate-800 bg-[#050a0f] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-black">
                <span className="text-slate-400">FORECAST SNAPSHOT · ALL ROUTE SAMPLES UPDATE AS YOU SCRUB</span>
                <span className="text-cyan-300">{selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setFrameIndex((i) => Math.max(0, i - 1))} className="border border-slate-700 px-3 py-2 text-xs font-black">◀</button>
                <input className="w-full accent-amber-400" type="range" min={0} max={Math.max(0, weather.frames.length - 1)} value={frameIndex} onChange={(e) => setFrameIndex(Number(e.target.value))} />
                <button type="button" onClick={() => setFrameIndex((i) => Math.min(weather.frames.length - 1, i + 1))} className="border border-slate-700 px-3 py-2 text-xs font-black">▶</button>
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>NOW</span><span>+24 HR</span></div>
            </div>
          )}
        </section>

        <aside className="space-y-2">
          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">VOYAGE</div>
            <div className="mt-1 truncate text-sm font-black text-cyan-200">{routeName}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[9px] font-black text-slate-500">DEPARTURE HST<input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label>
              <label className="text-[9px] font-black text-slate-500">SPEED KT<input type="number" min="1" max="30" step="0.1" value={speedKt} onChange={(e) => setSpeedKt(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border border-slate-700 bg-[#050a0f] px-2 py-2 text-sm text-slate-100" /></label>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">WPTS</div><div className="font-black">{route.length || "--"}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">NM</div><div className="font-black">{route.length ? totalNm.toFixed(0) : "--"}</div></div>
              <div className="border border-slate-800 bg-[#050a0f] p-2"><div className="text-[8px] text-slate-500">HOURS</div><div className="font-black">{route.length ? (totalNm / speedKt).toFixed(1) : "--"}</div></div>
            </div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="flex items-center justify-between gap-2"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">{mode === "encounter" ? "WORST ALONG VOYAGE" : "ROUTE AT SELECTED TIME"}</div><span className="text-[9px] font-black text-emerald-300">ROUTE-SAMPLED</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="border border-slate-800 bg-[#050a0f] p-3">
                <div className="text-[8px] font-black text-slate-500">MAX SEAS</div>
                <div className={`mt-1 font-black ${maxSeas ? "text-3xl text-[#f1d56b]" : "text-sm text-amber-300"}`}>{maxSeas?.waveHeightFt !== null && maxSeas?.waveHeightFt !== undefined ? `${maxSeas.waveHeightFt.toFixed(1)} ft` : "NO WAVE DATA"}</div>
                {maxSeas && <div className="mt-1 text-[9px] text-slate-500">{maxSeas.distanceNm.toFixed(0)} NM along route</div>}
              </div>
              <div className="border border-slate-800 bg-[#050a0f] p-3">
                <div className="text-[8px] font-black text-slate-500">MAX WIND</div>
                <div className={`mt-1 font-black ${maxWind ? "text-3xl text-cyan-300" : "text-sm text-slate-500"}`}>{maxWind?.windKt !== null && maxWind?.windKt !== undefined ? `${maxWind.windKt.toFixed(0)} kt` : "NO WIND DATA"}</div>
                {maxWind && <div className="mt-1 text-[9px] text-slate-500">{compass(maxWind.windDirectionDeg)} · {maxWind.distanceNm.toFixed(0)} NM</div>}
              </div>
            </div>
            {maxGust?.gustKt !== null && maxGust?.gustKt !== undefined && <div className="mt-2 text-[10px] text-slate-400">Highest gust: <b className="text-slate-200">{maxGust.gustKt.toFixed(0)} kt</b></div>}
            {!maxSeas && weather && <div className="mt-2 border-l-2 border-amber-400/60 pl-2 text-[10px] leading-4 text-amber-200">The NOAA route response has no wave-height grid for these samples. NavDash is no longer hiding that as “--”. This is the gap we need the GFS Wave layer to fill.</div>}
          </section>

          {weather && mode === "time" && (
            <section className="border border-cyan-700/40 bg-[#061018] p-3">
              <div className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-400">CURRENT SNAPSHOT</div>
              <div className="mt-1 text-lg font-black text-cyan-100">{selectedFrame ? formatWhen(new Date(selectedFrame.validAt)) : "--"}</div>
              <div className="mt-2 text-xs leading-5 text-slate-300">Every weather tag on the chart is this same forecast time. Slide once and the whole route updates together.</div>
            </section>
          )}

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">LAYERS</div>
            <div className="mt-2 flex gap-4 text-xs font-bold"><label><input type="checkbox" checked={showSeas} onChange={(e) => setShowSeas(e.target.checked)} className="mr-2" />Seas</label><label><input type="checkbox" checked={showWind} onChange={(e) => setShowWind(e.target.checked)} className="mr-2" />Wind</label></div>
          </section>

          <section className="border border-slate-700/50 bg-[#071019] p-3">
            <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">DATA STATUS</div>
            <div className="mt-2 text-xs leading-5 text-slate-300">{status}</div>
            {weather && <div className="mt-2 text-[10px] leading-4 text-slate-500">{weather.provider}<br/>{weather.product}<br/>Coverage {weather.coveredSampleCount}/{weather.sampleCount} route samples</div>}
          </section>
        </aside>
      </div>

      {weather && mode === "encounter" && (
        <section className="border border-slate-700/50 bg-[#071019] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">WEATHER ALONG ROUTE</div><div className="text-xs text-slate-400">Each sample uses the forecast time nearest the vessel ETA at that point.</div></div>
            <div className="text-[10px] font-black text-amber-300">FORECAST MATCH WINDOW: 0–24 HR</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500"><tr><th className="py-2">Dist</th><th>ETA HST</th><th>Forecast valid</th><th>Wind</th><th>Gust</th><th>Seas</th><th>Period</th><th>Source</th></tr></thead>
              <tbody>{encounter.map((p, i) => <tr key={`${p.lat}-${p.lon}-${i}`} className="border-b border-slate-900"><td className="py-2 font-mono">{p.distanceNm.toFixed(0)} NM</td><td>{formatWhen(p.eta)}</td><td>{formatWhen(p.validAt)} <span className="text-slate-600">({p.deltaHours.toFixed(1)}h)</span></td><td>{p.windKt === null ? "--" : `${compass(p.windDirectionDeg)} ${p.windKt.toFixed(0)} kt`}</td><td>{p.gustKt === null ? "--" : `${p.gustKt.toFixed(0)} kt`}</td><td className="font-black text-[#f1d56b]">{p.waveHeightFt === null ? "NO DATA" : `${p.waveHeightFt.toFixed(1)} ft`}</td><td>{p.wavePeriodSec === null ? "--" : `${p.wavePeriodSec.toFixed(0)} s`}</td><td className="text-slate-500">{p.source}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}