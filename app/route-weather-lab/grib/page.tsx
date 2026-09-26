"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeFieldValues, parseFields, parseProduct, splitMessages } from "@azohra/meteo.grib";

type FieldRec = { discipline: number; category: number; number: number; forecastHour: number; field: any };
type GridInfo = { ni: number; nj: number; lat1: number; lon1: number; lat2: number; lon2: number; di: number; dj: number; scan: number };

function u32(a: Uint8Array, o: number) { return new DataView(a.buffer, a.byteOffset + o, 4).getUint32(0, false); }
function i32(a: Uint8Array, o: number) { return new DataView(a.buffer, a.byteOffset + o, 4).getInt32(0, false); }
function u16(a: Uint8Array, o: number) { return new DataView(a.buffer, a.byteOffset + o, 2).getUint16(0, false); }
function normalizeLon(lon: number) { let x = lon; while (x > 180) x -= 360; while (x < -180) x += 360; return x; }
function nearLon(lon: number, ref: number) { let x = lon; while (x - ref > 180) x -= 360; while (x - ref < -180) x += 360; return x; }

function gridInfo(section3: Uint8Array): GridInfo {
  const template = u16(section3, 12);
  if (template !== 0) throw new Error(`GRIB grid template 3.${template} is not supported by this first viewer build.`);
  const basic = u32(section3, 38);
  const subdivisions = u32(section3, 42);
  const unit = basic === 0 || subdivisions === 0xffffffff ? 1e-6 : basic / subdivisions;
  return {
    ni: u32(section3, 30), nj: u32(section3, 34),
    lat1: i32(section3, 46) * unit, lon1: i32(section3, 50) * unit,
    lat2: i32(section3, 55) * unit, lon2: i32(section3, 59) * unit,
    di: u32(section3, 63) * unit, dj: u32(section3, 67) * unit, scan: section3[71],
  };
}

function forecastHour(section4: Uint8Array) {
  if (section4.length < 22) return 0;
  const unit = section4[17];
  const raw = i32(section4, 18);
  if (unit === 0) return raw / 60;
  if (unit === 1) return raw;
  if (unit === 2) return raw * 24;
  if (unit === 10) return raw * 3;
  if (unit === 11) return raw * 6;
  if (unit === 12) return raw * 12;
  if (unit === 13) return raw / 3600;
  return raw;
}

function fieldName(d: number, c: number, n: number) {
  const key = `${d}.${c}.${n}`;
  return ({
    "10.0.3": "Significant wave height",
    "10.0.10": "Primary wave direction",
    "10.0.11": "Primary wave period",
    "10.0.8": "Wind-wave height",
    "10.0.9": "Wind-wave period",
    "0.2.2": "U wind",
    "0.2.3": "V wind",
  } as Record<string,string>)[key] || `Parameter ${key}`;
}

function waveColor(m: number) {
  if (m >= 4) return "#ef4444";
  if (m >= 3) return "#f59e0b";
  if (m >= 2) return "#eab308";
  if (m >= 1) return "#22c55e";
  return "#22d3ee";
}

