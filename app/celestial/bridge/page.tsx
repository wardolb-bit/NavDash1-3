"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../../lib/aisWebSocket";
import { solveNavStars, type StarSolution } from "../../../lib/celestial";

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

function BridgeSky({ stars, center }: { stars: StarSolution[]; center: number }) {
  const w = 1200, h = 640, left = 64, right = 1136, top = 34, horizon = 515, maxAlt = 75;
  const shown = stars.map(s => ({ ...s, rel: signedRel(s.zn, center) })).filter(s => Math.abs(s.rel) <= 90 && s.hc >= 0 && s.hc <= maxAlt);
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" aria-label="Bridge window star view">
    <rect x={left} y={top} width={right - left} height={horizon - top} fill="#03070b" stroke="#20303d" />
    <rect x={left} y={horizon} width={right - left} height="76" fill="#050a0f" stroke="#20303d" />
    {[10, 20, 30, 45, 60].map(a => { const y = horizon - (a / maxAlt) * (horizon - top); return <g key={a}><line x1={left} x2={right} y1={y} y2={y} stroke="#15232e" strokeDasharray="5 8" /><text x={left + 10} y={y - 6} fill="#708496" fontSize="13" fontWeight="700">{a}°</text></g>; })}
    <line x1={left} x2={right} y1={horizon} y2={horizon} stroke="#c9a227" strokeWidth="2.5" />
    <text x={left + 10} y={horizon + 22} fill="#e7c95c" fontSize="13" fontWeight="900">HORIZON 0°</text>
    {[-90, -45, 0, 45, 90].map(r => { const x = left + ((r + 90) / 180) * (right - left); return <g key={r}><line x1={x} x2={x} y1={top} y2={horizon} stroke={r === 0 ? "#536a7c" : "#13202a"} strokeDasharray={r === 0 ? "" : "4 8"} /><text x={x} y={618} textAnchor="middle" fill={r === 0 ? "#e7c95c" : "#8294a5"} fontSize="13" fontWeight="900">{r === 0 ? "LOOK" : r < 0 ? `P ${Math.abs(r)}°` : `S ${r}°`}</text></g>; })}
    {shown.map(s => { const x = left + ((s.rel + 90) / 180) * (right - left); const y = horizon - (s.hc / maxAlt) * (horizon - top); const bright = s.mag <= 1.5; return <g key={s.name}><circle cx={x} cy={y} r={bright ? 5 : 3.5} fill={bright ? "#e7c95c" : "#dca0a8"} /><text x={x + 8} y={y - 8} fill={bright ? "#f1df8a" : "#e3b3ba"} fontSize="12" fontWeight="900">{s.name}</text><text x={x + 8} y={y + 8} fill="#708496" fontSize="10">Hc {s.hc.toFixed(0)}°  Zn {s.zn.toFixed(0)}°T</text></g>; })}
  </svg>;
}

function Horizon360({ stars }: { stars: StarSolution[] }) {
  const size = 680, c = size / 2, radius = 296;
  const shown = stars.filter(s => s.hc >= 0 && s.hc <= 90);
  return <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-full max-h-[680px] w-full max-w-[680px]" aria-label="360 degree navigational star horizon plot">
    <circle cx={c} cy={c} r={radius} fill="#03070b" stroke="#536a7c" strokeWidth="2" />
    {[10, 20, 30, 45, 60].map(alt => { const r = ((90 - alt) / 90) * radius; return <g key={alt}><circle cx={c} cy={c} r={r} fill="none" stroke="#20303d" strokeDasharray="5 7" /><text x={c + 6} y={c - r - 5} fill="#708496" fontSize="12">{alt}°</text></g>; })}
    {[0, 90, 180, 270].map(az => { const a = az * Math.PI / 180; return <line key={az} x1={c} y1={c} x2={c + radius * Math.sin(a)} y2={c - radius * Math.cos(a)} stroke="#20303d" />; })}
    <text x={c} y="25" textAnchor="middle" fill="#e7c95c" fontWeight="900">N 000°</text><text x={size - 10} y={c + 5} textAnchor="end" fill="#e7c95c" fontWeight="900">E 090°</text><text x={c} y={size - 10} textAnchor="middle" fill="#e7c95c" fontWeight="900">S 180°</text><text x="10" y={c + 5} fill="#e7c95c" fontWeight="900">W 270°</text>
    {shown.map(s => { const r = ((90 - s.hc) / 90) * radius; const a = s.zn * Math.PI / 180; const x = c + r * Math.sin(a), y = c - r * Math.cos(a); const bright = s.mag <= 1.5; return <g key={s.name}><circle cx={x} cy={y} r={bright ? 5 : 3.5} fill={bright ? "#e7c95c" : "#dca0a8"} /><text x={x + 8} y={y - 7} fill={bright ? "#f1df8a" : "#e3b3ba"} fontSize="12" fontWeight="900">{s.name}</text></g>; })}
  </svg>;
}

