"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../../lib/aisWebSocket";
import { solveNavStars, type StarSolution } from "../../../lib/celestial";

type ViewMode = "ahead" | "port" | "starboard" | "astern";
type NavState = { lat:number; lon:number; heading:number|null; cog:number|null };
const norm=(v:number)=>((v%360)+360)%360;
const signedRel=(az:number,center:number)=>((az-center+540)%360)-180;

function six(c:string){const n=c.charCodeAt(0);return n<88?n-48:n-56}
function bits(p:string){return p.split("").map(c=>six(c).toString(2).padStart(6,"0")).join("")}
function u(b:string,s:number,l:number){return parseInt(b.slice(s,s+l),2)}
function si(b:string,s:number,l:number){const v=u(b,s,l),t=2**(l-1);return v>=t?v-2**l:v}
function decode(line:string):Partial<NavState>|null{
  const p=line.trim().split(","),t=(p[0]||"").replace(/^[$!]/,"");
  if((t==="AIVDO"||t==="ABVDO")&&p[1]==="1"&&p[2]==="1"){
    try{const raw=bits(p[5]);const fill=Number((p[6]||"0").split("*")[0]);const b=fill?raw.slice(0,-fill):raw;if(![1,2,3].includes(u(b,0,6)))return null;const lon=si(b,61,28)/600000,lat=si(b,89,27)/600000,cogRaw=u(b,116,12),hdgRaw=u(b,128,9);if(Math.abs(lat)>90||Math.abs(lon)>180)return null;return{lat,lon,cog:cogRaw===3600?null:cogRaw/10,heading:hdgRaw===511?null:hdgRaw};}catch{return null}
  }
  if(/..HDT$/.test(t)){const h=Number(p[1]);return Number.isFinite(h)?{heading:norm(h)}:null}
  if(/..RMC$/.test(t)&&p[2]==="A"){const c=Number(p[8]);return Number.isFinite(c)?{cog:norm(c)}:null}
  return null;
}

function BridgeSky({stars,center}:{stars:StarSolution[];center:number}){
  const w=1000,h=560,left=55,right=945,top=35,horizon=455,maxAlt=75,fov=180;
  const shown=stars.map(s=>({...s,rel:signedRel(s.zn,center)})).filter(s=>Math.abs(s.rel)<=fov/2&&s.hc>=0&&s.hc<=maxAlt);
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-label="Bridge window star view">
    <rect x={left} y={top} width={right-left} height={horizon-top} fill="#020508" stroke="#334155"/>
    <rect x={left} y={horizon} width={right-left} height="65" fill="#07090b" stroke="#334155"/>
    {[10,20,30,45,60].map(a=>{const y=horizon-(a/maxAlt)*(horizon-top);return <g key={a}><line x1={left} x2={right} y1={y} y2={y} stroke="#18222d" strokeDasharray="5 7"/><text x={left+8} y={y-5} fill="#64748b" fontSize="13">{a}°</text></g>})}
    <line x1={left} x2={right} y1={horizon} y2={horizon} stroke="#c9a227" strokeWidth="2"/>
    <text x={left+8} y={horizon+19} fill="#c9a227" fontSize="13" fontWeight="800">HORIZON 0°</text>
    {[-90,-45,0,45,90].map(r=>{const x=left+((r+90)/180)*(right-left);return <g key={r}><line x1={x} x2={x} y1={top} y2={horizon} stroke={r===0?"#475569":"#16202a"} strokeDasharray={r===0?"":"4 8"}/><text x={x} y={542} textAnchor="middle" fill={r===0?"#fbbf24":"#94a3b8"} fontSize="14" fontWeight="800">{r===0?"LOOK":r<0?`P ${Math.abs(r)}°`:`S ${r}°`}</text></g>})}
    {shown.map(s=>{const x=left+((s.rel+90)/180)*(right-left);const y=horizon-(s.hc/maxAlt)*(horizon-top);return <g key={s.name}><circle cx={x} cy={y} r={s.mag<=1.5?5:3.5} fill={s.mag<=1.5?"#fbbf24":"#fca5a5"}/><text x={x+8} y={y-8} fill={s.mag<=1.5?"#fde68a":"#fecaca"} fontSize="13" fontWeight="800">{s.name}</text><text x={x+8} y={y+8} fill="#64748b" fontSize="10">{s.hc.toFixed(0)}° / {s.zn.toFixed(0)}°T</text></g>})}
  </svg>
}