export default function GribViewerPage() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const recordsRef = useRef<FieldRec[]>([]);
  const [fileName, setFileName] = useState("");
  const [hours, setHours] = useState<number[]>([]);
  const [hourIndex, setHourIndex] = useState(0);
  const [inventory, setInventory] = useState<string[]>([]);
  const [status, setStatus] = useState("Load a GRIB2 file to begin.");
  const [showSeas, setShowSeas] = useState(true);
  const [showWaveDir, setShowWaveDir] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const selectedHour = hours[hourIndex] ?? 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapEl.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapEl.current) return;
      if (!document.querySelector('link[data-grib-leaflet="true"]')) {
        const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; link.setAttribute("data-grib-leaflet", "true"); document.head.appendChild(link);
      }
      const map = L.map(mapEl.current, { attributionControl: false }).setView([20, 180], 3);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map); mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 100);
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  async function loadFile(file: File) {
    setStatus("Reading GRIB2 fields…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const records: FieldRec[] = [];
      for (const message of splitMessages(bytes)) {
        for (const field of parseFields(message)) {
          const product = parseProduct(field.section4) as any;
          records.push({ discipline: field.discipline, category: product.parameterCategory, number: product.parameterNumber, forecastHour: forecastHour(field.section4), field });
        }
      }
      if (!records.length) throw new Error("No GRIB2 fields found.");
      recordsRef.current = records;
      const nextHours = Array.from(new Set(records.map(r => r.forecastHour))).sort((a,b) => a-b);
      const nextInventory = Array.from(new Set(records.map(r => fieldName(r.discipline, r.category, r.number))));
      setFileName(file.name); setHours(nextHours); setHourIndex(0); setInventory(nextInventory);
      setStatus(`${records.length} fields loaded • ${nextHours.length} forecast times • ${nextInventory.length} parameter types.`);
    } catch (error) {
      recordsRef.current = []; setHours([]); setInventory([]); setFileName("");
      setStatus(error instanceof Error ? error.message : "Could not read GRIB2 file.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const map = mapRef.current, layer = layerRef.current;
      if (!map || !layer || !recordsRef.current.length) return;
      const L = await import("leaflet");
      layer.clearLayers();
      const atHour = recordsRef.current.filter(r => Math.abs(r.forecastHour - selectedHour) < 0.001);
      const find = (d:number,c:number,n:number) => atHour.find(r => r.discipline===d && r.category===c && r.number===n);
      const sig = find(10,0,3), dir = find(10,0,10), per = find(10,0,11), u = find(0,2,2), v = find(0,2,3);
      const anchor = sig || dir || u || v;
      if (!anchor) { setStatus(`F${String(selectedHour).padStart(3,"0")}: no supported wind/wave fields.`); return; }
      try {
        const grid = gridInfo(anchor.field.section3);
        const sigVals = sig ? decodeFieldValues(sig.field).values : null;
        const dirVals = dir ? decodeFieldValues(dir.field).values : null;
        const perVals = per ? decodeFieldValues(per.field).values : null;
        const uVals = u ? decodeFieldValues(u.field).values : null;
        const vVals = v ? decodeFieldValues(v.field).values : null;
        const total = grid.ni * grid.nj;
        const stride = Math.max(1, Math.ceil(Math.sqrt(total / 900)));
        const iPositive = (grid.scan & 0x80) === 0;
        const jPositive = (grid.scan & 0x40) !== 0;
        const latlngs: Array<[number,number]> = [];
        for (let j=0; j<grid.nj; j+=stride) {
          for (let i=0; i<grid.ni; i+=stride) {
            const idx = j * grid.ni + i;
            const lat = grid.lat1 + (jPositive ? 1 : -1) * j * grid.dj;
            const rawLon = grid.lon1 + (iPositive ? 1 : -1) * i * grid.di;
            const lon = nearLon(normalizeLon(rawLon), normalizeLon(grid.lon1));
            latlngs.push([lat,lon]);
            const h = sigVals?.[idx]; const d = dirVals?.[idx]; const p = perVals?.[idx];
            const uu = uVals?.[idx], vv = vVals?.[idx];
            if (showSeas && Number.isFinite(h)) {
              L.circleMarker([lat,lon], { radius: 6, weight: 0, fillOpacity: .62, fillColor: waveColor(h) })
                .bindTooltip(`<b>Significant seas:</b> ${(h*3.28084).toFixed(1)} ft${Number.isFinite(p) ? `<br/><b>Primary period:</b> ${p.toFixed(0)} s` : ""}${Number.isFinite(d) ? `<br/><b>Primary direction:</b> ${d.toFixed(0)}°` : ""}`)
                .addTo(layer);
            }
            if (showWaveDir && Number.isFinite(d) && (i/stride + j/stride) % 3 === 0) {
              L.marker([lat,lon], { interactive:false, icon:L.divIcon({ className:"", html:`<div style="transform:rotate(${d}deg);color:#f8fafc;font-size:18px;text-shadow:0 1px 3px #000">↑</div>`, iconSize:[18,18], iconAnchor:[9,9] }) }).addTo(layer);
            }
            if (showWind && Number.isFinite(uu) && Number.isFinite(vv) && (i/stride + j/stride) % 4 === 0) {
              const speedKt = Math.hypot(uu,vv) * 1.94384;
              const from = (Math.atan2(-uu,-vv)*180/Math.PI+360)%360;
              L.marker([lat,lon], { icon:L.divIcon({ className:"", html:`<div title="${speedKt.toFixed(0)} kt" style="transform:rotate(${from}deg);color:#67e8f9;font-size:17px;text-shadow:0 1px 3px #000">↑</div>`, iconSize:[18,18], iconAnchor:[9,9] }) }).addTo(layer);
            }
          }
        }
        if (!cancelled && latlngs.length) map.fitBounds(L.latLngBounds(latlngs), { padding:[24,24] });
        setStatus(`F${String(selectedHour).padStart(3,"0")} rendered • ${grid.ni}×${grid.nj} grid • ${sig ? "seas " : ""}${dir ? "wave-dir " : ""}${per ? "period " : ""}${u&&v ? "wind" : ""}`.trim());
      } catch (error) { setStatus(error instanceof Error ? error.message : "Could not render this GRIB frame."); }
    }
    void draw();
    return () => { cancelled = true; };
  }, [selectedHour, showSeas, showWaveDir, showWind]);

  const validLabel = useMemo(() => `F${String(Math.round(selectedHour)).padStart(3,"0")}`, [selectedHour]);

  return <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-amber-500/25 bg-[#071019] px-3 py-2">
      <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVDASH GRIB VIEWER</div><div className="text-sm font-black">Local GRIB2 weather and sea-state overlay</div></div>
      <Link href="/route-weather-lab" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">ROUTE WEATHER</Link>
    </div>
    <section className="mb-2 border border-slate-700/50 bg-[#071019] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer border border-cyan-400/40 bg-[#08131b] px-3 py-2 text-[10px] font-black text-cyan-200">LOAD GRIB<input type="file" accept=".grb,.grib,.grb2,.grib2,application/octet-stream" className="hidden" onChange={e=>e.target.files?.[0]&&loadFile(e.target.files[0])}/></label>
        <div className="text-xs font-black text-slate-200">{fileName || "No GRIB loaded"}</div>
        <div className="ml-auto text-[10px] font-black text-[#f1d56b]">{hours.length ? validLabel : "--"}</div>
      </div>
      {hours.length > 1 && <div className="mt-3"><input className="w-full accent-amber-400" type="range" min={0} max={hours.length-1} value={hourIndex} onChange={e=>setHourIndex(Number(e.target.value))}/><div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>F{String(Math.round(hours[0])).padStart(3,"0")}</span><span>FORECAST TIME</span><span>F{String(Math.round(hours[hours.length-1])).padStart(3,"0")}</span></div></div>}
      <div className="mt-3 flex flex-wrap gap-2"><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showSeas} onChange={e=>setShowSeas(e.target.checked)}/> SEAS</label><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showWaveDir} onChange={e=>setShowWaveDir(e.target.checked)}/> WAVE DIR</label><label className="flex items-center gap-2 border border-slate-700 bg-[#050a0f] px-2 py-2 text-[10px] font-black"><input type="checkbox" checked={showWind} onChange={e=>setShowWind(e.target.checked)}/> WIND</label></div>
    </section>
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden border border-slate-800"><div ref={mapEl} style={{width:"100%",height:"68vh",minHeight:520,background:"#0a141d"}}/></section>
      <aside className="space-y-2"><section className="border border-slate-700/50 bg-[#071019] p-3"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">GRIB CONTENTS</div><div className="mt-2 space-y-1 text-[10px] text-slate-300">{inventory.length ? inventory.map(x=><div key={x}>• {x}</div>) : <div>No fields loaded.</div>}</div></section><section className="border border-slate-700/50 bg-[#071019] p-3"><div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">STATUS</div><div className="mt-2 text-[11px] leading-relaxed text-slate-300">{status}</div></section><section className="border border-cyan-400/20 bg-[#061017] p-3 text-[10px] leading-relaxed text-slate-400">Phase 1 reads the file locally in the browser. Nothing is uploaded. NOAA regular lat/lon GRIB2 is supported first, including the GFS-Wave fields used by the NavDash downloader.</section></aside>
    </div>
  </main>;
}
