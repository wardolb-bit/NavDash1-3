"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type AisTarget = { mmsi: number; source: "AIVDO" | "AIVDM"; type: number; lat?: number; lon?: number; sog?: number | null; cog?: number | null; heading?: number | null; lastSeen: number };
type FragmentBuffer = { total: number; parts: string[]; fillBits: number; firstSeen: number };
type WxData = {
  ok?: boolean;
  nws?: { shortForecast?: string; windSpeedText?: string; windDirection?: string; forecastWindKt?: number | null; alerts?: Array<{ event: string; severity?: string }> };
  ndbc?: { station?: string; windKt?: number | null; gustKt?: number | null; waveFt?: number | null };
  pacific?: { summaryText?: string; parsed?: { maxWindKt?: number | null; maxSeasFt?: number | null; warnings?: string[] } };
};
type TideData = { ok?: boolean; station?: { name?: string }; highLow?: Array<{ time: string; valueFt: number; type?: string }> };

const TARGET_STALE_MS = 10 * 60 * 1000;
const FRAGMENT_TTL_MS = 15 * 1000;

function toRad(v: number) { return (v * Math.PI) / 180; }
function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function formatLatLon(value?: number, isLat = true) {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${String(deg).padStart(isLat ? 2 : 3, "0")}° ${min.toFixed(3)}' ${hemi}`;
}
function fmt(value?: number | null, suffix = "", digits = 1) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}${suffix}`;
}
function ageText(lastSeen?: number) {
  if (!lastSeen) return "--";
  const s = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}
function formatEta(hours?: number | null) {
  if (hours === undefined || hours === null || !Number.isFinite(hours) || hours < 0) return "--";
  const d = new Date(Date.now() + hours * 3600000);
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
function normalizeRoute(data: any): RouteState | null {
  const raw = Array.isArray(data?.waypoints) ? data.waypoints : [];
  const waypoints = raw.map((wp: any, i: number) => ({
    id: String(wp?.id || `WP${String(i + 1).padStart(2, "0")}`),
    name: String(wp?.name || `Waypoint ${i + 1}`),
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  if (waypoints.length < 2) return null;
  return {
    routeName: String(data?.routeName || "Shared Route"),
    waypoints,
    activeWaypointIndex: Math.max(1, Math.min(Number(data?.activeWaypointIndex) || 1, waypoints.length - 1)),
  };
}
function pointToXY(lat: number, lon: number, refLat: number, refLon: number) {
  return { x: (lon - refLon) * 60 * Math.cos(toRad(refLat)), y: (lat - refLat) * 60 };
}
function segmentProjection(shipLat: number, shipLon: number, a: Waypoint, b: Waypoint) {
  const refLat = (shipLat + a.lat + b.lat) / 3;
  const refLon = (shipLon + a.lon + b.lon) / 3;
  const p = pointToXY(shipLat, shipLon, refLat, refLon);
  const s = pointToXY(a.lat, a.lon, refLat, refLon);
  const e = pointToXY(b.lat, b.lon, refLat, refLon);
  const vx = e.x - s.x, vy = e.y - s.y, wx = p.x - s.x, wy = p.y - s.y;
  const len2 = vx * vx + vy * vy;
  const ratio = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const dx = p.x - (s.x + ratio * vx), dy = p.y - (s.y + ratio * vy);
  return { ratio, xte: Math.sqrt(dx * dx + dy * dy) };
}
function liveRoute(route: RouteState | null, ship: AisTarget | null) {
  if (!route || ship?.lat === undefined || ship?.lon === undefined) return null;
  let best: { index: number; ratio: number; xte: number } | null = null;
  for (let i = 1; i < route.waypoints.length; i++) {
    const p = segmentProjection(ship.lat, ship.lon, route.waypoints[i - 1], route.waypoints[i]);
    const score = p.xte + Math.abs(i - route.activeWaypointIndex) * 0.35;
    if (!best || score < best.xte + Math.abs(best.index - route.activeWaypointIndex) * 0.35) best = { index: i, ratio: p.ratio, xte: p.xte };
  }
  if (!best) return null;
  const next = route.waypoints[best.index];
  const legStart = route.waypoints[best.index - 1];
  const legLength = distanceNm(legStart.lat, legStart.lon, next.lat, next.lon);
  let remaining = legLength * (1 - best.ratio);
  for (let i = best.index; i < route.waypoints.length - 1; i++) remaining += distanceNm(route.waypoints[i].lat, route.waypoints[i].lon, route.waypoints[i + 1].lat, route.waypoints[i + 1].lon);
  let total = 0;
  for (let i = 0; i < route.waypoints.length - 1; i++) total += distanceNm(route.waypoints[i].lat, route.waypoints[i].lon, route.waypoints[i + 1].lat, route.waypoints[i + 1].lon);
  const nextDistance = distanceNm(ship.lat, ship.lon, next.lat, next.lon);
  const progress = total > 0 ? Math.max(0, Math.min(100, ((total - remaining) / total) * 100)) : 0;
  return { ...best, next, legStart, remaining, total, nextDistance, progress };
}
function aisPayloadToBits(payload: string) {
  let bits = "";
  for (const ch of payload) { let v = ch.charCodeAt(0) - 48; if (v > 40) v -= 8; bits += v.toString(2).padStart(6, "0"); }
  return bits;
}
function readUnsigned(bits: string, start: number, len: number) { const c = bits.slice(start, start + len); return c.length < len ? null : parseInt(c, 2); }
function readSigned(bits: string, start: number, len: number) { const c = bits.slice(start, start + len); if (c.length < len) return null; const u = parseInt(c, 2); return c[0] === "1" ? u - 2 ** len : u; }
function parseAisLine(line: string) {
  const t = line.trim();
  if (!/^[!$]AIVD[MO]/.test(t)) return null;
  const p = t.split("*")[0].split(","); if (p.length < 7) return null;
  return { source: t.includes("AIVDO") ? "AIVDO" as const : "AIVDM" as const, total: Number(p[1]), fragment: Number(p[2]), sequence: p[3] || "", channel: p[4] || "", payload: p[5] || "", fillBits: Number(p[6] || 0) };
}
function decodePayload(payload: string, fillBits: number, source: "AIVDO" | "AIVDM") {
  const raw = aisPayloadToBits(payload); const bits = fillBits > 0 ? raw.slice(0, -fillBits) : raw;
  const type = readUnsigned(bits, 0, 6), mmsi = readUnsigned(bits, 8, 30); if (type === null || mmsi === null) return null;
  let sogRaw: number | null = null, lonRaw: number | null = null, latRaw: number | null = null, cogRaw: number | null = null, hdgRaw: number | null = null;
  if ([1, 2, 3].includes(type)) { sogRaw = readUnsigned(bits, 50, 10); lonRaw = readSigned(bits, 61, 28); latRaw = readSigned(bits, 89, 27); cogRaw = readUnsigned(bits, 116, 12); hdgRaw = readUnsigned(bits, 128, 9); }
  else if ([18, 19].includes(type)) { sogRaw = readUnsigned(bits, 46, 10); lonRaw = readSigned(bits, 57, 28); latRaw = readSigned(bits, 85, 27); cogRaw = readUnsigned(bits, 112, 12); hdgRaw = readUnsigned(bits, 124, 9); }
  else return { type, source, mmsi };
  if (latRaw === null || lonRaw === null) return { type, source, mmsi };
  const lat = latRaw / 600000, lon = lonRaw / 600000; if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { type, source, mmsi };
  return { type, source, mmsi, lat, lon, sog: sogRaw === 1023 ? null : (sogRaw ?? 0) / 10, cog: cogRaw === 3600 ? null : (cogRaw ?? 0) / 10, heading: hdgRaw === 511 ? null : hdgRaw };
}
function decodeAisLine(line: string, fragments: React.MutableRefObject<Map<string, FragmentBuffer>>) {
  const p = parseAisLine(line); if (!p || !p.payload) return null;
  const now = Date.now(); for (const [k, f] of fragments.current) if (now - f.firstSeen > FRAGMENT_TTL_MS) fragments.current.delete(k);
  if (p.total <= 1) return decodePayload(p.payload, p.fillBits, p.source);
  const key = `${p.source}-${p.sequence || "no-seq"}-${p.channel}`;
  const f = fragments.current.get(key) || { total: p.total, parts: [], fillBits: p.fillBits, firstSeen: now };
  f.parts[p.fragment - 1] = p.payload; f.fillBits = p.fillBits; fragments.current.set(key, f);
  if (f.parts.filter(Boolean).length !== f.total) return null;
  fragments.current.delete(key); return decodePayload(f.parts.join(""), f.fillBits, p.source);
}
function extractLine(message: any) {
  if (typeof message === "string") return message.trim();
  return String(message?.line || message?.sentence || message?.nmea || "").trim();
}

export default function CrewViewPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const [route, setRoute] = useState<RouteState | null>(null);
  const [connection, setConnection] = useState("CONNECTING");
  const [targets, setTargets] = useState<Record<number, AisTarget>>({});
  const [tick, setTick] = useState(0);
  const [wx, setWx] = useState<WxData | null>(null);
  const [tides, setTides] = useState<TideData | null>(null);
  const fragments = useRef<Map<string, FragmentBuffer>>(new Map());

  const targetList = useMemo(() => Object.values(targets).filter(t => Date.now() - t.lastSeen < TARGET_STALE_MS), [targets, tick]);
  const ownShip = useMemo(() => targetList.filter(t => t.source === "AIVDO" && t.lat !== undefined && t.lon !== undefined).sort((a, b) => b.lastSeen - a.lastSeen)[0] || null, [targetList]);
  const nav = useMemo(() => liveRoute(route, ownShip), [route, ownShip]);
  const etaHours = nav && ownShip?.sog && ownShip.sog > 0 ? nav.remaining / ownShip.sog : null;

  useEffect(() => {
    const loadRoute = () => fetch("/api/route-state", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setRoute(normalizeRoute(d))).catch(() => setRoute(null));
    loadRoute(); const id = window.setInterval(loadRoute, 30000); return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let closed = false;
    const ws = new WebSocket(getAisWebSocketUrl());
    ws.onopen = () => setConnection("LIVE");
    ws.onerror = () => setConnection("ERROR");
    ws.onclose = () => { if (!closed) setConnection("OFFLINE"); };
    ws.onmessage = event => {
      let parsed: any = event.data; try { parsed = JSON.parse(event.data); } catch {}
      const line = extractLine(parsed); if (!line) return;
      const d = decodeAisLine(line, fragments); setTick(v => v + 1); if (!d?.mmsi) return;
      setTargets(current => ({ ...current, [d.mmsi!]: { ...current[d.mmsi!], ...d, lastSeen: Date.now() } as AisTarget }));
    };
    return () => { closed = true; ws.close(); };
  }, []);

  useEffect(() => {
    if (ownShip?.lat === undefined || ownShip?.lon === undefined) return;
    let cancelled = false;
    const load = async () => {
      const lat = ownShip.lat!, lon = ownShip.lon!;
      try { const r = await fetch(`/api/wx?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { cache: "no-store" }); if (r.ok && !cancelled) setWx(await r.json()); } catch {}
      try { const r = await fetch(`/api/tides?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&hours=48`, { cache: "no-store" }); if (r.ok && !cancelled) setTides(await r.json()); } catch {}
    };
    load(); const id = window.setInterval(load, 10 * 60 * 1000); return () => { cancelled = true; window.clearInterval(id); };
  }, [ownShip?.lat === undefined ? "none" : `${ownShip.lat.toFixed(2)},${ownShip.lon?.toFixed(2)}`]);

  const day = !nightMode;
  const page = day ? "bg-[#eef2f5] text-[#17212b]" : "bg-[#05090e] text-[#dbe5ee]";
  const panel = day ? "border-slate-300 bg-white" : "border-white/10 bg-[#08111a]";
  const inset = day ? "border-slate-300 bg-[#f5f7f9]" : "border-white/10 bg-[#050a0f]";
  const muted = day ? "text-slate-600" : "text-[#8294a5]";
  const ctl = day ? "border-slate-300 bg-white text-slate-900" : "border-white/15 bg-[#101820] text-[#dbe5ee]";
  const nextTides = tides?.highLow?.slice(0, 2) || [];
  const wxWind = wx?.ndbc?.windKt ?? wx?.nws?.forecastWindKt ?? wx?.pacific?.parsed?.maxWindKt;
  const wxSeas = wx?.ndbc?.waveFt ?? wx?.pacific?.parsed?.maxSeasFt;
  const wxText = wx?.nws?.shortForecast || wx?.pacific?.summaryText || "Weather data pending";
  const warnings = [...(wx?.nws?.alerts || []).map(a => a.event), ...(wx?.pacific?.parsed?.warnings || [])];

  return (
    <main className={`min-h-screen ${page}`}>
      <style jsx global>{`body:has(.crew-view) .navdash-global-nav{display:none!important}.crew-view *{border-radius:0!important}`}</style>
      <div className="crew-view mx-auto max-w-5xl p-3 sm:p-4">
        <header className={`mb-3 border p-3 ${panel}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#c9a227]">M/V MB480 · NAVDASH 1.3</div>
              <h1 className="mt-1 text-xl font-black uppercase tracking-[.08em] sm:text-2xl">Crew Vessel Status</h1>
              <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.12em] ${muted}`}>READ ONLY · LIVE SHIPBOARD INFORMATION</div>
            </div>
            <button type="button" onClick={toggleTheme} className={`shrink-0 border px-3 py-2 text-[10px] font-black uppercase ${ctl}`}>{nightMode ? "Day" : "Night"}</button>
          </div>
        </header>

        <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Status label="AIS" value={connection} accent={connection === "LIVE"} panel={panel} muted={muted} />
          <Status label="SOG" value={fmt(ownShip?.sog, " kt")} panel={panel} muted={muted} />
          <Status label="COG" value={fmt(ownShip?.cog, "°")} panel={panel} muted={muted} />
          <Status label="Heading" value={fmt(ownShip?.heading, "°", 0)} panel={panel} muted={muted} />
        </section>

        <section className={`mb-3 border p-4 ${panel}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Title text="Own Ship" muted={muted} />
            <div className={`text-[10px] font-bold uppercase ${muted}`}>Age {ageText(ownShip?.lastSeen)}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Metric label="Latitude" value={formatLatLon(ownShip?.lat, true)} inset={inset} muted={muted} />
            <Metric label="Longitude" value={formatLatLon(ownShip?.lon, false)} inset={inset} muted={muted} />
          </div>
        </section>

        <section className={`mb-3 border p-4 ${panel}`}>
          <Title text="Voyage" muted={muted} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Route" value={route?.routeName || "No route loaded"} inset={inset} muted={muted} wide />
            <Metric label="Next Waypoint" value={nav ? `${nav.next.id} · ${nav.next.name}` : "--"} inset={inset} muted={muted} wide />
            <Metric label="Next WP" value={nav ? `${nav.nextDistance.toFixed(1)} nm` : "--"} inset={inset} muted={muted} />
            <Metric label="Distance To Go" value={nav ? `${nav.remaining.toFixed(1)} nm` : "--"} inset={inset} muted={muted} />
            <Metric label="ETA" value={formatEta(etaHours)} inset={inset} muted={muted} />
            <Metric label="Cross Track" value={nav ? `${nav.xte.toFixed(2)} nm` : "--"} inset={inset} muted={muted} />
          </div>
          <div className={`mt-3 border p-3 ${inset}`}>
            <div className="mb-2 flex justify-between text-[10px] font-black uppercase tracking-[.12em]"><span className={muted}>Route Progress</span><span>{nav ? `${nav.progress.toFixed(0)}%` : "--"}</span></div>
            <div className={day ? "h-2 bg-slate-200" : "h-2 bg-black/40"}><div className="h-2 bg-[#c9a227]" style={{ width: `${nav?.progress || 0}%` }} /></div>
          </div>
        </section>

        <section className={`mb-3 border p-4 ${panel}`}>
          <Title text="Route Overview" muted={muted} />
          <div className={`mt-3 border p-2 ${inset}`}><RouteSketch route={route} ship={ownShip} /></div>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className={`border p-4 ${panel}`}>
            <Title text="Weather" muted={muted} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Wind" value={fmt(wxWind, " kt")} inset={inset} muted={muted} />
              <Metric label="Seas" value={fmt(wxSeas, " ft")} inset={inset} muted={muted} />
            </div>
            <div className={`mt-2 border p-3 text-sm leading-5 ${inset}`}>{wxText}</div>
            {warnings.length > 0 && <div className="mt-2 border border-amber-500/50 bg-amber-500/10 p-3 text-xs font-black uppercase text-amber-500">{warnings.slice(0, 3).join(" · ")}</div>}
          </section>

          <section className={`border p-4 ${panel}`}>
            <Title text="Tides" muted={muted} />
            <div className={`mt-2 text-xs ${muted}`}>{tides?.station?.name || "Nearest station pending"}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {nextTides.length ? nextTides.map((t, i) => <Metric key={`${t.time}-${i}`} label={t.type || "Prediction"} value={`${new Date(t.time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${Number(t.valueFt).toFixed(1)} ft`} inset={inset} muted={muted} />) : <div className={`col-span-2 border p-3 text-sm ${inset} ${muted}`}>Tide data pending</div>}
            </div>
          </section>
        </div>

        <footer className={`mt-3 border p-3 text-center text-[10px] font-bold uppercase tracking-[.1em] ${panel} ${muted}`}>Crew display only · Navigation and voyage decisions remain with the bridge team</footer>
      </div>
    </main>
  );
}

function Title({ text, muted }: { text: string; muted: string }) { return <div className={`text-[10px] font-black uppercase tracking-[.16em] ${muted}`}>{text}</div>; }
function Status({ label, value, panel, muted, accent = false }: { label: string; value: string; panel: string; muted: string; accent?: boolean }) {
  return <div className={`border p-3 ${panel}`}><div className={`text-[9px] font-black uppercase tracking-[.14em] ${muted}`}>{label}</div><div className={`mt-1 font-mono text-lg font-black ${accent ? "text-emerald-500" : ""}`}>{value}</div></div>;
}
function Metric({ label, value, inset, muted, wide = false }: { label: string; value: string; inset: string; muted: string; wide?: boolean }) {
  return <div className={`border p-3 ${inset} ${wide ? "sm:col-span-2" : ""}`}><div className={`text-[9px] font-black uppercase tracking-[.14em] ${muted}`}>{label}</div><div className="mt-1 break-words font-mono text-sm font-black">{value}</div></div>;
}
function RouteSketch({ route, ship }: { route: RouteState | null; ship: AisTarget | null }) {
  if (!route) return <div className="grid h-48 place-items-center text-sm text-slate-500">No route loaded</div>;
  const pts = [...route.waypoints];
  if (ship?.lat !== undefined && ship?.lon !== undefined) pts.push({ id: "SHIP", name: "Ship", lat: ship.lat, lon: ship.lon });
  const minLat = Math.min(...pts.map(p => p.lat)), maxLat = Math.max(...pts.map(p => p.lat));
  const minLon = Math.min(...pts.map(p => p.lon)), maxLon = Math.max(...pts.map(p => p.lon));
  const latSpan = Math.max(0.02, maxLat - minLat), lonSpan = Math.max(0.02, maxLon - minLon);
  const xy = (lat: number, lon: number) => ({ x: 18 + ((lon - minLon) / lonSpan) * 324, y: 182 - ((lat - minLat) / latSpan) * 164 });
  const line = route.waypoints.map(p => { const q = xy(p.lat, p.lon); return `${q.x},${q.y}`; }).join(" ");
  const shipXY = ship?.lat !== undefined && ship?.lon !== undefined ? xy(ship.lat, ship.lon) : null;
  return <svg viewBox="0 0 360 200" className="h-48 w-full" role="img" aria-label="Route overview"><polyline points={line} fill="none" stroke="#c9a227" strokeWidth="2" />{route.waypoints.map((p, i) => { const q = xy(p.lat, p.lon); return <g key={`${p.id}-${i}`}><circle cx={q.x} cy={q.y} r="3" fill="#c9a227"/><text x={q.x + 5} y={q.y - 5} fontSize="7" fill="currentColor">{p.id}</text></g>; })}{shipXY && <g><circle cx={shipXY.x} cy={shipXY.y} r="6" fill="#38bdf8"/><circle cx={shipXY.x} cy={shipXY.y} r="10" fill="none" stroke="#38bdf8" strokeWidth="1"/></g>}</svg>;
}
