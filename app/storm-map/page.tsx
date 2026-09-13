"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEgcWebSocketUrl } from "../../lib/aisWebSocket";

type EgcMessage = {
  id: string;
  filename: string;
  type: string;
  sequence: string;
  priority: string;
  receiveText: string;
  receivedAt: string | null;
  body: string;
  modifiedAt: string;
};

type EgcSnapshot = {
  type: "egc-snapshot";
  connected: boolean;
  scannedAt: string | null;
  lastError: string | null;
  messages: EgcMessage[];
};

type StormPoint = {
  lat: number;
  lon: number;
  kind: "OBS" | "FCST";
  label: string;
  valid: string;
  leadHours: number | null;
  windKt: number | null;
  radius34Nm: number | null;
  sourceId: string;
};

type StormRecord = {
  name: string;
  message: EgcMessage;
  points: StormPoint[];
};

type RoutePoint = { lat: number; lon: number; name?: string; id?: string };

const TC_RE = /\b(TROPICAL\s+(?:STORM|CYCLONE|DEPRESSION)|TYPHOON|HURRICANE|TCFA|TROPICAL CYCLONE WARNING)\b/i;

function normalizeLon(value: number, hemi: string) {
  const abs = Math.abs(value);
  return /W/i.test(hemi) ? -abs : abs;
}

function normalizeLat(value: number, hemi: string) {
  const abs = Math.abs(value);
  return /S/i.test(hemi) ? -abs : abs;
}

