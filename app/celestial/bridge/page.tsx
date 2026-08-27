"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../../lib/aisWebSocket";
import { solveNavStars, type StarSolution } from "../../../lib/celestial";
import { useBridgeTheme } from "../../../lib/useBridgeTheme";

type ViewMode = "ahead" | "port" | "starboard" | "astern" | "360";
type NavState = { lat: number; lon: number; heading: number | null; cog: number | null };

const norm = (v: number) => ((v % 360) + 360) % 360;
const signedRel = (az: number, center: number) => ((az - center + 540) % 360) - 180;

function six(c: string) { const n = c.charCodeAt(0); return n < 88 ? n - 48 : n - 56; }
function bits(p: string) { return p.split("").map(c => six(c).toString(2).padStart(6, "0")).join(""); }
function u(b: string, s: number, l: number) { return parseInt(b.slice(s, s + l), 2); }
function si(b: string, s: number, l: number) { const v = u(b, s, l), t = 2 ** (l - 1); return v >= t ? v - 2 ** l : v; }

function decode(line: string): Partial<NavState> | null {
  const p = line.trim().split(","), t = (p[0] || "").replace(/^[$!]/, "");
  if ((t === "AIVDO" || t === "ABVDO") && p[1] === "1" && p[2] === "1") {
    try {
      const raw = bits(p[5]);
      const fill = Number((p[6] || "0").split("*")[0]);
      const b = fill ? raw.slice(0, -fill) : raw;
      if (![1, 2, 3].includes(u(b, 0, 6))) return null;
      const lon = si(b, 61, 28) / 600000;
      const lat = si(b, 89, 27) / 600000;
      const cogRaw = u(b, 116, 12), hdgRaw = u(b, 128, 9);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return { lat, lon, cog: cogRaw === 3600 ? null : cogRaw / 10, heading: hdgRaw === 511 ? null : hdgRaw };
    } catch { return null; }
  }
  if (/..HDT$/.test(t)) { const h = Number(p[1]); return Number.isFinite(h) ? { heading: norm(h) } : null; }
  if (/..RMC$/.test(t) && p[2] === "A") { const c = Number(p[8]); return Number.isFinite(c) ? { cog: norm(c) } : null; }
  return null;
}

function BridgeSky({ stars, center, dayMode }: { stars: StarSolution[]; center: number; dayMode: boolean }) {
  const w = 1000, h = 560, left = 55, right = 945, top = 35, horizon = 455, maxAlt = 75;
  const shown = stars.map(s => ({ ...s, rel: signedRel(s.zn, center) })).filter(s => Math.abs(s.rel) <= 90 && s.hc >= 0 && s.hc <= maxAlt);
  const sky = dayMode ? "#f8fafc" : "#020508";
  const lower = dayMode ? "#e2e8f0" : "#07090b";
  const grid = dayMode ? "#cbd5e1" : "#18222d";
  const minor = dayMode ? "#dbe3ec" : "#16202a";
  const text = dayMode ? "#475569" : "#64748b";
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-label="Bridge window star view">
    <rect x={left} y={top} width={right - left} height={horizon - top} fill={sky} stroke={dayMode ? "#94a3b8" : "#334155"} />
    <rect x={left} y={horizon} width={right - left} height="65" fill={lower} stroke={dayMode ? "#94a3b8" : "#334155"} />
    {[10, 20, 30, 45, 60].map(a => { const y = horizon - (a / maxAlt) * (horizon - top); return <g key={a}><line x1={left} x2={right} y1={y} y2={y} stroke={grid} strokeDasharray="5 7" /><text x={left + 8} y={y - 5} fill={text} fontSize="13">{a}°</text></g>; })}
    <line x1={left} x2={right} y1={horizon} y2={horizon} stroke="#c9a227" strokeWidth="3" />
    <text x={left + 8} y={horizon + 20} fill="#c9a227" fontSize="13" fontWeight="800">HORIZON 0°</text>
    {[-90, -45, 0, 45, 90].map(r => { const x = left + ((r + 90) / 180) * (right - left); return <g key={r}><line x1={x} x2={x} y1={top} y2={horizon} stroke={r === 0 ? (dayMode ? "#64748b" : "#64748b") : minor} strokeDasharray={r === 0 ? "" : "4 8"} /><text x={x} y={542} textAnchor="middle" fill={r === 0 ? "#c9a227" : text} fontSize="14" fontWeight="800">{r === 0 ? "LOOK" : r < 0 ? `P ${Math.abs(r)}°` : `S ${r}°`}</text></g>; })}
    {shown.map(s => { const x = left + ((s.rel + 90) / 180) * (right - left); const y = horizon - (s.hc / maxAlt) * (horizon - top); const bright = s.mag <= 1.5; return <g key={s.name}><circle cx={x} cy={y} r={bright ? 5 : 3.5} fill={bright ? "#c9a227" : dayMode ? "#be123c" : "#fca5a5"} /><text x={x + 8} y={y - 8} fill={bright ? (dayMode ? "#8a6b00" : "#fde68a") : dayMode ? "#9f1239" : "#fecaca"} fontSize="13" fontWeight="800">{s.name}</text><text x={x + 8} y={y + 8} fill={text} fontSize="10">Hc {s.hc.toFixed(0)}° · Zn {s.zn.toFixed(0)}°T</text></g>; })}
  </svg>;
}

