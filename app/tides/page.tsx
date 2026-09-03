"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type TidePoint = { time: string; valueFt: number; type?: string };
type TideStation = { id: string; name: string; lat: number; lon: number; distanceNm?: number; type?: string; referenceId?: string; timezoneCorr?: number | null };
type TideResponse = { ok: boolean; error?: string; generatedAt?: string; station?: TideStation; stations?: TideStation[]; datum?: string; units?: string; timeZone?: string; hourly?: TidePoint[]; highLow?: TidePoint[] };
type Position = { lat: number; lon: number; updatedAt: number };
type RangeOption = { label: string; hours: number };

const RANGE_OPTIONS: RangeOption[] = [
  { label: "12 HR", hours: 12 },
  { label: "24 HR", hours: 24 },
  { label: "48 HR", hours: 48 },
  { label: "3 DAY", hours: 72 },
  { label: "5 DAY", hours: 120 },
  { label: "7 DAY", hours: 168 },
];

function unsigned(bits: string, start: number, length: number) { return parseInt(bits.slice(start, start + length), 2); }
function signed(bits: string, start: number, length: number) { const raw = bits.slice(start, start + length); const value = parseInt(raw, 2); const signBit = 2 ** (length - 1); return value >= signBit ? value - 2 ** length : value; }
function payloadBits(payload: string) { return payload.split("").map((char) => { let value = char.charCodeAt(0) - 48; if (value > 40) value -= 8; return value.toString(2).padStart(6, "0"); }).join(""); }
function decodeOwnShip(line: string): Position | null {
  if (!line.startsWith("!AIVDO")) return null;
  const parts = line.split(",");
  if (Number(parts[1]) !== 1 || !parts[5]) return null;
  try {
    const bits = payloadBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    let lon = 0; let lat = 0;
    if ([1, 2, 3].includes(type)) { lon = signed(bits, 61, 28) / 600000; lat = signed(bits, 89, 27) / 600000; }
    else if ([18, 19].includes(type)) { lon = signed(bits, 57, 28) / 600000; lat = signed(bits, 85, 27) / 600000; }
    else return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;
    return { lat, lon, updatedAt: Date.now() };
  } catch { return null; }
}
function parseStationTime(value: string) { const [datePart, timePart = "00:00"] = value.trim().split(/\s+/); const [y, m, d] = datePart.split("-").map(Number); const [hh, mm] = timePart.split(":").map(Number); return new Date(y, m - 1, d, hh, mm, 0, 0); }
function fmtTime(value?: string) { if (!value) return "--"; return parseStationTime(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); }
function fmtDate(value?: string) { if (!value) return "--"; return parseStationTime(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
function timezoneLabel(offset?: number | null) { if (offset === null || offset === undefined || !Number.isFinite(offset)) return "LST/LDT"; const sign = offset <= 0 ? "−" : "+"; return `UTC${sign}${Math.abs(offset)}`; }
function interpolate(points: TidePoint[], now: Date) {
  if (!points.length) return null;
  const timed = points.map((p) => ({ ...p, ms: parseStationTime(p.time).getTime() })).sort((a, b) => a.ms - b.ms);
  const t = now.getTime();
  if (t <= timed[0].ms) return timed[0].valueFt;
  if (t >= timed[timed.length - 1].ms) return timed[timed.length - 1].valueFt;
  for (let i = 1; i < timed.length; i++) { if (timed[i].ms >= t) { const a = timed[i - 1]; const b = timed[i]; const ratio = (t - a.ms) / (b.ms - a.ms || 1); return a.valueFt + (b.valueFt - a.valueFt) * ratio; } }
  return null;
}

function TideChart({ points, now, dayMode }: { points: TidePoint[]; now: Date; dayMode: boolean }) {
  const width = 1000; const height = 360; const pad = 42;
  const data = points.slice().sort((a, b) => parseStationTime(a.time).getTime() - parseStationTime(b.time).getTime());
  if (data.length < 2) return <div className="grid h-[320px] place-items-center text-sm font-bold text-slate-400">Waiting for NOAA tide predictions…</div>;
  const times = data.map((p) => parseStationTime(p.time).getTime()); const values = data.map((p) => p.valueFt);
  const minT = Math.min(...times); const maxT = Math.max(...times); const minV = Math.min(...values); const maxV = Math.max(...values); const spanV = Math.max(0.5, maxV - minV);
  const x = (t: number) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - minV) / spanV) * (height - pad * 2);
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(parseStationTime(p.time).getTime()).toFixed(1)},${y(p.valueFt).toFixed(1)}`).join(" ");
  const nowX = x(Math.min(maxT, Math.max(minT, now.getTime()))); const grid = dayMode ? "#cbd5e1" : "rgba(148,163,184,.2)"; const text = dayMode ? "#64748b" : "#94a3b8";
  return <svg className="mt-3 block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="NOAA predicted tide curve">
    {[0,1,2,3,4].map((i) => { const yy = pad + ((height - pad * 2) * i) / 4; return <line key={i} x1={pad} x2={width-pad} y1={yy} y2={yy} stroke={grid} strokeWidth="1" />; })}
    <path d={path} fill="none" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1={nowX} x2={nowX} y1={pad} y2={height-pad} stroke="#c9a227" strokeWidth="2.5" strokeDasharray="7 7" />
    <text x={nowX+7} y={pad+16} fill="#c9a227" fontSize="13" fontWeight="800">NOW</text>
    <text x={pad} y={height-10} fill={text} fontSize="13" fontWeight="700">{fmtTime(data[0]?.time)}</text>
    <text x={width-pad} y={height-10} textAnchor="end" fill={text} fontSize="13" fontWeight="700">{fmtTime(data[data.length-1]?.time)}</text>
    <text x={pad} y={24} fill={text} fontSize="13" fontWeight="700">{maxV.toFixed(1)} ft</text>
    <text x={pad} y={height-pad-8} fill={text} fontSize="13" fontWeight="700">{minV.toFixed(1)} ft</text>
  </svg>;
}

export default function TidesPage() {
  const { nightMode, toggleTheme } = useBridgeTheme(); const dayMode = !nightMode;
  const [position, setPosition] = useState<Position | null>(null); const [manualLat, setManualLat] = useState("21.33"); const [manualLon, setManualLon] = useState("-157.967");
  const [data, setData] = useState<TideResponse | null>(null); const [stationId, setStationId] = useState(""); const [search, setSearch] = useState(""); const [searchResults, setSearchResults] = useState<TideStation[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [now, setNow] = useState(new Date()); const [rangeHours, setRangeHours] = useState(24); const lastLookupRef = useRef("");

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let ws: WebSocket | null = null; let retry = 0; let closed = false;
    const connect = () => { if (closed) return; try { ws = new WebSocket(getAisWebSocketUrl()); ws.onmessage = (event) => { let raw = String(event.data || ""); try { const parsed = JSON.parse(raw); raw = typeof parsed === "string" ? parsed : parsed?.sentence || parsed?.nmea || parsed?.raw || parsed?.line || raw; } catch {} for (const sourceLine of raw.split(/\r?\n/)) { const decoded = decodeOwnShip(sourceLine.trim()); if (decoded) setPosition(decoded); } }; ws.onclose = () => { if (!closed) retry = window.setTimeout(connect, 2500); }; } catch { retry = window.setTimeout(connect, 2500); } };
    connect(); return () => { closed = true; window.clearTimeout(retry); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);

  async function loadTides(pos: Position, station = stationId, hours = rangeHours) {
    const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)},${station},${hours}`; if (lastLookupRef.current === key && data?.ok) return;
    setLoading(true); setError("");
    try { const params = new URLSearchParams({ lat: String(pos.lat), lon: String(pos.lon), hours: String(hours) }); if (station) params.set("station", station); const res = await fetch(`/api/tides?${params}`, { cache: "no-store" }); const json: TideResponse = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Tide lookup failed."); setData(json); setStationId(json.station?.id || station); lastLookupRef.current = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)},${json.station?.id || station},${hours}`; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (!position) return; const timer = window.setTimeout(() => loadTides(position, stationId, rangeHours), 350); return () => window.clearTimeout(timer); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [position?.lat, position?.lon, rangeHours]);

  async function searchStations() { if (!position || search.trim().length < 2) return; try { const params = new URLSearchParams({ lat: String(position.lat), lon: String(position.lon), q: search.trim(), hours: String(rangeHours) }); const res = await fetch(`/api/tides?${params}`, { cache: "no-store" }); const json = await res.json(); setSearchResults(Array.isArray(json?.stations) ? json.stations : []); } catch { setSearchResults([]); } }

  const highLow = data?.highLow || []; const hourly = data?.hourly || []; const currentHeight = interpolate(hourly, now); const rangeEndMs = now.getTime() + rangeHours * 3600000; const chartStartMs = now.getTime() - 3 * 3600000;
  const visibleHourly = hourly.filter((p) => { const t = parseStationTime(p.time).getTime(); return t >= chartStartMs && t <= rangeEndMs; });
  const visibleHighLow = highLow.filter((p) => { const t = parseStationTime(p.time).getTime(); return t >= now.getTime() && t <= rangeEndMs; });
  const nextHigh = visibleHighLow.find((p) => p.type === "H"); const nextLow = visibleHighLow.find((p) => p.type === "L");
  const rising = (() => { if (hourly.length < 2) return null; const futureHourly = hourly.find((p) => parseStationTime(p.time).getTime() > now.getTime()); return futureHourly && currentHeight !== null ? futureHourly.valueFt >= currentHeight : null; })();
  const grouped = useMemo(() => { const map = new Map<string, TidePoint[]>(); visibleHighLow.forEach((p) => { const key = fmtDate(p.time); map.set(key, [...(map.get(key) || []), p]); }); return Array.from(map.entries()); }, [visibleHighLow]);
  const station = data?.station; const stationDistance = station?.distanceNm; const rangeLabel = RANGE_OPTIONS.find((o) => o.hours === rangeHours)?.label || `${rangeHours} HR`;
  const panelClass = dayMode ? "rounded-[2rem] border border-slate-300 bg-white shadow-xl shadow-slate-900/10" : "rounded-[2rem] border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/40 backdrop-blur-xl";
  const softPanel = dayMode ? "rounded-3xl border border-slate-300 bg-slate-50" : "rounded-3xl border border-white/10 bg-black/25";
  const muted = dayMode ? "text-slate-600" : "text-slate-400"; const primary = dayMode ? "text-slate-950" : "text-white"; const control = dayMode ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "border-white/10 bg-white/10 text-slate-100 hover:bg-white/15";

  return <main className={dayMode ? "min-h-screen bg-white text-slate-950" : "min-h-screen bg-[#071019] text-slate-100"}>
    <div className={dayMode ? "fixed inset-0 bg-white" : "fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(201,162,39,.28),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.12),transparent_28%),linear-gradient(135deg,#071019,#101c2b_48%,#071019)]"} />
    <style jsx global>{`body:has(.navdash-tides-page) .navdash-global-nav{display:none!important}@media print{body:has(.navdash-tides-page) .navdash-global-nav{display:none!important}.navdash-tides-page{background:#fff!important;color:#111!important}.tides-no-print{display:none!important}.tides-print-panel{background:#fff!important;color:#111!important;border-color:#bbb!important;box-shadow:none!important;backdrop-filter:none!important}.tides-print-muted{color:#444!important}.tides-print-break{break-inside:avoid}}`}</style>
    <div className="navdash-tides-page relative z-10 min-h-screen p-3 md:p-4 xl:p-5 2xl:p-7">
      <header className={`${panelClass} tides-print-panel mb-4 p-4 md:p-5`}><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="flex items-center gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl border border-wardGold/45 bg-wardGold/15 text-3xl font-black text-wardGold">T</div><div><div className="text-xs font-bold uppercase tracking-[0.42em] text-wardGold">M/V MB480</div><h1 className={`text-4xl font-black tracking-tight 2xl:text-5xl ${primary}`}>Tides</h1><div className={`mt-1 text-sm ${muted} tides-print-muted`}>NOAA CO-OPS tide predictions • nearest usable station</div></div></div><div className="tides-no-print flex flex-wrap items-center gap-2 xl:justify-end"><Link href="/" className={`inline-flex h-12 items-center justify-center rounded-2xl border px-4 text-sm font-black shadow-lg ${control}`}>Nav Dash</Link><button onClick={toggleTheme} className={`h-12 rounded-2xl border px-4 text-sm font-black shadow-lg ${control}`}>{nightMode ? "Day Mode" : "Bridge Night"}</button><button onClick={() => window.print()} className="h-12 rounded-2xl border border-amber-700 bg-wardGold px-5 text-sm font-black text-[#111827] shadow-lg shadow-wardGold/20 hover:brightness-110">Print Tide Sheet</button></div></div></header>

      <section className={`${panelClass} tides-print-panel mb-4 p-4 md:p-5`}><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="min-w-0"><div className="text-xs font-black uppercase tracking-[0.22em] text-wardGold">Selected station</div><div className={`mt-1 truncate text-2xl font-black ${primary}`}>{station?.name || (loading ? "Finding nearest tide station…" : "Waiting for vessel position")}</div><div className={`mt-1 text-sm font-bold ${muted} tides-print-muted`}>{station ? `NOAA ${station.id} • ${data?.datum || "MLLW"} • ${timezoneLabel(station.timezoneCorr)} • ${stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM from vessel` : "distance unavailable"}` : "Nearest valid NOAA tide prediction station will be selected automatically."}</div></div><div className="tides-no-print flex flex-col gap-2 sm:flex-row sm:items-center"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchStations(); }} placeholder="Search NOAA station" className={`h-12 min-w-[230px] rounded-2xl border px-4 text-sm font-bold outline-none ${control}`} /><button onClick={searchStations} disabled={!position || search.trim().length < 2} className={`h-12 rounded-2xl border px-4 text-sm font-black disabled:opacity-40 ${control}`}>Search</button></div></div><div className="tides-no-print mt-4 flex flex-wrap items-center gap-2"><span className={`mr-1 text-xs font-black uppercase tracking-[0.18em] ${muted}`}>Time Range</span>{RANGE_OPTIONS.map((option) => { const active = option.hours === rangeHours; return <button key={option.hours} onClick={() => setRangeHours(option.hours)} className={active ? "h-10 rounded-2xl border border-amber-700 bg-wardGold px-4 text-xs font-black text-[#111827] shadow-md shadow-wardGold/20" : `h-10 rounded-2xl border px-4 text-xs font-black ${control}`}>{option.label}</button>; })}</div></section>

      {!position && <section className={`${panelClass} tides-no-print mb-4 p-4 md:p-5`}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="font-black">AIS position not received yet.</div><div className={`text-sm ${muted}`}>Enter a position to test the tide page.</div></div><div className="flex flex-wrap gap-2"><input aria-label="Latitude" value={manualLat} onChange={(e) => setManualLat(e.target.value)} className={`h-11 w-32 rounded-2xl border px-3 font-mono text-sm ${control}`} /><input aria-label="Longitude" value={manualLon} onChange={(e) => setManualLon(e.target.value)} className={`h-11 w-36 rounded-2xl border px-3 font-mono text-sm ${control}`} /><button onClick={() => { const lat = Number(manualLat); const lon = Number(manualLon); if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setPosition({ lat, lon, updatedAt: Date.now() }); }} className="h-11 rounded-2xl border border-amber-700 bg-wardGold px-4 text-sm font-black text-[#111827]">Use Position</button></div></div></section>}
      {error && <div className="tides-no-print mb-4 rounded-3xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm font-bold text-red-200">{error}</div>}
      {searchResults.length > 0 && <section className={`${panelClass} tides-no-print mb-4 grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3`}>{searchResults.map((s) => <button key={s.id} onClick={() => { setSearchResults([]); setSearch(""); setStationId(s.id); if (position) loadTides(position, s.id, rangeHours); }} className={`rounded-2xl border p-3 text-left ${control}`}><span className="block font-black">{s.name}</span><span className={`mt-1 block text-xs font-bold ${muted}`}>{s.id} • {s.distanceNm?.toFixed(1) ?? "--"} NM</span></button>)}</section>}

      <section className="grid gap-4 xl:grid-cols-[2.1fr_.8fr]"><div className={`${panelClass} tides-print-panel tides-print-break p-4 md:p-5`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-400">{rising === null ? "TIDE" : rising ? "FLOODING" : "EBBING"}</div><div className={`mt-1 text-5xl font-black tracking-tight ${primary}`}>{currentHeight === null ? "--" : currentHeight.toFixed(1)} <span className={`text-xl ${muted}`}>ft</span></div><div className={`mt-1 text-xs font-bold uppercase tracking-[0.16em] ${muted} tides-print-muted`}>Predicted height • {data?.datum || "MLLW"}</div></div><div className="text-right"><div className="font-mono text-3xl font-black text-wardGold">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</div><div className={`mt-1 text-xs font-black uppercase tracking-[0.16em] ${muted} tides-print-muted`}>{rangeLabel} view</div></div></div><TideChart points={visibleHourly} now={now} dayMode={dayMode} /></div><aside className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1"><div className={`${softPanel} tides-print-panel tides-print-break p-4`}><div className={`text-xs font-black uppercase tracking-[0.2em] ${muted} tides-print-muted`}>Next High</div><div className={`mt-2 text-3xl font-black ${primary}`}>{nextHigh ? `${nextHigh.valueFt.toFixed(1)} ft` : "--"}</div><div className={`mt-1 text-sm font-bold ${muted} tides-print-muted`}>{nextHigh ? `${fmtDate(nextHigh.time)} • ${fmtTime(nextHigh.time)}` : "Outside selected range"}</div></div><div className={`${softPanel} tides-print-panel tides-print-break p-4`}><div className={`text-xs font-black uppercase tracking-[0.2em] ${muted} tides-print-muted`}>Next Low</div><div className={`mt-2 text-3xl font-black ${primary}`}>{nextLow ? `${nextLow.valueFt.toFixed(1)} ft` : "--"}</div><div className={`mt-1 text-sm font-bold ${muted} tides-print-muted`}>{nextLow ? `${fmtDate(nextLow.time)} • ${fmtTime(nextLow.time)}` : "Outside selected range"}</div></div><div className={`${softPanel} tides-print-panel tides-print-break p-4`}><div className={`text-xs font-black uppercase tracking-[0.2em] ${muted} tides-print-muted`}>Source</div><div className="mt-2 text-xl font-black text-wardGold">NOAA CO-OPS</div><div className={`mt-1 text-sm font-bold ${muted} tides-print-muted`}>Official tide predictions • {data?.timeZone || "LST/LDT"}</div></div></aside></section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_.75fr]"><div className={`${panelClass} tides-print-panel tides-print-break p-4 md:p-5`}><div className="flex items-center justify-between gap-3"><h2 className={`text-xl font-black ${primary}`}>High / Low Predictions</h2><div className={`text-xs font-black uppercase tracking-[0.16em] ${muted} tides-print-muted`}>{rangeLabel}</div></div><div className="mt-3 divide-y divide-white/10">{grouped.length ? grouped.map(([day, events]) => <div key={day} className="grid gap-3 py-3 md:grid-cols-[140px_1fr] md:items-center"><div className="font-black text-wardGold">{day}</div><div className="flex flex-wrap gap-2">{events.map((event, idx) => <div key={`${event.time}-${idx}`} className={`${softPanel} tides-print-panel grid grid-cols-[52px_54px_52px] items-center gap-2 px-3 py-2 font-mono text-sm`}><span className={event.type === "H" ? "font-black text-cyan-400" : "font-black text-wardGold"}>{event.type === "H" ? "HIGH" : "LOW"}</span><strong>{fmtTime(event.time)}</strong><span className={muted}>{event.valueFt.toFixed(1)} ft</span></div>)}</div></div>) : <div className={`py-8 text-center text-sm font-bold ${muted}`}>No high/low event falls inside the selected time range.</div>}</div></div><div className={`${panelClass} tides-print-panel tides-print-break p-4 md:p-5`}><h2 className={`text-xl font-black ${primary}`}>Station / Vessel</h2><dl className="mt-3 divide-y divide-white/10 text-sm">{[["Station", station?.name || "--"],["Station ID", station?.id || "--"],["Datum", data?.datum || "MLLW"],["Time basis", timezoneLabel(station?.timezoneCorr)],["Station type", station?.type === "S" ? "Subordinate" : station?.type === "R" ? "Reference" : station?.type || "--"],["Vessel position", position ? `${position.lat.toFixed(4)}°, ${position.lon.toFixed(4)}°` : "--"],["Distance", stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM` : "--"]].map(([label,value]) => <div key={label} className="grid grid-cols-[110px_1fr] gap-3 py-2.5"><dt className={`${muted} tides-print-muted`}>{label}</dt><dd className="m-0 text-right font-black">{value}</dd></div>)}</dl>{stationDistance !== undefined && stationDistance > 100 && <div className="mt-3 rounded-2xl border border-amber-400/35 bg-amber-400/10 p-3 text-xs font-bold text-amber-300">Nearest prediction station is distant from the vessel. Select the destination or port station for operational planning.</div>}</div></section>
      <footer className={`tides-print-muted py-5 text-center text-xs font-bold ${muted}`}>Predictions: NOAA CO-OPS • Datum: {data?.datum || "MLLW"} • Times: {timezoneLabel(station?.timezoneCorr)} • Range: {rangeLabel} • Generated: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "--"}</footer>
    </div>
  </main>;
}