export default function BridgeCelestial(){
 const [nav,setNav]=useState<NavState>({lat:13.4443,lon:144.7937,heading:null,cog:null});
 const [mode,setMode]=useState<ViewMode>("ahead"); const [status,setStatus]=useState("Connecting AIS…"); const [now,setNow]=useState(new Date());
 useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return()=>clearInterval(id)},[]);
 useEffect(()=>{let ws:WebSocket|null=null,retry:number|undefined,done=false;const connect=()=>{try{ws=new WebSocket(getAisWebSocketUrl());ws.onopen=()=>setStatus("AIS link connected");ws.onerror=()=>setStatus("AIS link unavailable");ws.onclose=()=>{setStatus("AIS link unavailable");if(!done)retry=window.setTimeout(connect,3000)};ws.onmessage=e=>{try{const m=JSON.parse(String(e.data));if(m?.type!=="nmea"||typeof m.line!=="string")return;const d=decode(m.line);if(d)setNav(v=>({...v,...d}))}catch{}}}catch{setStatus("AIS link unavailable")}};connect();return()=>{done=true;if(retry)clearTimeout(retry);ws?.close()}},[]);
 const base=nav.heading??nav.cog??0; const offset=mode==="port"?-90:mode==="starboard"?90:mode==="astern"?180:0; const center=norm(base+offset);
 const stars=useMemo(()=>solveNavStars(nav.lat,nav.lon,now),[nav.lat,nav.lon,now]);
 const labels:{id:ViewMode;label:string}[]=[{id:"port",label:"PORT"},{id:"ahead",label:"AHEAD"},{id:"starboard",label:"STARBOARD"},{id:"astern",label:"ASTERN"}];
 return <main className="min-h-screen bg-[#030609] px-4 py-5 text-slate-100 lg:px-6"><div className="mx-auto max-w-[1500px] space-y-4">
  <header className="border border-slate-700 bg-[#081019] p-4"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.24em] text-[#c9a227]">NavDash Celestial</div><h1 className="text-3xl font-black uppercase">Bridge Star View</h1><p className="text-sm font-semibold text-slate-400">Look-through-the-window orientation with a true horizon reference.</p></div><Link href="/celestial" className="border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-black uppercase">Horizon Plot</Link></div></header>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{labels.map(v=><button key={v.id} onClick={()=>setMode(v.id)} className={`border px-4 py-3 text-sm font-black tracking-wider ${mode===v.id?"border-[#c9a227] bg-[#c9a227] text-black":"border-slate-700 bg-[#0a1119] text-slate-200"}`}>{v.label}</button>)}</div>
  <section className="border border-slate-700 bg-[#05090d] p-3"><BridgeSky stars={stars} center={center}/></section>
  <section className="grid gap-2 text-xs font-black uppercase sm:grid-cols-4"><div className="border border-slate-800 bg-[#081019] p-3"><span className="text-slate-500">Looking</span><div className="text-xl text-[#fbbf24]">{center.toFixed(0)}° T</div></div><div className="border border-slate-800 bg-[#081019] p-3"><span className="text-slate-500">Reference</span><div className="text-xl">{nav.heading!==null?"HEADING":nav.cog!==null?"COG":"NORTH"}</div></div><div className="border border-slate-800 bg-[#081019] p-3"><span className="text-slate-500">Ship HDG / COG</span><div className="text-xl">{nav.heading?.toFixed(0)??"--"}° / {nav.cog?.toFixed(0)??"--"}°</div></div><div className="border border-slate-800 bg-[#081019] p-3"><span className="text-slate-500">Feed</span><div className="text-sm text-emerald-300">{status}</div></div></section>
  <p className="text-xs font-semibold text-slate-500">Bridge View uses true heading when available and COG as fallback. Star positions are for identification and planning; use current Nautical Almanac data and normal celestial-navigation procedures for sights and reductions.</p>
 </div></main>
}