function extractStormName(body: string) {
  const patterns = [
    /\b(?:TROPICAL\s+STORM|TROPICAL\s+CYCLONE|TROPICAL\s+DEPRESSION|TYPHOON|HURRICANE)\s+([A-Z][A-Z0-9-]{2,})\b/i,
    /\bNAME\s*[:=-]?\s*([A-Z][A-Z0-9-]{2,})\b/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return "UNNAMED";
}

function parseCoordFromText(text: string) {
  const decimal = text.match(/(\d{1,2}(?:\.\d+)?)\s*[°º]?\s*([NS])\b[^\d]{0,16}(\d{1,3}(?:\.\d+)?)\s*[°º]?\s*([EW])\b/i);
  if (decimal) {
    const lat = normalizeLat(Number(decimal[1]), decimal[2]);
    const lon = normalizeLon(Number(decimal[3]), decimal[4]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }

  const compact = text.match(/(\d{1,2})[-\s](\d{1,2}(?:\.\d+)?)\s*([NS])\b[^\d]{0,16}(\d{1,3})[-\s](\d{1,2}(?:\.\d+)?)\s*([EW])\b/i);
  if (compact) {
    const lat = normalizeLat(Number(compact[1]) + Number(compact[2]) / 60, compact[3]);
    const lon = normalizeLon(Number(compact[4]) + Number(compact[5]) / 60, compact[6]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

function extractValid(text: string) {
  const dtg = text.match(/\b(\d{2})(\d{2})(\d{2})Z\b/i);
  if (dtg) return `${dtg[1]}${dtg[2]}${dtg[3]}Z`;
  const full = text.match(/\b(\d{8})\/(\d{4})Z?\b/);
  if (full) return `${full[1]} ${full[2]}Z`;
  return "";
}

function extractLead(text: string) {
  const match = text.match(/(?:\+\s*)?(\d{1,3})\s*(?:H|HR|HRS|HOUR|HOURS)\b/i);
  return match ? Number(match[1]) : null;
}

function extractWind(text: string) {
  const patterns = [
    /MAX(?:IMUM)?\s+(?:SUSTAINED\s+)?WINDS?[^\d]{0,20}(\d{1,3})\s*(?:KT|KTS|KNOTS)/i,
    /WINDS?[^\d]{0,12}(\d{1,3})\s*(?:KT|KTS|KNOTS)/i,
    /INTENSITY[^\d]{0,12}(\d{1,3})\s*(?:KT|KTS|KNOTS)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extract34Radius(text: string) {
  if (!/(?:34|034)\s*(?:KT|KTS|KNOT)/i.test(text)) return null;
  const values = [...text.matchAll(/(\d{1,3})\s*(?:NM|NMI)\b/gi)].map(match => Number(match[1])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function parseStormMessage(message: EgcMessage): StormRecord | null {
  const body = message.body || "";
  if (!TC_RE.test(body)) return null;
  const name = extractStormName(body);
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const points: StormPoint[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const windowText = [lines[index - 2], lines[index - 1], lines[index], lines[index + 1], lines[index + 2]].filter(Boolean).join(" ");
    const coord = parseCoordFromText(windowText);
    if (!coord) continue;

    const forecast = /FORECAST|FCST|\+\s*\d+\s*H|\b\d+\s*(?:HRS?|HOURS?)\b/i.test(windowText);
    const leadHours = forecast ? extractLead(windowText) : null;
    const valid = extractValid(windowText);
    const windKt = extractWind(windowText);
    const radius34Nm = extract34Radius(windowText);
    const signature = `${coord.lat.toFixed(3)}:${coord.lon.toFixed(3)}:${forecast ? "F" : "O"}:${leadHours ?? ""}`;
    if (points.some(point => `${point.lat.toFixed(3)}:${point.lon.toFixed(3)}:${point.kind === "FCST" ? "F" : "O"}:${point.leadHours ?? ""}` === signature)) continue;

    points.push({
      lat: coord.lat,
      lon: coord.lon,
      kind: forecast ? "FCST" : "OBS",
      label: forecast ? (leadHours !== null ? `FCST +${leadHours}H` : "FCST") : "OBS",
      valid,
      leadHours,
      windKt,
      radius34Nm,
      sourceId: message.id,
    });
  }

  if (!points.length) return null;
  return { name, message, points };
}

function unwrapLon(lon: number, reference: number) {
  let value = lon;
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
}

function readSavedRoute(): RoutePoint[] {
  try {
    const raw = localStorage.getItem("navconsole-saved-route");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
    return source.map((wp: any) => ({ lat: Number(wp.lat ?? wp.latitude), lon: Number(wp.lon ?? wp.lng ?? wp.longitude), name: wp.name, id: wp.id }))
      .filter((wp: RoutePoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  } catch { return []; }
}

function formatUtc(value: string | null | undefined) {
  if (!value) return "UNKNOWN";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function StormMapPage() {
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const [snapshot, setSnapshot] = useState<EgcSnapshot | null>(null);
  const [socketStatus, setSocketStatus] = useState("CONNECTING");
  const [selectedName, setSelectedName] = useState<string>("");
  const [route, setRoute] = useState<RoutePoint[]>([]);

  useEffect(() => {
    setRoute(readSavedRoute());
    void fetch("/api/route-state", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json();
      const source = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
      const next = source.map((wp: any) => ({ lat: Number(wp.lat ?? wp.latitude), lon: Number(wp.lon ?? wp.lng ?? wp.longitude), name: wp.name, id: wp.id }))
        .filter((wp: RoutePoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
      if (next.length >= 2) setRoute(next);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    const connect = () => {
      setSocketStatus("CONNECTING");
      ws = new WebSocket(getEgcWebSocketUrl());
      ws.onopen = () => { setSocketStatus("LIVE"); ws?.send(JSON.stringify({ type: "egc-refresh" })); };
      ws.onerror = () => setSocketStatus("ERROR");
      ws.onclose = () => { setSocketStatus("OFFLINE"); if (!closed) retry = setTimeout(connect, 5000); };
      ws.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as EgcSnapshot;
          if (payload?.type === "egc-snapshot") setSnapshot(payload);
        } catch {}
      };
    };
    connect();
    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close(); };
  }, []);

  const records = useMemo(() => (snapshot?.messages ?? []).map(parseStormMessage).filter((item): item is StormRecord => Boolean(item)), [snapshot]);
  const stormNames = useMemo(() => Array.from(new Set(records.map(record => record.name))).sort(), [records]);

  useEffect(() => {
    if (!stormNames.length) { setSelectedName(""); return; }
    if (!selectedName || !stormNames.includes(selectedName)) setSelectedName(stormNames[0]);
  }, [stormNames, selectedName]);

  const selectedRecords = useMemo(() => records.filter(record => record.name === selectedName).sort((a, b) => {
    const at = Date.parse(a.message.receivedAt || a.message.modifiedAt || "") || 0;
    const bt = Date.parse(b.message.receivedAt || b.message.modifiedAt || "") || 0;
    return at - bt;
  }), [records, selectedName]);

  const latest = selectedRecords[selectedRecords.length - 1] ?? null;

  const observed = useMemo(() => {
    const points: StormPoint[] = [];
    for (const record of selectedRecords) {
      const obs = record.points.find(point => point.kind === "OBS");
      if (!obs) continue;
      if (!points.some(point => Math.abs(point.lat - obs.lat) < 0.005 && Math.abs(point.lon - obs.lon) < 0.005)) points.push(obs);
    }
    return points;
  }, [selectedRecords]);

  const forecast = useMemo(() => (latest?.points ?? []).filter(point => point.kind === "FCST").sort((a, b) => (a.leadHours ?? 9999) - (b.leadHours ?? 9999)), [latest]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!mapHostRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapHostRef.current) return;
      if (!document.querySelector('link[data-storm-map-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-storm-map-leaflet", "true");
        document.head.appendChild(link);
      }
      const map = L.map(mapHostRef.current, { zoomControl: true, attributionControl: false, worldCopyJump: true, minZoom: 3 }).setView([20, -157], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      try {
        L.tileLayer.wms("https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer", {
          layers: "1,2,3,4,5,6,7", format: "image/png", transparent: true, version: "1.1.1", opacity: 0.55, tileSize: 512,
        } as any).addTo(map);
      } catch {}
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    };
    void init();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const draw = async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      for (const layer of layersRef.current) { try { map.removeLayer(layer); } catch {} }
      layersRef.current = [];
      const add = (layer: any) => { layer.addTo(map); layersRef.current.push(layer); return layer; };
      const allBounds: [number, number][] = [];
      const refLon = observed[observed.length - 1]?.lon ?? forecast[0]?.lon ?? route[0]?.lon ?? map.getCenter().lng;

      if (route.length >= 2) {
        const routePts: [number, number][] = [];
        let previous = unwrapLon(route[0].lon, refLon);
        routePts.push([route[0].lat, previous]);
        for (let i = 1; i < route.length; i += 1) { previous = unwrapLon(route[i].lon, previous); routePts.push([route[i].lat, previous]); }
        add(L.polyline(routePts, { color: "#c9a227", weight: 3, opacity: 0.85 }));
        routePts.forEach(point => allBounds.push(point));
      }

      const obsPts = observed.map(point => [point.lat, unwrapLon(point.lon, refLon)] as [number, number]);
      if (obsPts.length >= 2) add(L.polyline(obsPts, { color: "#fb7185", weight: 4, opacity: 0.95 }));
      observed.forEach((point, index) => {
        const lon = unwrapLon(point.lon, refLon);
        const marker = add(L.circleMarker([point.lat, lon], { radius: index === observed.length - 1 ? 8 : 5, color: "#fecdd3", fillColor: "#be123c", fillOpacity: 1, weight: 2 }));
        marker.bindTooltip(`<b>${selectedName} OBS</b><br>${point.valid || formatUtc(selectedRecords[index]?.message.receivedAt)}${point.windKt ? `<br>${point.windKt} KT` : ""}`);
        allBounds.push([point.lat, lon]);
      });

      const current = observed[observed.length - 1] ?? latest?.points.find(point => point.kind === "OBS") ?? null;
      const fcPts = [...(current ? [[current.lat, unwrapLon(current.lon, refLon)] as [number, number]] : []), ...forecast.map(point => [point.lat, unwrapLon(point.lon, refLon)] as [number, number])];
      if (fcPts.length >= 2) add(L.polyline(fcPts, { color: "#38bdf8", weight: 4, opacity: 0.95, dashArray: "10 8" }));

      forecast.forEach(point => {
        const lon = unwrapLon(point.lon, refLon);
        const marker = add(L.circleMarker([point.lat, lon], { radius: 7, color: "#7dd3fc", fillColor: "#071019", fillOpacity: 0.92, weight: 3 }));
        marker.bindTooltip(`<b>${selectedName} ${point.label}</b><br>${point.valid || "Valid time not parsed"}${point.windKt ? `<br>${point.windKt} KT` : ""}${point.radius34Nm ? `<br>34 KT radius up to ${point.radius34Nm} NM` : ""}`);
        if (point.radius34Nm) add(L.circle([point.lat, lon], { radius: point.radius34Nm * 1852, color: "#38bdf8", weight: 1, opacity: 0.65, fillColor: "#38bdf8", fillOpacity: 0.045 }));
        allBounds.push([point.lat, lon]);
      });

      if (allBounds.length >= 2) map.fitBounds(allBounds, { padding: [45, 45], maxZoom: 7, animate: false });
      else if (allBounds.length === 1) map.setView(allBounds[0], 6, { animate: false });
    };
    void draw();
  }, [observed, forecast, route, selectedName, latest, selectedRecords]);

  return (
    <main className="min-h-screen bg-[#071019] text-slate-100">
      <div className="border-b border-white/10 bg-[#071019]/95 px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH · SHIPBOARD EGC</div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Tropical Cyclone Storm Map</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/bridge" className="rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-black">MAIN PAGE</Link>
            <Link href="/msi" className="rounded-lg border border-[#22d3ee]/30 bg-[#22d3ee]/10 px-4 py-2 text-sm font-black text-[#67e8f9]">EGC / MSI</Link>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1800px] gap-4 p-4 md:p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">FELCOM FEED</div>
                <div className="mt-1 font-black">{socketStatus}</div>
              </div>
              <span className={`h-3 w-3 rounded-full ${socketStatus === "LIVE" && !snapshot?.lastError ? "bg-emerald-400" : "bg-rose-400"}`} />
            </div>
            <div className="mt-3 text-xs font-semibold leading-5 text-slate-400">Last scan: {formatUtc(snapshot?.scannedAt)}</div>
            {snapshot?.lastError ? <div className="mt-2 text-xs font-bold text-rose-300">{snapshot.lastError}</div> : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <label className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Tropical system</label>
            <select value={selectedName} onChange={event => setSelectedName(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1722] px-3 py-2.5 font-black outline-none">
              {stormNames.length ? stormNames.map(name => <option key={name} value={name}>{name}</option>) : <option value="">NO TC EGC FOUND</option>}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-black/20 p-2"><div className="text-slate-500">EGC warnings</div><div className="mt-1 text-lg font-black">{selectedRecords.length}</div></div>
              <div className="rounded-lg bg-black/20 p-2"><div className="text-slate-500">Forecast pts</div><div className="mt-1 text-lg font-black">{forecast.length}</div></div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">PLOT KEY</div>
            <div className="mt-3 space-y-2 text-sm font-bold">
              <div><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />Observed positions / solid track</div>
              <div><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full border-2 border-sky-300" />Forecast positions / dashed track</div>
              <div><span className="mr-2 inline-block h-1 w-8 bg-[#c9a227] align-middle" />NavDash vessel route</div>
            </div>
            <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">Plotted directly from received FELCOM EGC text. Verify against the raw warning below before operational use.</p>
          </section>
        </aside>

        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
            <div ref={mapHostRef} className="h-[64vh] min-h-[520px] w-full" />
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-[#22d3ee]">LATEST EGC WARNING · RAW SOURCE</div>
              {latest ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-400">
                    <span>{latest.message.filename}</span><span>Received {formatUtc(latest.message.receivedAt || latest.message.modifiedAt)}</span><span>Seq {latest.message.sequence || "-"}</span>
                  </div>
                  <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-4 text-xs font-semibold leading-5 text-slate-300">{latest.message.body}</pre>
                </>
              ) : <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">Waiting for a tropical-cyclone EGC message from the FELCOM feed.</div>}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">FORECAST POSITIONS</div>
              <div className="mt-3 max-h-[390px] space-y-2 overflow-auto">
                {forecast.map((point, index) => (
                  <div key={`${point.lat}-${point.lon}-${index}`} className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-3 text-sm">
                    <div className="font-black text-sky-200">{point.label} {point.valid}</div>
                    <div className="mt-1 font-bold text-slate-300">{Math.abs(point.lat).toFixed(2)}°{point.lat < 0 ? "S" : "N"} / {Math.abs(point.lon).toFixed(2)}°{point.lon < 0 ? "W" : "E"}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{point.windKt ? `${point.windKt} KT` : "Wind not parsed"}{point.radius34Nm ? ` · 34 KT radius ${point.radius34Nm} NM max` : ""}</div>
                  </div>
                ))}
                {!forecast.length ? <div className="text-sm font-bold text-slate-500">No forecast coordinates parsed from the latest warning yet.</div> : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
