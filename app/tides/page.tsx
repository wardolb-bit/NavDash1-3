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
  for (let i = 1; i < timed.length; i++) if (timed[i].ms >= t) { const a = timed[i - 1]; const b = timed[i]; const ratio = (t - a.ms) / (b.ms - a.ms || 1); return a.valueFt + (b.valueFt - a.valueFt) * ratio; }
  return null;
}
function TideChart({ points, now, dayMode }: { points: TidePoint[]; now: Date; dayMode: boolean }) {
  const width = 1000; const height = 330; const pad = 42;
  const data = points.slice().sort((a, b) => parseStationTime(a.time).getTime() - parseStationTime(b.time).getTime());
  if (data.length < 2) return <div className="grid h-[300px] place-items-center text-[11px] font-bold uppercase tracking-[.12em] text-slate-500">Waiting for NOAA tide predictions</div>;
  const times = data.map((p) => parseStationTime(p.time).getTime()); const values = data.map((p) => p.valueFt);
  const minT = Math.min(...times); const maxT = Math.max(...times); const minV = Math.min(...values); const maxV = Math.max(...values); const spanV = Math.max(.5, maxV - minV);
  const x = (t: number) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - minV) / spanV) * (height - pad * 2);
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(parseStationTime(p.time).getTime()).toFixed(1)},${y(p.valueFt).toFixed(1)}`).join(" ");
  const nowX = x(Math.min(maxT, Math.max(minT, now.getTime())));
  const grid = dayMode ? "#cbd5e1" : "rgba(148,163,184,.18)"; const text = dayMode ? "#64748b" : "#7f9caf";
  return <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="NOAA predicted tide curve">
    {[0,1,2,3,4].map((i) => { const yy = pad + ((height - pad * 2) * i) / 4; return <line key={i} x1={pad} x2={width-pad} y1={yy} y2={yy} stroke={grid} strokeWidth="1" />; })}
    <path d={path} fill="none" stroke="#56bad0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <line x1={nowX} x2={nowX} y1={pad} y2={height-pad} stroke="#f2b84b" strokeWidth="2" strokeDasharray="6 6" />
    <text x={nowX+7} y={pad+14} fill="#f2b84b" fontSize="12" fontWeight="800">NOW</text>
    <text x={pad} y={height-10} fill={text} fontSize="12" fontWeight="700">{fmtTime(data[0]?.time)}</text>
    <text x={width-pad} y={height-10} textAnchor="end" fill={text} fontSize="12" fontWeight="700">{fmtTime(data[data.length-1]?.time)}</text>
    <text x={pad} y={22} fill={text} fontSize="12" fontWeight="700">{maxV.toFixed(1)} ft</text>
    <text x={pad} y={height-pad-7} fill={text} fontSize="12" fontWeight="700">{minV.toFixed(1)} ft</text>
  </svg>;
}

export default function TidesPage() {
  const { nightMode, toggleTheme } = useBridgeTheme(); const dayMode = !nightMode;
  const [position, setPosition] = useState<Position | null>(null); const [manualLat, setManualLat] = useState("21.33"); const [manualLon, setManualLon] = useState("-157.967");
  const [data, setData] = useState<TideResponse | null>(null); const [stationId, setStationId] = useState(""); const [search, setSearch] = useState(""); const [searchResults, setSearchResults] = useState<TideStation[]>([]);
  const [loading, setLoading] = useState(false); const [searchingStations, setSearchingStations] = useState(false); const [error, setError] = useState(""); const [now, setNow] = useState(new Date()); const [rangeHours, setRangeHours] = useState(24); const lastLookupRef = useRef(""); const searchRequestRef = useRef(0);

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
  async function searchStations(queryOverride = search) {
    const q = queryOverride.trim();
    if (!position || q.length < 2) { setSearchResults([]); setSearchingStations(false); return; }
    const requestId = ++searchRequestRef.current;
    setSearchingStations(true);
    try {
      const params = new URLSearchParams({ lat: String(position.lat), lon: String(position.lon), q, hours: String(rangeHours) });
      const res = await fetch(`/api/tides?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (requestId === searchRequestRef.current) setSearchResults(Array.isArray(json?.stations) ? json.stations : []);
    } catch {
      if (requestId === searchRequestRef.current) setSearchResults([]);
    } finally {
      if (requestId === searchRequestRef.current) setSearchingStations(false);
    }
  }
  useEffect(() => {
    const q = search.trim();
    if (!position || q.length < 2) { searchRequestRef.current += 1; setSearchResults([]); setSearchingStations(false); return; }
    const timer = window.setTimeout(() => { void searchStations(q); }, 250);
    return () => window.clearTimeout(timer);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search, position?.lat, position?.lon]);
  function selectStation(station: TideStation) {
    searchRequestRef.current += 1;
    setSearchResults([]);
    setSearch("");
    setStationId(station.id);
    setError("");
    lastLookupRef.current = "";
    if (position) void loadTides(position, station.id, rangeHours);
  }

  const highLow = data?.highLow || []; const hourly = data?.hourly || []; const currentHeight = interpolate(hourly, now); const rangeEndMs = now.getTime() + rangeHours * 3600000; const chartStartMs = now.getTime() - 3 * 3600000;
  const visibleHourly = hourly.filter((p) => { const t = parseStationTime(p.time).getTime(); return t >= chartStartMs && t <= rangeEndMs; });
  const visibleHighLow = highLow.filter((p) => { const t = parseStationTime(p.time).getTime(); return t >= now.getTime() && t <= rangeEndMs; });
  const nextHigh = visibleHighLow.find((p) => p.type === "H"); const nextLow = visibleHighLow.find((p) => p.type === "L");
  const rising = (() => { if (hourly.length < 2) return null; const futureHourly = hourly.find((p) => parseStationTime(p.time).getTime() > now.getTime()); return futureHourly && currentHeight !== null ? futureHourly.valueFt >= currentHeight : null; })();
  const grouped = useMemo(() => { const map = new Map<string, TidePoint[]>(); visibleHighLow.forEach((p) => { const key = fmtDate(p.time); map.set(key, [...(map.get(key) || []), p]); }); return Array.from(map.entries()); }, [visibleHighLow]);
  const station = data?.station; const stationDistance = station?.distanceNm; const rangeLabel = RANGE_OPTIONS.find((o) => o.hours === rangeHours)?.label || `${rangeHours} HR`;

  const shell = dayMode ? "bg-[#edf3f7] text-[#122434]" : "bg-[#040d18] text-[#dbe5ee]";
  const panel = dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-[#0a1c2e]";
  const sub = dayMode ? "border-slate-300 bg-[#f5f7f9]" : "border-white/10 bg-[#050a0f]";
  const muted = dayMode ? "text-slate-600" : "text-[#7f9caf]";
  const control = dayMode ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-100" : "border-white/15 bg-[#101820] text-[#dbe5ee] hover:bg-[#182631]";

  return <main className={`navdash-tides-console min-h-screen ${shell}`}>
    <style jsx global>{`
      .navdash-tides-console header,.navdash-tides-console section,.navdash-tides-console aside{border-radius:14px!important;box-shadow:0 18px 55px var(--nd-shadow)!important}
      .navdash-tides-console button,.navdash-tides-console a,.navdash-tides-console input,.navdash-tides-console section section,.navdash-tides-console aside section{border-radius:7px!important}
      .navdash-tides-console button,.navdash-tides-console a,.navdash-tides-console input{box-shadow:none!important}
      .navdash-tides-console .tide-station-result{touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:pointer}
      @media print{body:has(.navdash-tides-console) .navdash-global-nav{display:none!important}.navdash-tides-console{background:#fff!important;color:#111!important}.no-print{display:none!important}.print-panel{background:#fff!important;color:#111!important;border-color:#aaa!important;box-shadow:none!important}.print-muted{color:#444!important}.print-break{break-inside:avoid}}
    `}</style>

    <div className="mx-auto min-h-screen max-w-[1800px] p-2 md:p-3">
      <header className={`print-panel mb-2 flex flex-wrap items-center gap-3 border px-3 py-2 ${panel}`}>
        <div className="grid h-9 w-9 place-items-center border border-[#f2b84b]/50 bg-[#f2b84b]/10 text-sm font-black text-[#f2b84b]">T</div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-[.22em] text-[#f2b84b]">M/V MB480 • TIDE CONSOLE</div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-black leading-none">Tides</h1>
            <span className={`text-[10px] font-bold uppercase tracking-[.12em] ${muted}`}>NOAA CO-OPS predictions • nearest usable station</span>
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-1.5">
          <Link href="/" className={`inline-flex h-8 items-center border px-3 text-[10px] font-black uppercase tracking-[.08em] ${control}`}>Nav Dash</Link>
          <button onClick={toggleTheme} className={`h-8 border px-3 text-[10px] font-black uppercase tracking-[.08em] ${control}`}>{dayMode ? "Bridge Night" : "Day Mode"}</button>
          <button onClick={() => window.print()} className="h-8 border border-[#f2b84b]/60 bg-[#f2b84b] px-3 text-[10px] font-black uppercase tracking-[.08em] text-[#111827]">Print</button>
        </div>
      </header>

      <section className={`print-panel mb-2 border p-2.5 ${panel}`}>
        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#f2b84b]">Selected Station</div>
            <div className="mt-1 text-base font-black">{station?.name || (loading ? "Finding nearest tide station..." : "Waiting for vessel position")}</div>
            <div className={`mt-1 font-mono text-[10px] ${muted}`}>{station ? `NOAA ${station.id}  |  ${data?.datum || "MLLW"}  |  ${timezoneLabel(station.timezoneCorr)}  |  ${stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM from vessel` : "distance unavailable"}` : "Nearest valid NOAA tide station will be selected automatically."}</div>
          </div>
          <div className="no-print relative flex items-end gap-1.5">
            <div className="relative min-w-0 flex-1">
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchStations(); if (e.key === "Escape") { setSearchResults([]); setSearch(""); } }} placeholder="Search NOAA station" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={searchResults.length > 0} className={`h-8 w-full border px-2 text-[11px] outline-none ${sub}`} />
              {(searchResults.length > 0 || (searchingStations && search.trim().length >= 2)) && <div className={`absolute left-0 right-0 top-full z-[100] max-h-72 overflow-y-auto border border-t-0 shadow-xl ${sub}`} role="listbox">
                {searchingStations && searchResults.length === 0 && <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[.08em] ${muted}`}>Searching NOAA stations…</div>}
                {searchResults.map((s) => <button key={s.id} type="button" role="option" onPointerDown={(e) => { e.preventDefault(); selectStation(s); }} className={`tide-station-result block min-h-12 w-full border-b p-2 text-left last:border-b-0 ${control}`} aria-label={`Select NOAA tide station ${s.name}`}><div className="pointer-events-none text-[11px] font-black">{s.name}</div><div className={`pointer-events-none mt-0.5 font-mono text-[9px] ${muted}`}>NOAA {s.id} • {s.distanceNm?.toFixed(1) ?? "--"} NM</div></button>)}
              </div>}
            </div>
            <button onClick={() => void searchStations()} disabled={!position || search.trim().length < 2} className={`h-8 border px-3 text-[10px] font-black uppercase ${control}`}>Search</button>
          </div>
        </div>

        <div className="no-print mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
          <span className={`mr-1 text-[9px] font-black uppercase tracking-[.16em] ${muted}`}>Time Range</span>
          {RANGE_OPTIONS.map((option) => <button key={option.hours} onClick={() => setRangeHours(option.hours)} className={`h-7 border px-3 text-[10px] font-black uppercase tracking-[.05em] ${rangeHours === option.hours ? "border-[#f2b84b] bg-[#f2b84b] text-[#111827]" : control}`}>{option.label}</button>)}
        </div>
      </section>

      {!position && <section className={`no-print mb-2 flex flex-wrap items-center gap-2 border p-2 ${panel}`}><span className="text-[10px] font-black uppercase tracking-[.1em] text-amber-400">AIS position not received</span><input value={manualLat} onChange={(e) => setManualLat(e.target.value)} className={`h-7 w-28 border px-2 font-mono text-[10px] ${sub}`} /><input value={manualLon} onChange={(e) => setManualLon(e.target.value)} className={`h-7 w-32 border px-2 font-mono text-[10px] ${sub}`} /><button onClick={() => { const lat = Number(manualLat), lon = Number(manualLon); if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setPosition({ lat, lon, updatedAt: Date.now() }); }} className={`h-7 border px-3 text-[10px] font-black uppercase ${control}`}>Use Position</button></section>}
      {error && <div className="mb-2 border border-red-500/40 bg-red-950/30 px-3 py-2 text-[11px] font-bold text-red-200">{error}</div>}

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className={`print-panel print-break border p-2.5 ${panel}`}>
          <div className="mb-1 flex items-end justify-between gap-3 border-b border-white/10 pb-2">
            <div>
              <div className={`text-[10px] font-black uppercase tracking-[.18em] ${rising === null ? muted : rising ? "text-[#56bad0]" : "text-[#f2b84b]"}`}>{rising === null ? "TIDE" : rising ? "FLOODING" : "EBBING"}</div>
              <div className="mt-0.5 font-mono text-4xl font-black leading-none text-[#56bad0]">{currentHeight === null ? "--" : currentHeight.toFixed(1)}<span className={`ml-1 text-sm ${muted}`}>ft</span></div>
              <div className={`mt-1 text-[9px] font-black uppercase tracking-[.16em] ${muted}`}>Predicted Height • {data?.datum || "MLLW"}</div>
            </div>
            <div className="text-right"><div className="font-mono text-2xl font-black text-[#f2b84b]">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</div><div className={`text-[9px] font-black uppercase tracking-[.14em] ${muted}`}>{rangeLabel} View</div></div>
          </div>
          <TideChart points={visibleHourly} now={now} dayMode={dayMode} />
        </section>

        <aside className="grid gap-2">
          <section className={`print-panel border p-2.5 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${muted}`}>Next High</div><div className="mt-1 font-mono text-2xl font-black">{nextHigh ? `${nextHigh.valueFt.toFixed(1)} ft` : "--"}</div><div className={`mt-1 text-[10px] font-bold ${muted}`}>{nextHigh ? `${fmtDate(nextHigh.time)} • ${fmtTime(nextHigh.time)}` : "No event in selected range"}</div></section>
          <section className={`print-panel border p-2.5 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${muted}`}>Next Low</div><div className="mt-1 font-mono text-2xl font-black">{nextLow ? `${nextLow.valueFt.toFixed(1)} ft` : "--"}</div><div className={`mt-1 text-[10px] font-bold ${muted}`}>{nextLow ? `${fmtDate(nextLow.time)} • ${fmtTime(nextLow.time)}` : "No event in selected range"}</div></section>
          <section className={`print-panel border p-2.5 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${muted}`}>Source</div><div className="mt-1 text-sm font-black text-[#f2b84b]">NOAA CO-OPS</div><div className={`mt-1 text-[10px] font-bold ${muted}`}>Official tide predictions • {data?.timeZone || "LST/LDT"}</div></section>
          <section className={`print-panel border p-2.5 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.18em] ${muted}`}>Station / Vessel</div><div className="mt-2 grid grid-cols-[88px_1fr] gap-y-1 font-mono text-[10px]"><span className={muted}>STATION</span><span className="text-right font-bold">{station?.id || "--"}</span><span className={muted}>DATUM</span><span className="text-right font-bold">{data?.datum || "MLLW"}</span><span className={muted}>TIME</span><span className="text-right font-bold">{timezoneLabel(station?.timezoneCorr)}</span><span className={muted}>TYPE</span><span className="text-right font-bold">{station?.type === "S" ? "SUBORDINATE" : station?.type === "R" ? "REFERENCE" : station?.type || "--"}</span><span className={muted}>DIST</span><span className="text-right font-bold">{stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM` : "--"}</span></div>{stationDistance !== undefined && stationDistance > 100 && <div className="mt-2 border border-amber-500/40 bg-amber-950/20 p-2 text-[9px] font-bold text-amber-300">STATION DISTANT FROM VESSEL. SELECT DESTINATION / PORT STATION FOR PLANNING.</div>}</section>
        </aside>
      </div>

      <section className={`print-panel print-break mt-2 border p-2.5 ${panel}`}>
        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5"><h2 className="text-sm font-black uppercase tracking-[.06em]">High / Low Predictions</h2><span className={`font-mono text-[10px] font-black ${muted}`}>{rangeLabel}</span></div>
        <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">{grouped.length ? grouped.map(([day, events]) => <div key={day} className={`border p-2 ${sub}`}><div className="mb-1.5 text-[10px] font-black uppercase tracking-[.08em] text-[#f2b84b]">{day}</div><div className="space-y-1">{events.map((event, idx) => <div key={`${event.time}-${idx}`} className="grid grid-cols-[42px_52px_1fr] items-center gap-2 font-mono text-[10px]"><span className={event.type === "H" ? "font-black text-[#56bad0]" : "font-black text-[#f2b84b]"}>{event.type === "H" ? "HIGH" : "LOW"}</span><span className="font-black">{fmtTime(event.time)}</span><span className={`text-right ${muted}`}>{event.valueFt.toFixed(1)} ft</span></div>)}</div></div>) : <div className={`text-[10px] font-bold ${muted}`}>No high/low events in the selected range.</div>}</div>
      </section>

      <footer className={`mt-2 border-t border-white/10 pt-2 text-center font-mono text-[9px] ${muted}`}>NOAA CO-OPS • DATUM {data?.datum || "MLLW"} • {timezoneLabel(station?.timezoneCorr)} • RANGE {rangeLabel} • GENERATED {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "--"}</footer>
    </div>
  </main>;
}
