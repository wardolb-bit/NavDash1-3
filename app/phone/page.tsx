"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CrewNoaaMap } from "../../components/CrewNoaaMap";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Waypoint = { id: string; name: string; lat: number; lon: number };
type RouteState = { routeName: string; waypoints: Waypoint[]; activeWaypointIndex: number };
type AisTarget = { mmsi: number; source: "AIVDO" | "AIVDM"; type: number; lat?: number; lon?: number; sog?: number | null; cog?: number | null; heading?: number | null; lastSeen: number };
type FragmentBuffer = { total: number; parts: string[]; fillBits: number; firstSeen: number };
type WxData = {
  nws?: { shortForecast?: string; forecastWindKt?: number | null; alerts?: Array<{ event: string }> };
  ndbc?: { windKt?: number | null; waveFt?: number | null };
  pacific?: { summaryText?: string; parsed?: { maxWindKt?: number | null; maxSeasFt?: number | null; warnings?: string[] } };
};
type TideData = { station?: { name?: string }; highLow?: Array<{ time: string; valueFt: number; type?: string }> };

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
  return new Date(Date.now() + hours * 3600000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
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
  const active = Number(data?.activeWaypointIndex);
  return {
    routeName: String(data?.routeName || "Shared Route"),
    waypoints,
    activeWaypointIndex: Number.isFinite(active) ? Math.max(1, Math.min(Math.round(active), waypoints.length - 1)) : 1,
  };
}
function segmentProjection(shipLat: number, shipLon: number, a: Waypoint, b: Waypoint) {
  const refLat = (shipLat + a.lat + b.lat) / 3;
  const refLon = (shipLon + a.lon + b.lon) / 3;
  const p = { x: (shipLon - refLon) * 60 * Math.cos(toRad(refLat)), y: (shipLat - refLat) * 60 };
  const s = { x: (a.lon - refLon) * 60 * Math.cos(toRad(refLat)), y: (a.lat - refLat) * 60 };
  const e = { x: (b.lon - refLon) * 60 * Math.cos(toRad(refLat)), y: (b.lat - refLat) * 60 };
  const vx = e.x - s.x, vy = e.y - s.y, wx = p.x - s.x, wy = p.y - s.y;
  const len2 = vx * vx + vy * vy;
  const ratio = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const dx = p.x - (s.x + ratio * vx), dy = p.y - (s.y + ratio * vy);
  return { ratio, xte: Math.sqrt(dx * dx + dy * dy) };
}
function liveRoute(route: RouteState | null, ship: AisTarget | null) {
  if (!route || ship?.lat === undefined || ship?.lon === undefined) return null;

  let index = route.activeWaypointIndex;
  let projection = segmentProjection(ship.lat, ship.lon, route.waypoints[index - 1], route.waypoints[index]);

  while (projection.ratio >= 0.985 && index < route.waypoints.length - 1) {
    index += 1;
    projection = segmentProjection(ship.lat, ship.lon, route.waypoints[index - 1], route.waypoints[index]);
  }

  const legStart = route.waypoints[index - 1];
  const next = route.waypoints[index];
  const legLength = distanceNm(legStart.lat, legStart.lon, next.lat, next.lon);
  let remaining = legLength * (1 - projection.ratio);
  for (let i = index; i < route.waypoints.length - 1; i += 1) {
    remaining += distanceNm(route.waypoints[i].lat, route.waypoints[i].lon, route.waypoints[i + 1].lat, route.waypoints[i + 1].lon);
  }
  let total = 0;
  for (let i = 0; i < route.waypoints.length - 1; i += 1) {
    total += distanceNm(route.waypoints[i].lat, route.waypoints[i].lon, route.waypoints[i + 1].lat, route.waypoints[i + 1].lon);
  }
  return {
    index,
    legStart,
    next,
    xte: projection.xte,
    nextDistance: distanceNm(ship.lat, ship.lon, next.lat, next.lon),
    remaining,
    progress: total > 0 ? Math.max(0, Math.min(100, ((total - remaining) / total) * 100)) : 0,
  };
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
  const p = t.split("*")[0].split(",");
  if (p.length < 7) return null;
  return { source: t.includes("AIVDO") ? "AIVDO" as const : "AIVDM" as const, total: Number(p[1]), fragment: Number(p[2]), sequence: p[3] || "", channel: p[4] || "", payload: p[5] || "", fillBits: Number(p[6] || 0) };
}
function decodePayload(payload: string, fillBits: number, source: "AIVDO" | "AIVDM") {
  const raw = aisPayloadToBits(payload);
  const bits = fillBits > 0 ? raw.slice(0, -fillBits) : raw;
  const type = readUnsigned(bits, 0, 6), mmsi = readUnsigned(bits, 8, 30);
  if (type === null || mmsi === null) return null;
  let sogRaw: number | null = null, lonRaw: number | null = null, latRaw: number | null = null, cogRaw: number | null = null, hdgRaw: number | null = null;
  if ([1, 2, 3].includes(type)) { sogRaw = readUnsigned(bits, 50, 10); lonRaw = readSigned(bits, 61, 28); latRaw = readSigned(bits, 89, 27); cogRaw = readUnsigned(bits, 116, 12); hdgRaw = readUnsigned(bits, 128, 9); }
  else if ([18, 19].includes(type)) { sogRaw = readUnsigned(bits, 46, 10); lonRaw = readSigned(bits, 57, 28); latRaw = readSigned(bits, 85, 27); cogRaw = readUnsigned(bits, 112, 12); hdgRaw = readUnsigned(bits, 124, 9); }
  else return { type, source, mmsi };
  if (latRaw === null || lonRaw === null) return { type, source, mmsi };
  const lat = latRaw / 600000, lon = lonRaw / 600000;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { type, source, mmsi };
  return { type, source, mmsi, lat, lon, sog: sogRaw === 1023 ? null : (sogRaw ?? 0) / 10, cog: cogRaw === 3600 ? null : (cogRaw ?? 0) / 10, heading: hdgRaw === 511 ? null : hdgRaw };
}
function decodeAisLine(line: string, fragments: React.MutableRefObject<Map<string, FragmentBuffer>>) {
  const p = parseAisLine(line);
  if (!p || !p.payload) return null;
  const now = Date.now();
  for (const [k, f] of fragments.current) if (now - f.firstSeen > FRAGMENT_TTL_MS) fragments.current.delete(k);
  if (p.total <= 1) return decodePayload(p.payload, p.fillBits, p.source);
  const key = `${p.source}-${p.sequence || "no-seq"}-${p.channel}`;
  const f = fragments.current.get(key) || { total: p.total, parts: [], fillBits: p.fillBits, firstSeen: now };
  f.parts[p.fragment - 1] = p.payload;
  f.fillBits = p.fillBits;
  fragments.current.set(key, f);
  if (f.parts.filter(Boolean).length !== f.total) return null;
  fragments.current.delete(key);
  return decodePayload(f.parts.join(""), f.fillBits, p.source);
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

  const targetList = useMemo(() => Object.values(targets).filter((t) => Date.now() - t.lastSeen < TARGET_STALE_MS), [targets, tick]);
  const ownShip = useMemo(() => targetList.filter((t) => t.source === "AIVDO" && t.lat !== undefined && t.lon !== undefined).sort((a, b) => b.lastSeen - a.lastSeen)[0] || null, [targetList]);
  const nav = useMemo(() => liveRoute(route, ownShip), [route, ownShip]);
  const etaHours = nav && ownShip?.sog && ownShip.sog > 0 ? nav.remaining / ownShip.sog : null;

  useEffect(() => {
    const loadRoute = () => fetch("/api/route-state", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => setRoute(normalizeRoute(d))).catch(() => setRoute(null));
    loadRoute();
    const id = window.setInterval(loadRoute, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let closed = false;
    const ws = new WebSocket(getAisWebSocketUrl());
    ws.onopen = () => setConnection("LIVE");
    ws.onerror = () => setConnection("ERROR");
    ws.onclose = () => { if (!closed) setConnection("OFFLINE"); };
    ws.onmessage = (event) => {
      let parsed: any = event.data;
      try { parsed = JSON.parse(event.data); } catch {}
      const line = extractLine(parsed);
      if (!line) return;
      const d = decodeAisLine(line, fragments);
      setTick((v) => v + 1);
      if (!d?.mmsi) return;
      setTargets((current) => ({ ...current, [d.mmsi!]: { ...current[d.mmsi!], ...d, lastSeen: Date.now() } as AisTarget }));
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
    void load();
    const id = window.setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(id); };
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
  const warnings = [...(wx?.nws?.alerts || []).map((a) => a.event), ...(wx?.pacific?.parsed?.warnings || [])];

  return (
    <main className={`min-h-screen ${page}`}>
      <style jsx global>{`body:has(.crew-view) .navdash-global-nav{display:none!important}.crew-view *{border-radius:0!important}.crew-view .leaflet-control-container *{border-radius:2px!important}`}</style>
      <div className="crew-view mx-auto max-w-[1800px] p-3 sm:p-4">
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

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(360px,.8fr)] xl:grid-cols-[minmax(0,2fr)_minmax(390px,.72fr)]">
          <section className={`min-h-[430px] overflow-hidden border lg:sticky lg:top-3 lg:h-[calc(100vh-110px)] ${panel}`}>
            <div className="flex items-center justify-between border-b border-current/10 px-3 py-2">
              <Title text="NOAA ENC · Route Overview" muted={muted} />
              <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Read only</div>
            </div>
            <div className="h-[430px] lg:h-[calc(100%-37px)]">
              <CrewNoaaMap route={route} ship={ownShip} nightMode={nightMode} />
            </div>
          </section>

          <div className="grid content-start gap-3">
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <Status label="AIS" value={connection} accent={connection === "LIVE"} panel={panel} muted={muted} />
              <Status label="SOG" value={fmt(ownShip?.sog, " kt")} panel={panel} muted={muted} />
              <Status label="COG" value={fmt(ownShip?.cog, "°")} panel={panel} muted={muted} />
              <Status label="Heading" value={fmt(ownShip?.heading, "°", 0)} panel={panel} muted={muted} />
            </section>

            <section className={`border p-4 ${panel}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <Title text="Own Ship" muted={muted} />
                <div className={`text-[10px] font-bold uppercase ${muted}`}>Age {ageText(ownShip?.lastSeen)}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Metric label="Latitude" value={formatLatLon(ownShip?.lat, true)} inset={inset} muted={muted} />
                <Metric label="Longitude" value={formatLatLon(ownShip?.lon, false)} inset={inset} muted={muted} />
              </div>
            </section>

            <section className={`border p-4 ${panel}`}>
              <Title text="Voyage" muted={muted} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Metric label="Route" value={route?.routeName || "No route loaded"} inset={inset} muted={muted} wide />
                <Metric label="Active Leg" value={nav ? `${nav.legStart.id} → ${nav.next.id}` : "--"} inset={inset} muted={muted} wide />
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
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {nextTides.length ? nextTides.map((t, i) => <Metric key={`${t.time}-${i}`} label={t.type || "Prediction"} value={`${new Date(t.time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${Number(t.valueFt).toFixed(1)} ft`} inset={inset} muted={muted} />) : <div className={`border p-3 text-sm ${inset} ${muted}`}>Tide data pending</div>}
              </div>
            </section>
          </div>
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
  return <div className={`border p-3 ${inset} ${wide ? "sm:col-span-2 lg:col-span-1 xl:col-span-2" : ""}`}><div className={`text-[9px] font-black uppercase tracking-[.14em] ${muted}`}>{label}</div><div className="mt-1 break-words font-mono text-sm font-black">{value}</div></div>;
}