export default function BridgeCelestial() {
  const [nav, setNav] = useState<NavState>({ lat: 13.4443, lon: 144.7937, heading: null, cog: null });
  const [mode, setMode] = useState<ViewMode>("ahead");
  const [status, setStatus] = useState("CONNECTING");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const globalNav = document.querySelector<HTMLElement>("body > nav");
    const prior = globalNav?.style.display;
    if (globalNav) globalNav.style.setProperty("display", "none", "important");
    return () => { if (globalNav) globalNav.style.display = prior || ""; };
  }, []);

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    let ws: WebSocket | null = null, retry: number | undefined, done = false;
    const connect = () => {
      try {
        ws = new WebSocket(getAisWebSocketUrl());
        ws.onopen = () => setStatus("AIS LIVE");
        ws.onerror = () => setStatus("AIS OFFLINE");
        ws.onclose = () => { setStatus("AIS OFFLINE"); if (!done) retry = window.setTimeout(connect, 3000); };
        ws.onmessage = e => { try { const m = JSON.parse(String(e.data)); if (m?.type !== "nmea" || typeof m.line !== "string") return; const d = decode(m.line); if (d) setNav(v => ({ ...v, ...d })); } catch {} };
      } catch { setStatus("AIS OFFLINE"); }
    };
    connect();
    return () => { done = true; if (retry) clearTimeout(retry); ws?.close(); };
  }, []);

  const base = nav.heading ?? nav.cog ?? 0;
  const offset = mode === "port" ? -90 : mode === "starboard" ? 90 : mode === "astern" ? 180 : 0;
  const center = norm(base + offset);
  const stars = useMemo(() => solveNavStars(nav.lat, nav.lon, now), [nav.lat, nav.lon, now]);
  const modes: { id: ViewMode; label: string }[] = [
    { id: "port", label: "PORT" }, { id: "ahead", label: "AHEAD" }, { id: "starboard", label: "STARBOARD" }, { id: "astern", label: "ASTERN" }, { id: "360", label: "360°" },
  ];

  return (
    <main className="min-h-screen bg-[#04080c] p-[6px] font-sans text-[#dbe5ee]">
      <div className="grid h-[46px] grid-cols-[260px_1fr_180px] items-center border border-[#c9a227]/30 bg-[#071019] px-3 text-[11px] font-bold tracking-[0.08em]">
        <div className="flex items-center gap-2.5"><span className="grid h-7 w-7 place-items-center border border-[#c9a227] text-[15px] font-black text-[#e7c95c]">N</span><span className="flex flex-col leading-none"><b>NAVDASH</b><small className="mt-1 text-[8px] tracking-[0.14em] text-[#8294a5]">M/V MB480 · CELESTIAL CONSOLE</small></span></div>
        <div className="flex justify-center gap-2"><span className="border border-slate-400/20 bg-[#050a0f] px-2.5 py-1.5 text-[9px] text-[#aebdca]"><i className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${status === "AIS LIVE" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.55)]" : "bg-amber-400"}`} />{status}</span><span className="border border-slate-400/20 bg-[#050a0f] px-2.5 py-1.5 text-[9px] text-[#aebdca]">HDG {nav.heading?.toFixed(0) ?? "--"}°</span><span className="border border-slate-400/20 bg-[#050a0f] px-2.5 py-1.5 text-[9px] text-[#aebdca]">COG {nav.cog?.toFixed(0) ?? "--"}°</span></div>
        <div className="text-right text-[9px] tracking-[0.16em] text-[#e7c95c]">{now.toISOString().slice(11, 19)} UTC</div>
      </div>

      <div className="mt-[5px] flex h-[40px] items-center justify-between border border-slate-400/15 bg-[#071019] px-1.5">
        <div className="flex gap-1">
          {modes.map(v => <button key={v.id} onClick={() => setMode(v.id)} className={`h-[30px] min-w-[108px] border px-2 text-[10px] font-black tracking-[0.08em] ${mode === v.id ? "border-[#c9a227]/60 bg-[#c9a227]/15 text-[#e7c95c]" : "border-slate-400/25 bg-[#071019] text-[#c7d2dc] hover:border-slate-300/40"}`}>{v.label}</button>)}
        </div>
        <Link href="/" className="grid h-[30px] min-w-[108px] place-items-center border border-slate-400/25 bg-[#071019] px-2 text-[10px] font-black tracking-[0.08em] text-[#c7d2dc] hover:border-[#c9a227]/60 hover:text-[#e7c95c]">MAIN CONSOLE</Link>
      </div>

      <div className="mt-[5px] grid min-h-[calc(100vh-102px)] grid-cols-[minmax(0,1fr)_330px] gap-[5px]">
        <section className="flex min-h-[650px] flex-col border border-slate-400/15 bg-[#071019]">
          <div className="flex h-[38px] items-center justify-between border-b border-slate-400/15 px-3"><span className="text-[9px] font-black tracking-[0.16em] text-[#c9a227]">CELESTIAL DISPLAY</span><strong className="text-[11px] text-[#e7c95c]">{mode === "360" ? "360° TRUE HORIZON" : `${mode.toUpperCase()} · ${center.toFixed(0)}°T`}</strong></div>
          <div className="min-h-0 flex-1 p-2">{mode === "360" ? <Horizon360 stars={stars} /> : <BridgeSky stars={stars} center={center} />}</div>
        </section>

        <aside className="flex min-h-[650px] flex-col border border-slate-400/15 bg-[#071019]">
          <div className="border-b border-slate-400/15 p-3"><span className="block text-[8px] font-black tracking-[0.16em] text-[#c9a227]">STAR FINDER</span><b className="mt-2 block text-[16px] leading-none text-[#e7c95c]">{mode === "360" ? "TRUE HORIZON" : `${mode.toUpperCase()} VIEW`}</b><small className="mt-1.5 block text-[10px] text-[#9aabba]">Navigational stars only</small></div>
          <div className="border-b border-slate-400/15 p-3"><label className="mb-1 block text-[8px] font-black tracking-[0.16em] text-[#708496]">OWN SHIP</label><strong className="block text-[20px] font-extrabold leading-tight text-[#42d3c8]">{Math.abs(nav.lat).toFixed(4)}° {nav.lat >= 0 ? "N" : "S"}</strong><strong className="block text-[20px] font-extrabold leading-tight text-[#42d3c8]">{Math.abs(nav.lon).toFixed(4)}° {nav.lon >= 0 ? "E" : "W"}</strong></div>
          <div className="grid grid-cols-2 border-b border-slate-400/15">
            <div className="min-h-[86px] border-b border-r border-slate-400/15 p-3"><label className="mb-1 block text-[8px] font-black tracking-[0.16em] text-[#708496]">LOOKING</label><strong className="text-[28px] font-extrabold leading-none text-[#edf4fa]">{mode === "360" ? "360°" : `${center.toFixed(0)}°`}</strong></div>
            <div className="min-h-[86px] border-b border-slate-400/15 p-3"><label className="mb-1 block text-[8px] font-black tracking-[0.16em] text-[#708496]">REFERENCE</label><strong className="text-[20px] font-extrabold leading-none text-[#edf4fa]">{nav.heading !== null ? "HDG" : nav.cog !== null ? "COG" : "NORTH"}</strong></div>
            <div className="min-h-[86px] border-r border-slate-400/15 p-3"><label className="mb-1 block text-[8px] font-black tracking-[0.16em] text-[#708496]">HEADING</label><strong className="text-[28px] font-extrabold leading-none text-[#edf4fa]">{nav.heading?.toFixed(0) ?? "--"}°</strong></div>
            <div className="min-h-[86px] p-3"><label className="mb-1 block text-[8px] font-black tracking-[0.16em] text-[#708496]">COG</label><strong className="text-[28px] font-extrabold leading-none text-[#edf4fa]">{nav.cog?.toFixed(0) ?? "--"}°</strong></div>
          </div>
          <div className="p-3"><label className="mb-2 block text-[8px] font-black tracking-[0.16em] text-[#708496]">DISPLAY REFERENCE</label><p className="text-[10px] leading-5 text-[#aab8c4]">Bridge views use true heading when available and COG as fallback. Port, ahead, starboard, and astern are ship-relative. The 360° display is north-up.</p></div>
          <div className="mt-auto border-t border-amber-300/20 bg-amber-400/[0.06] p-3 text-[9px] leading-4 text-[#d2c58c]">IDENTIFICATION / PLANNING ONLY · Use current Nautical Almanac data and normal celestial-navigation procedures for sights and reductions.</div>
        </aside>
      </div>
    </main>
  );
}
