"use client";

import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import {
  formatLatitude,
  formatLongitude,
  ghaAries,
  solveNavStars,
  type StarSolution,
} from "../../lib/celestial";

type Position = {
  lat: number;
  lon: number;
  source: string;
  receivedAt: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNmeaCoord(raw: string, hemi: string, isLon = false) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const degreeDigits = isLon ? 3 : 2;
  const text = raw.padStart(degreeDigits + 3, "0");
  const degrees = Number(text.slice(0, degreeDigits));
  const minutes = Number(text.slice(degreeDigits));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;
  const decimal = degrees + minutes / 60;
  return /[SW]/i.test(hemi) ? -decimal : decimal;
}

function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const value = unsigned(bits, start, length);
  const threshold = 2 ** (length - 1);
  return value >= threshold ? value - 2 ** length : value;
}

function parsePositionFromNmea(line: string): Position | null {
  const clean = line.trim();
  const parts = clean.split(",");
  const type = parts[0]?.replace(/^[$!]/, "") ?? "";

  if (/..RMC$/.test(type) && parts[2] === "A") {
    const lat = parseNmeaCoord(parts[3], parts[4], false);
    const lon = parseNmeaCoord(parts[5], parts[6], true);
    if (lat !== null && lon !== null) {
      return { lat, lon, source: "GPS RMC", receivedAt: new Date().toISOString() };
    }
  }

  if (/..GGA$/.test(type) && Number(parts[6]) > 0) {
    const lat = parseNmeaCoord(parts[2], parts[3], false);
    const lon = parseNmeaCoord(parts[4], parts[5], true);
    if (lat !== null && lon !== null) {
      return { lat, lon, source: "GPS GGA", receivedAt: new Date().toISOString() };
    }
  }

  if ((type === "AIVDO" || type === "ABVDO") && parts[1] === "1" && parts[2] === "1") {
    try {
      const payload = parts[5];
      const fillBits = Number((parts[6] || "0").split("*")[0] || 0);
      if (!payload) return null;
      const raw = payloadToBits(payload);
      const bits = fillBits > 0 ? raw.slice(0, -fillBits) : raw;
      const messageType = unsigned(bits, 0, 6);
      if (![1, 2, 3].includes(messageType)) return null;
      const lon = signed(bits, 61, 28) / 600000;
      const lat = signed(bits, 89, 27) / 600000;
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon, source: "AIS own ship", receivedAt: new Date().toISOString() };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function utcInputValue(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}T${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
}

function fromUtcInput(value: string) {
  const parsed = new Date(`${value}:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function StarPlot({ stars }: { stars: StarSolution[] }) {
  const size = 640;
  const c = size / 2;
  const radius = 286;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[680px]" role="img" aria-label="Navigational star horizon plot">
      <circle cx={c} cy={c} r={radius} fill="#03060a" stroke="#64748b" strokeWidth="2" />
      {[30, 60].map((alt) => {
        const r = ((90 - alt) / 90) * radius;
        return <circle key={alt} cx={c} cy={c} r={r} fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="5 6" />;
      })}
      {[0, 90, 180, 270].map((az) => {
        const a = (az * Math.PI) / 180;
        const x = c + radius * Math.sin(a);
        const y = c - radius * Math.cos(a);
        return <line key={az} x1={c} y1={c} x2={x} y2={y} stroke="#1e293b" strokeWidth="1" />;
      })}
      <text x={c} y={20} textAnchor="middle" fill="#94a3b8" fontSize="16" fontWeight="800">N 000°</text>
      <text x={size - 9} y={c + 5} textAnchor="end" fill="#94a3b8" fontSize="16" fontWeight="800">E 090°</text>
      <text x={c} y={size - 8} textAnchor="middle" fill="#94a3b8" fontSize="16" fontWeight="800">S 180°</text>
      <text x={9} y={c + 5} fill="#94a3b8" fontSize="16" fontWeight="800">W 270°</text>
      <text x={c + 5} y={c - ((90 - 60) / 90) * radius - 6} fill="#475569" fontSize="12">60°</text>
      <text x={c + 5} y={c - ((90 - 30) / 90) * radius - 6} fill="#475569" fontSize="12">30°</text>

      {stars.map((star) => {
        const r = ((90 - clamp(star.hc, 0, 90)) / 90) * radius;
        const a = (star.zn * Math.PI) / 180;
        const x = c + r * Math.sin(a);
        const y = c - r * Math.cos(a);
        const bright = star.mag <= 1.5;
        return (
          <g key={star.name}>
            <circle cx={x} cy={y} r={bright ? 5 : 3.5} fill={bright ? "#fbbf24" : "#fca5a5"} />
            <text x={x + 8} y={y - 7} fill={bright ? "#fde68a" : "#fecaca"} fontSize="12" fontWeight="800">
              {star.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function CelestialPage() {
  const [position, setPosition] = useState<Position>({
    lat: 13.4443,
    lon: 144.7937,
    source: "Manual / fallback",
    receivedAt: "",
  });
  const [latText, setLatText] = useState("13.4443");
  const [lonText, setLonText] = useState("144.7937");
  const [utcText, setUtcText] = useState(() => utcInputValue(new Date()));
  const [liveTime, setLiveTime] = useState(true);
  const [wsStatus, setWsStatus] = useState("Connecting AIS…");
  const [minAlt, setMinAlt] = useState(10);
  const [maxAlt, setMaxAlt] = useState(75);

  useEffect(() => {
    if (!liveTime) return;
    const update = () => setUtcText(utcInputValue(new Date()));
    update();
    const timer = window.setInterval(update, 15000);
    return () => window.clearInterval(timer);
  }, [liveTime]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: number | null = null;
    let closed = false;

    const connect = () => {
      try {
        ws = new WebSocket(getAisWebSocketUrl());
        ws.onopen = () => setWsStatus("AIS link connected");
        ws.onclose = () => {
          setWsStatus("AIS link unavailable");
          if (!closed) reconnect = window.setTimeout(connect, 3000);
        };
        ws.onerror = () => setWsStatus("AIS link unavailable");
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data));
            if (payload?.type !== "nmea" || typeof payload?.line !== "string") return;
            const next = parsePositionFromNmea(payload.line);
            if (!next) return;
            setPosition(next);
            setLatText(next.lat.toFixed(6));
            setLonText(next.lon.toFixed(6));
          } catch {
            // Keep the finder operating with the last good/manual position.
          }
        };
      } catch {
        setWsStatus("AIS link unavailable");
      }
    };

    connect();
    return () => {
      closed = true;
      if (reconnect) window.clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

  const date = useMemo(() => fromUtcInput(utcText), [utcText]);
  const solutions = useMemo(
    () => solveNavStars(position.lat, position.lon, date),
    [position.lat, position.lon, date],
  );

  const visible = useMemo(
    () => solutions.filter((star) => star.hc >= minAlt && star.hc <= maxAlt).sort((a, b) => a.zn - b.zn),
    [solutions, minAlt, maxAlt],
  );

  const best = useMemo(() => {
    const candidates = solutions
      .filter((star) => star.no !== "P" && star.hc >= 20 && star.hc <= 65)
      .sort((a, b) => (a.mag + Math.abs(a.hc - 42) / 20) - (b.mag + Math.abs(b.hc - 42) / 20));

    const picked: StarSolution[] = [];
    for (const candidate of candidates) {
      if (picked.every((star) => {
        const diff = Math.abs(candidate.zn - star.zn);
        return Math.min(diff, 360 - diff) >= 55;
      })) picked.push(candidate);
      if (picked.length === 3) break;
    }
    return picked;
  }, [solutions]);

  const applyManualPosition = () => {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setPosition({
      lat: clamp(lat, -90, 90),
      lon: clamp(lon, -180, 180),
      source: "Manual",
      receivedAt: new Date().toISOString(),
    });
  };

  return (
    <main className="min-h-screen bg-[#05080c] px-4 py-5 text-slate-100 lg:px-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="border border-slate-700 bg-[#0a1119] p-4 shadow-xl shadow-black/20">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.25em] text-[#c9a227]">NavDash Celestial</div>
              <h1 className="mt-1 text-3xl font-black uppercase tracking-tight text-slate-100">Navigational Star Finder</h1>
              <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-400">
                Offline horizon plot for the 57 Nautical Almanac navigational stars plus Polaris. Designed for identification and sight planning.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-bold uppercase sm:grid-cols-4">
              <div className="border border-slate-700 bg-slate-950 px-3 py-2"><span className="block text-slate-500">Visible</span><span className="text-lg text-[#fbbf24]">{visible.length}</span></div>
              <div className="border border-slate-700 bg-slate-950 px-3 py-2"><span className="block text-slate-500">GHA Aries</span><span className="text-lg text-slate-100">{ghaAries(date).toFixed(1)}°</span></div>
              <div className="border border-slate-700 bg-slate-950 px-3 py-2"><span className="block text-slate-500">UTC</span><span className="text-lg text-slate-100">{date.toISOString().slice(11, 16)}</span></div>
              <div className="border border-slate-700 bg-slate-950 px-3 py-2"><span className="block text-slate-500">Position</span><span className="text-sm text-emerald-300">{position.source}</span></div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(390px,.65fr)]">
          <div className="border border-slate-700 bg-[#070c12] p-3">
            <StarPlot stars={visible} />
          </div>

          <div className="space-y-4">
            <div className="border border-slate-700 bg-[#0a1119] p-4">
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#c9a227]">Observer</h2>
              <div className="mt-3 space-y-2 text-sm font-bold">
                <div className="text-slate-200">{formatLatitude(position.lat)}</div>
                <div className="text-slate-200">{formatLongitude(position.lon)}</div>
                <div className="text-xs uppercase text-slate-500">{wsStatus}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="text-xs font-black uppercase text-slate-500">Latitude
                  <input value={latText} onChange={(e) => setLatText(e.target.value)} className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-[#c9a227]" />
                </label>
                <label className="text-xs font-black uppercase text-slate-500">Longitude
                  <input value={lonText} onChange={(e) => setLonText(e.target.value)} className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-[#c9a227]" />
                </label>
              </div>
              <button onClick={applyManualPosition} className="mt-2 w-full border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-black uppercase text-slate-100 hover:border-[#c9a227]">Use Manual Position</button>
            </div>

            <div className="border border-slate-700 bg-[#0a1119] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#c9a227]">Planning Time</h2>
                <button onClick={() => { setLiveTime(true); setUtcText(utcInputValue(new Date())); }} className="border border-slate-600 bg-slate-900 px-2 py-1 text-xs font-black uppercase hover:border-[#c9a227]">Now UTC</button>
              </div>
              <input type="datetime-local" value={utcText} onChange={(e) => { setUtcText(e.target.value); setLiveTime(false); }} className="mt-3 w-full border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-[#c9a227]" />
              <div className="mt-2 text-xs font-bold uppercase text-slate-500">{liveTime ? "Live system UTC" : "Planning time held"}</div>
            </div>

            <div className="border border-slate-700 bg-[#0a1119] p-4">
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#c9a227]">Sight Window</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-black uppercase text-slate-500">Min Hc
                  <input type="number" min="0" max="89" value={minAlt} onChange={(e) => setMinAlt(clamp(Number(e.target.value), 0, 89))} className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" />
                </label>
                <label className="text-xs font-black uppercase text-slate-500">Max Hc
                  <input type="number" min="1" max="90" value={maxAlt} onChange={(e) => setMaxAlt(clamp(Number(e.target.value), 1, 90))} className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100" />
                </label>
              </div>
            </div>

            <div className="border border-[#c9a227]/50 bg-[#141106] p-4">
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-[#fbbf24]">Suggested 3-Star Spread</h2>
              <div className="mt-3 space-y-2">
                {best.length ? best.map((star) => (
                  <div key={star.name} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-[#c9a227]/20 pt-2 text-sm font-bold first:border-0 first:pt-0">
                    <span>{star.name}</span><span className="text-slate-300">Hc {star.hc.toFixed(1)}°</span><span className="text-[#fbbf24]">Zn {star.zn.toFixed(0).padStart(3, "0")}°</span>
                  </div>
                )) : <div className="text-sm text-slate-400">No suitable three-star spread in the current 20°–65° window.</div>}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden border border-slate-700 bg-[#0a1119]">
          <div className="grid grid-cols-[52px_minmax(150px,1fr)_85px_85px_85px_75px] bg-slate-900 px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-400">
            <span>No.</span><span>Star</span><span>Hc</span><span>Zn</span><span>SHA</span><span>Mag</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {visible.map((star) => (
              <div key={star.name} className="grid grid-cols-[52px_minmax(150px,1fr)_85px_85px_85px_75px] border-t border-slate-800 px-3 py-2 text-sm font-bold hover:bg-slate-900/70">
                <span className="text-slate-500">{star.no}</span>
                <span className="text-slate-100">{star.name}</span>
                <span className="text-slate-300">{star.hc.toFixed(1)}°</span>
                <span className="text-[#fbbf24]">{star.zn.toFixed(0).padStart(3, "0")}°</span>
                <span className="text-slate-400">{star.sha.toFixed(0).padStart(3, "0")}°</span>
                <span className="text-slate-400">{star.mag.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="border border-amber-900/70 bg-amber-950/30 px-4 py-3 text-xs font-bold text-amber-200/80">
          STAR IDENTIFICATION / PLANNING AID ONLY. Rounded stellar coordinates are suitable for finding and planning stars, not final celestial sight reduction. Use the current Nautical Almanac and approved sight-reduction method for navigation.
        </div>
      </div>
    </main>
  );
}