function Horizon360({ stars, dayMode }: { stars: StarSolution[]; dayMode: boolean }) {
  const size = 680, c = size / 2, radius = 296;
  const shown = stars.filter(s => s.hc >= 0 && s.hc <= 90);
  return <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[720px]" aria-label="360 degree navigational star horizon plot">
    <circle cx={c} cy={c} r={radius} fill={dayMode ? "#f8fafc" : "#020508"} stroke={dayMode ? "#94a3b8" : "#64748b"} strokeWidth="2" />
    {[10, 20, 30, 45, 60].map(alt => { const r = ((90 - alt) / 90) * radius; return <g key={alt}><circle cx={c} cy={c} r={r} fill="none" stroke={dayMode ? "#cbd5e1" : "#253342"} strokeDasharray="5 7" /><text x={c + 6} y={c - r - 5} fill={dayMode ? "#64748b" : "#64748b"} fontSize="12">{alt}°</text></g>; })}
    {[0, 90, 180, 270].map(az => { const a = az * Math.PI / 180; return <line key={az} x1={c} y1={c} x2={c + radius * Math.sin(a)} y2={c - radius * Math.cos(a)} stroke={dayMode ? "#cbd5e1" : "#263442"} />; })}
    <text x={c} y="25" textAnchor="middle" fill="#c9a227" fontWeight="800">N 000°</text><text x={size - 10} y={c + 5} textAnchor="end" fill="#c9a227" fontWeight="800">E 090°</text><text x={c} y={size - 10} textAnchor="middle" fill="#c9a227" fontWeight="800">S 180°</text><text x="10" y={c + 5} fill="#c9a227" fontWeight="800">W 270°</text>
    {shown.map(s => { const r = ((90 - s.hc) / 90) * radius; const a = s.zn * Math.PI / 180; const x = c + r * Math.sin(a), y = c - r * Math.cos(a); const bright = s.mag <= 1.5; return <g key={s.name}><circle cx={x} cy={y} r={bright ? 5 : 3.5} fill={bright ? "#c9a227" : dayMode ? "#be123c" : "#fca5a5"} /><text x={x + 8} y={y - 7} fill={bright ? (dayMode ? "#8a6b00" : "#fde68a") : dayMode ? "#9f1239" : "#fecaca"} fontSize="12" fontWeight="800">{s.name}</text></g>; })}
  </svg>;
}

export default function BridgeCelestial() {
  const { dayMode, toggleTheme } = useBridgeTheme();
  const [nav, setNav] = useState<NavState>({ lat: 13.4443, lon: 144.7937, heading: null, cog: null });
  const [mode, setMode] = useState<ViewMode>("ahead");
  const [status, setStatus] = useState("Connecting AIS…");
  const [now, setNow] = useState(new Date());

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id); }, []);
  useEffect(() => {
    let ws: WebSocket | null = null, retry: number | undefined, done = false;
    const connect = () => {
      try {
        ws = new WebSocket(getAisWebSocketUrl());
        ws.onopen = () => setStatus("AIS link connected");
        ws.onerror = () => setStatus("AIS link unavailable");
        ws.onclose = () => { setStatus("AIS link unavailable"); if (!done) retry = window.setTimeout(connect, 3000); };
        ws.onmessage = e => { try { const m = JSON.parse(String(e.data)); if (m?.type !== "nmea" || typeof m.line !== "string") return; const d = decode(m.line); if (d) setNav(v => ({ ...v, ...d })); } catch {} };
      } catch { setStatus("AIS link unavailable"); }
    };
    connect();
    return () => { done = true; if (retry) clearTimeout(retry); ws?.close(); };
  }, []);

  const base = nav.heading ?? nav.cog ?? 0;
  const offset = mode === "port" ? -90 : mode === "starboard" ? 90 : mode === "astern" ? 180 : 0;
  const center = norm(base + offset);
  const stars = useMemo(() => solveNavStars(nav.lat, nav.lon, now), [nav.lat, nav.lon, now]);
  const labels: { id: ViewMode; label: string }[] = [
    { id: "port", label: "PORT" },
    { id: "ahead", label: "AHEAD" },
    { id: "starboard", label: "STARBOARD" },
    { id: "astern", label: "ASTERN" },
    { id: "360", label: "360°" },
  ];

  const pageClass = dayMode ? "min-h-screen bg-white text-slate-950" : "min-h-screen bg-[#071019] text-slate-100";
  const panelClass = dayMode
    ? "rounded-[2rem] border border-slate-300 bg-white p-5 shadow-xl shadow-slate-900/10"
    : "rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl";
  const softPanelClass = dayMode
    ? "rounded-3xl border border-slate-300 bg-slate-50 p-4"
    : "rounded-3xl border border-white/10 bg-black/25 p-4";
  const buttonOff = dayMode
    ? "rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 hover:bg-slate-50"
    : "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-slate-100 hover:bg-white/15";

  return (
    <main className={`${pageClass} navdash-readable-font relative overflow-hidden`}>
      <div className={dayMode ? "absolute inset-0 bg-white" : "absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(201,162,39,.28),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.12),transparent_28%),linear-gradient(135deg,#071019,#101c2b_48%,#071019)]"} />

      <div className={`relative z-10 min-h-screen p-4 2xl:p-6 ${dayMode ? "navdash-v12-day" : "navdash-v12-night"}`}>
        <div className="mx-auto max-w-[1500px] space-y-5">
          <header className={panelClass}>
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-4">
                <div className="grid h-16 w-16 place-items-center rounded-3xl border border-[#c9a227]/45 bg-[#c9a227]/15 text-3xl font-black text-[#c9a227]">✦</div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.42em] text-[#c9a227]">M/V MB480 · Celestial</div>
                  <h1 className={dayMode ? "text-4xl font-black tracking-tight text-slate-950 2xl:text-5xl" : "text-4xl font-black tracking-tight text-white 2xl:text-5xl"}>Star Finder</h1>
                  <div className={dayMode ? "mt-1 text-sm text-slate-700" : "mt-1 text-sm text-slate-300"}>Bridge-oriented celestial identification and sight planning</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <div className={softPanelClass}>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">UTC</div>
                  <div className="mt-1 text-lg font-black text-[#c9a227]">{now.toISOString().slice(11, 19)}</div>
                </div>
                <div className={softPanelClass}>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Feed</div>
                  <div className={`mt-1 text-sm font-black ${status.includes("connected") ? "text-emerald-400" : "text-amber-400"}`}>{status}</div>
                </div>
                <Link href="/" className={buttonOff}>Main Console</Link>
                <button onClick={toggleTheme} className={buttonOff}>{dayMode ? "Bridge Night" : "Day Mode"}</button>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {labels.map(v => (
              <button
                key={v.id}
                onClick={() => setMode(v.id)}
                className={mode === v.id ? "rounded-2xl border border-[#c9a227]/50 bg-[#c9a227] px-4 py-3 text-sm font-black tracking-wider text-[#111827] shadow-lg shadow-[#c9a227]/20" : buttonOff}
              >
                {v.label}
              </button>
            ))}
          </div>

          <section className={panelClass}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Celestial Display</div>
                <h2 className={dayMode ? "mt-1 text-3xl font-black text-slate-950" : "mt-1 text-3xl font-black text-white"}>{mode === "360" ? "360° Horizon Plot" : `${mode.toUpperCase()} Bridge View`}</h2>
              </div>
              <div className="text-sm font-black text-[#c9a227]">{mode === "360" ? "North-up true reference" : `Looking ${center.toFixed(0)}° T`}</div>
            </div>
            <div className={dayMode ? "overflow-hidden rounded-[1.6rem] border border-slate-300 bg-slate-50 p-3" : "overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/30 p-3"}>
              {mode === "360" ? <Horizon360 stars={stars} dayMode={dayMode} /> : <BridgeSky stars={stars} center={center} dayMode={dayMode} />}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className={softPanelClass}><div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">View</div><div className="mt-2 text-2xl font-black text-[#c9a227]">{mode === "360" ? "360° TRUE" : `${center.toFixed(0)}° T`}</div></div>
            <div className={softPanelClass}><div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Reference</div><div className={dayMode ? "mt-2 text-2xl font-black text-slate-950" : "mt-2 text-2xl font-black text-white"}>{nav.heading !== null ? "HEADING" : nav.cog !== null ? "COG" : "NORTH"}</div></div>
            <div className={softPanelClass}><div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Ship HDG / COG</div><div className={dayMode ? "mt-2 text-2xl font-black text-slate-950" : "mt-2 text-2xl font-black text-white"}>{nav.heading?.toFixed(0) ?? "--"}° / {nav.cog?.toFixed(0) ?? "--"}°</div></div>
            <div className={softPanelClass}><div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Position</div><div className={dayMode ? "mt-2 text-lg font-black text-slate-950" : "mt-2 text-lg font-black text-white"}>{nav.lat.toFixed(4)}° / {nav.lon.toFixed(4)}°</div></div>
          </section>

          <div className={dayMode ? "rounded-3xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" : "rounded-3xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100"}>
            <span className="font-black">Celestial note:</span> Bridge View uses true heading when available and COG as fallback. The 360° view is north-up. Use current Nautical Almanac data and normal celestial-navigation procedures for sights and reductions.
          </div>
        </div>
      </div>
    </main>
  );
}
