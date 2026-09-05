"use client";

import { useEffect, useMemo, useState } from "react";
import { getAisWebSocketUrl } from "../../../lib/aisWebSocket";
import { NAV_STARS, formatLatitude, formatLongitude, solveNavStars, type StarSolution } from "../../../lib/celestial";

type AppMode = "finder" | "planner" | "reduction" | "plot";
type ViewMode = "ahead" | "port" | "starboard" | "astern" | "360";
type NavState = { lat:number; lon:number; heading:number|null; cog:number|null };
type Sight = {
  id:string; body:string; time:string; apLat:number; apLon:number; hc:number; zn:number;
  hs:number; ic:number; dip:number; refraction:number; ho:number; intercept:number;
};

const norm=(v:number)=>((v%360)+360)%360;
const signedRel=(az:number,center:number)=>((az-center+540)%360)-180;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

function six(c:string){const n=c.charCodeAt(0);return n<88?n-48:n-56}
function bits(p:string){return p.split("").map(c=>six(c).toString(2).padStart(6,"0")).join("")}
function u(b:string,s:number,l:number){return parseInt(b.slice(s,s+l),2)}
function si(b:string,s:number,l:number){const v=u(b,s,l),t=2**(l-1);return v>=t?v-2**l:v}
function decode(line:string):Partial<NavState>|null{
  const p=line.trim().split(","),t=(p[0]||"").replace(/^[$!]/,"");
  if((t==="AIVDO"||t==="ABVDO")&&p[1]==="1"&&p[2]==="1"){
    try{
      const raw=bits(p[5]),fill=Number((p[6]||"0").split("*")[0]),b=fill?raw.slice(0,-fill):raw;
      if(![1,2,3].includes(u(b,0,6)))return null;
      const lon=si(b,61,28)/600000,lat=si(b,89,27)/600000,cogRaw=u(b,116,12),hdgRaw=u(b,128,9);
      if(Math.abs(lat)>90||Math.abs(lon)>180)return null;
      return{lat,lon,cog:cogRaw===3600?null:cogRaw/10,heading:hdgRaw===511?null:hdgRaw};
    }catch{return null}
  }
  if(/..HDT$/.test(t)){const h=Number(p[1]);return Number.isFinite(h)?{heading:norm(h)}:null}
  if(/..RMC$/.test(t)&&p[2]==="A"){
    const latRaw=p[3],ns=p[4],lonRaw=p[5],ew=p[6],c=Number(p[8]);
    const dd=(raw:string,isLat:boolean)=>{const k=isLat?2:3,d=Number(raw.slice(0,k)),m=Number(raw.slice(k));return d+m/60};
    const out:Partial<NavState>={};
    if(latRaw&&lonRaw){out.lat=dd(latRaw,true)*(ns==="S"?-1:1);out.lon=dd(lonRaw,false)*(ew==="W"?-1:1)}
    if(Number.isFinite(c))out.cog=norm(c);
    return out;
  }
  if(/..GGA$/.test(t)){
    const dd=(raw:string,isLat:boolean)=>{const k=isLat?2:3,d=Number(raw.slice(0,k)),m=Number(raw.slice(k));return d+m/60};
    if(p[2]&&p[4])return{lat:dd(p[2],true)*(p[3]==="S"?-1:1),lon:dd(p[4],false)*(p[5]==="W"?-1:1)};
  }
  return null;
}

function scoreSpread(stars:StarSolution[]){
  if(stars.length<3)return [];
  const usable=stars.filter(s=>s.hc>=15&&s.hc<=65&&s.name!=="Polaris").sort((a,b)=>a.mag-b.mag).slice(0,18);
  let best:StarSolution[]=[],bestScore=-1e9;
  for(let i=0;i<usable.length;i++)for(let j=i+1;j<usable.length;j++)for(let k=j+1;k<usable.length;k++){
    const set=[usable[i],usable[j],usable[k]];
    const az=set.map(s=>s.zn).sort((a,b)=>a-b);
    const gaps=[az[1]-az[0],az[2]-az[1],360-az[2]+az[0]];
    const minGap=Math.min(...gaps);
    const altPenalty=set.reduce((n,s)=>n+Math.abs(40-s.hc)*0.15,0);
    const magPenalty=set.reduce((n,s)=>n+Math.max(0,s.mag)*0.4,0);
    const score=minGap-altPenalty-magPenalty;
    if(score>bestScore){bestScore=score;best=set}
  }
  return best;
}

function BridgeSky({stars,center}:{stars:StarSolution[];center:number}){
  const w=1000,h=520,left=50,right=950,top=24,horizon=430,maxAlt=75;
  const shown=stars.map(s=>({...s,rel:signedRel(s.zn,center)})).filter(s=>Math.abs(s.rel)<=90&&s.hc>=0&&s.hc<=maxAlt);
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-label="Bridge window celestial star view">
    <rect x={left} y={top} width={right-left} height={horizon-top} fill="#020508" stroke="#1d3a52"/>
    <rect x={left} y={horizon} width={right-left} height="52" fill="#06111f" stroke="#1d3a52"/>
    {[10,20,30,45,60].map(a=>{const y=horizon-(a/maxAlt)*(horizon-top);return <g key={a}><line x1={left} x2={right} y1={y} y2={y} stroke="#18222d" strokeDasharray="5 7"/><text x={left+8} y={y-5} fill="#708496" fontSize="12">{a}°</text></g>})}
    <line x1={left} x2={right} y1={horizon} y2={horizon} stroke="#f2b84b" strokeWidth="3"/>
    <text x={left+8} y={horizon+18} fill="#f0c46a" fontSize="12" fontWeight="800">HORIZON 0°</text>
    {[-90,-45,0,45,90].map(r=>{const x=left+((r+90)/180)*(right-left);return <g key={r}><line x1={x} x2={x} y1={top} y2={horizon} stroke={r===0?"#526879":"#16202a"} strokeDasharray={r===0?"":"4 8"}/><text x={x} y={505} textAnchor="middle" fill={r===0?"#f0c46a":"#7f9caf"} fontSize="13" fontWeight="800">{r===0?"LOOK":r<0?`P ${Math.abs(r)}°`:`S ${r}°`}</text></g>})}
    {shown.map(s=>{const x=left+((s.rel+90)/180)*(right-left),y=horizon-(s.hc/maxAlt)*(horizon-top),bright=s.mag<=1.5;return <g key={s.name}><circle cx={x} cy={y} r={bright?5:3.5} fill={bright?"#f0c46a":"#fca5a5"}/><text x={x+8} y={y-7} fill={bright?"#f0c46a":"#fecaca"} fontSize="12" fontWeight="800">{s.name}</text><text x={x+8} y={y+8} fill="#708496" fontSize="9">Hc {s.hc.toFixed(0)}° · Zn {s.zn.toFixed(0)}°T</text></g>})}
  </svg>
}

function Horizon360({stars}:{stars:StarSolution[]}){
  const size=650,c=size/2,radius=280,shown=stars.filter(s=>s.hc>=0&&s.hc<=90);
  return <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[680px]" aria-label="360 degree star horizon plot">
    <circle cx={c} cy={c} r={radius} fill="#020508" stroke="#526879" strokeWidth="2"/>
    {[10,20,30,45,60].map(alt=>{const r=((90-alt)/90)*radius;return <circle key={alt} cx={c} cy={c} r={r} fill="none" stroke="#253342" strokeDasharray="5 7"/>})}
    {[0,90,180,270].map(az=>{const a=az*Math.PI/180;return <line key={az} x1={c} y1={c} x2={c+radius*Math.sin(a)} y2={c-radius*Math.cos(a)} stroke="#1d3a52"/>})}
    <text x={c} y="22" textAnchor="middle" fill="#f0c46a" fontWeight="800">N 000°</text><text x={size-8} y={c+5} textAnchor="end" fill="#f0c46a" fontWeight="800">E 090°</text><text x={c} y={size-8} textAnchor="middle" fill="#f0c46a" fontWeight="800">S 180°</text><text x="8" y={c+5} fill="#f0c46a" fontWeight="800">W 270°</text>
    {shown.map(s=>{const r=((90-s.hc)/90)*radius,a=s.zn*Math.PI/180,x=c+r*Math.sin(a),y=c-r*Math.cos(a),bright=s.mag<=1.5;return <g key={s.name}><circle cx={x} cy={y} r={bright?5:3.5} fill={bright?"#f0c46a":"#fca5a5"}/><text x={x+7} y={y-6} fill={bright?"#f0c46a":"#fecaca"} fontSize="11" fontWeight="800">{s.name}</text></g>})}
  </svg>
}

function LopPlot({sights,apLat,apLon}:{sights:Sight[];apLat:number;apLon:number}){
  const size=620,c=size/2,scale=4.2;
  const lines=sights.slice(-6);
  let fix:{x:number;y:number}|null=null;
  if(lines.length>=2){
    let aa=0,ab=0,bb=0,ac=0,bc=0;
    lines.forEach(s=>{const z=s.zn*Math.PI/180,nx=Math.sin(z),ny=Math.cos(z);aa+=nx*nx;ab+=nx*ny;bb+=ny*ny;ac+=nx*s.intercept;bc+=ny*s.intercept});
    const det=aa*bb-ab*ab;
    if(Math.abs(det)>0.02)fix={x:(ac*bb-bc*ab)/det,y:(aa*bc-ab*ac)/det};
  }
  const toPx=(x:number,y:number)=>({x:c+x*scale,y:c-y*scale});
  return <div>
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[680px]" aria-label="Celestial line of position plot">
      <rect x="1" y="1" width={size-2} height={size-2} fill="#020508" stroke="#1d3a52"/>
      {[-60,-40,-20,0,20,40,60].map(n=><g key={n}><line x1={c+n*scale} y1="0" x2={c+n*scale} y2={size} stroke={n===0?"#526879":"#16202a"}/><line x1="0" y1={c-n*scale} x2={size} y2={c-n*scale} stroke={n===0?"#526879":"#16202a"}/></g>)}
      <text x={c+6} y="16" fill="#7f9caf" fontSize="10">N</text><text x={size-18} y={c-6} fill="#7f9caf" fontSize="10">E</text>
      {lines.map((s,i)=>{const z=s.zn*Math.PI/180,nx=Math.sin(z),ny=Math.cos(z),px=nx*s.intercept,py=ny*s.intercept,dx=Math.cos(z),dy=-Math.sin(z),p1=toPx(px-dx*100,py-dy*100),p2=toPx(px+dx*100,py+dy*100),p=toPx(px,py);return <g key={s.id}><line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={i%2===0?"#f0c46a":"#56bad0"} strokeWidth="2"/><circle cx={p.x} cy={p.y} r="4" fill="#edf4fa"/><text x={p.x+7} y={p.y-7} fill="#aebdca" fontSize="9">{s.body}</text></g>})}
      <circle cx={c} cy={c} r="5" fill="#f87171"/><text x={c+8} y={c+15} fill="#fca5a5" fontSize="10">AP</text>
      {fix&&(()=>{const p=toPx(fix.x,fix.y);return <g><circle cx={p.x} cy={p.y} r="7" fill="#34d399"/><circle cx={p.x} cy={p.y} r="13" fill="none" stroke="#34d399"/><text x={p.x+10} y={p.y-10} fill="#6ee7b7" fontSize="10">FIX</text></g>})()}
    </svg>
    {fix?<div className="mt-2 text-xs text-[#aebdca]">Least-squares intersection: {fix.y>=0?`${fix.y.toFixed(1)} NM N`:`${Math.abs(fix.y).toFixed(1)} NM S`} · {fix.x>=0?`${fix.x.toFixed(1)} NM E`:`${Math.abs(fix.x).toFixed(1)} NM W`} of AP. Approx {formatLatitude(apLat+fix.y/60)} / {formatLongitude(apLon+fix.x/(60*Math.cos(apLat*Math.PI/180)))}</div>:<div className="mt-2 text-xs text-[#708496]">Add at least two non-parallel sights to solve an intersection.</div>}
  </div>
}

export default function BridgeCelestial(){
  const [nav,setNav]=useState<NavState>({lat:13.4443,lon:144.7937,heading:null,cog:null});
  const [status,setStatus]=useState("Connecting AIS…");
  const [now,setNow]=useState(new Date());
  const [mode,setMode]=useState<AppMode>("finder");
  const [view,setView]=useState<ViewMode>("ahead");
  const [plannerTime,setPlannerTime]=useState(new Date().toISOString().slice(0,16));
  const [body,setBody]=useState("Vega");
  const [hsDeg,setHsDeg]=useState("30");
  const [hsMin,setHsMin]=useState("00.0");
  const [ic,setIc]=useState("0.0");
  const [eye,setEye]=useState("10");
  const [sights,setSights]=useState<Sight[]>([]);
  const [hideGps,setHideGps]=useState(false);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return()=>clearInterval(id)},[]);
  useEffect(()=>{
    let ws:WebSocket|null=null,retry:number|undefined,done=false;
    const connect=()=>{try{
      ws=new WebSocket(getAisWebSocketUrl());
      ws.onopen=()=>setStatus("AIS LIVE");
      ws.onerror=()=>setStatus("AIS UNAVAILABLE");
      ws.onclose=()=>{setStatus("AIS UNAVAILABLE");if(!done)retry=window.setTimeout(connect,3000)};
      ws.onmessage=e=>{try{const m=JSON.parse(String(e.data));if(m?.type!=="nmea"||typeof m.line!=="string")return;const d=decode(m.line);if(d)setNav(v=>({...v,...d}))}catch{}};
    }catch{setStatus("AIS UNAVAILABLE")}};
    connect();return()=>{done=true;if(retry)clearTimeout(retry);ws?.close()};
  },[]);

  const stars=useMemo(()=>solveNavStars(nav.lat,nav.lon,now),[nav.lat,nav.lon,now]);
  const planDate=useMemo(()=>{const d=new Date(plannerTime);return Number.isNaN(d.getTime())?now:d},[plannerTime,now]);
  const plannedStars=useMemo(()=>solveNavStars(nav.lat,nav.lon,planDate),[nav.lat,nav.lon,planDate]);
  const usable=useMemo(()=>plannedStars.filter(s=>s.hc>=15&&s.hc<=65).sort((a,b)=>a.mag-b.mag),[plannedStars]);
  const best3=useMemo(()=>scoreSpread(plannedStars),[plannedStars]);
  const base=nav.heading??nav.cog??0,offset=view==="port"?-90:view==="starboard"?90:view==="astern"?180:0,center=norm(base+offset);
  const selected=stars.find(s=>s.name===body)??stars[0];

  const reduction=useMemo(()=>{
    const deg=clamp(Number(hsDeg)||0,-10,90),min=clamp(Number(hsMin)||0,0,59.999),hs=deg+min/60;
    const icMin=clamp(Number(ic)||0,-20,20),eyeM=clamp(Number(eye)||0,0,100);
    const dip=-1.76*Math.sqrt(eyeM);
    const alt=Math.max(1,hs);
    const ref=-0.97/Math.tan((alt+10.3/(alt+5.11))*Math.PI/180);
    const ho=hs+(icMin+dip+ref)/60,intercept=(ho-selected.hc)*60;
    return{hs,ic:icMin,dip,refraction:ref,ho,intercept};
  },[hsDeg,hsMin,ic,eye,selected.hc]);

  const addSight=()=>{
    const s:Sight={id:`${Date.now()}-${body}`,body,time:now.toISOString(),apLat:nav.lat,apLon:nav.lon,hc:selected.hc,zn:selected.zn,hs:reduction.hs,ic:reduction.ic,dip:reduction.dip,refraction:reduction.refraction,ho:reduction.ho,intercept:reduction.intercept};
    setSights(v=>[...v,s].slice(-12));setMode("plot");
  };

  const bannerModes:[AppMode,string][]=[["finder","STAR FINDER"],["planner","SIGHT PLANNER"],["reduction","SIGHT REDUCTION"],["plot","PLOT"]];
  const viewModes:[ViewMode,string][]=[["port","PORT"],["ahead","AHEAD"],["starboard","STARBOARD"],["astern","ASTERN"],["360","360°"]];

  const card="border border-[#1d3a52] bg-[#06111f]";
  const label="text-[9px] font-black uppercase tracking-[.16em] text-[#708496]";
  const btn="h-9 border border-[#33485a] bg-[#08121b] px-3 text-[10px] font-black tracking-[.08em] text-[#c7d2dc] hover:border-[#f2b84b]/60";
  const active="border-[#f2b84b] bg-[#f2b84b] text-[#06111f]";

  return <main className="min-h-screen bg-[#040d18] text-[#dbe5ee]">
    <style jsx global>{`.navdash-global-nav{display:block}`}</style>
    <div className="p-[6px]">
      <header className="mb-[5px] border border-[#f2b84b]/30 bg-[#06111f]">
        <div className="grid min-h-[46px] grid-cols-1 items-center gap-2 px-3 py-2 xl:grid-cols-[260px_1fr_180px] xl:py-0">
          <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center border border-[#f2b84b] font-black text-[#f0c46a]">N</span><span className="leading-none"><b className="block text-[11px] tracking-[.08em]">NAVDASH</b><small className="mt-1 block text-[8px] tracking-[.14em] text-[#7f9caf]">M/V MB480 · CELESTIAL CONSOLE</small></span></div>
          <div className="flex flex-wrap justify-center gap-1">
            {bannerModes.map(([id,text])=><button key={id} onClick={()=>setMode(id)} className={`${btn} ${mode===id?active:""}`}>{text}</button>)}
          </div>
          <div className="flex items-center justify-end gap-2 text-[9px] font-black tracking-[.12em]"><span className={status==="AIS LIVE"?"text-[#56bad0]":"text-amber-400"}>{status}</span><span className="text-[#f0c46a]">{now.toISOString().slice(11,19)} UTC</span><a href="/" className={`${btn} inline-flex items-center`}>MAIN</a></div>
        </div>
      </header>

      {mode==="finder"&&<div className="grid gap-[5px] xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className={card}>
          <div className="flex flex-wrap items-center gap-1 border-b border-[#1d3a52] p-2">{viewModes.map(([id,text])=><button key={id} onClick={()=>setView(id)} className={`${btn} ${view===id?active:""}`}>{text}</button>)}</div>
          <div className="p-2">{view==="360"?<Horizon360 stars={stars}/>:<BridgeSky stars={stars} center={center}/>}</div>
        </section>
        <aside className={card}>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>VIEW</div><div className="mt-1 text-2xl font-black text-[#f0c46a]">{view==="360"?"360° TRUE":`${center.toFixed(0)}° T`}</div></div>
          <div className="grid grid-cols-2">
            <div className="border-b border-r border-[#1d3a52] p-3"><div className={label}>HDG</div><div className="mt-1 text-2xl font-black">{nav.heading?.toFixed(0)??"--"}°</div></div>
            <div className="border-b border-[#1d3a52] p-3"><div className={label}>COG</div><div className="mt-1 text-2xl font-black">{nav.cog?.toFixed(0)??"--"}°</div></div>
          </div>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>POSITION</div><div className="mt-2 text-sm font-black text-[#56bad0]">{hideGps?"GPS HIDDEN":<>{formatLatitude(nav.lat)}<br/>{formatLongitude(nav.lon)}</>}</div><button onClick={()=>setHideGps(v=>!v)} className={`${btn} mt-3`}>{hideGps?"SHOW GPS":"HIDE GPS"}</button></div>
          <div className="p-3 text-[10px] leading-5 text-[#7f9caf]">Heading is primary orientation. COG is fallback. Rounded star data is for identification and planning.</div>
        </aside>
      </div>}

      {mode==="planner"&&<div className="grid gap-[5px] xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className={card}>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>PLANNING UTC</div><input type="datetime-local" value={plannerTime} onChange={e=>setPlannerTime(e.target.value)} className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2 text-sm text-[#dbe5ee]"/></div>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>BEST 3-STAR SPREAD</div><div className="mt-2 space-y-2">{best3.map(s=><div key={s.name} className="grid grid-cols-[1fr_auto] gap-3 border border-[#1d3a52] bg-[#050a0f] p-2"><b className="text-[#f0c46a]">{s.name}</b><span className="text-xs">{s.zn.toFixed(0)}°T / {s.hc.toFixed(0)}°</span></div>)}</div></div>
          <div className="p-3 text-[10px] leading-5 text-[#7f9caf]">Planner favors bright stars between 15° and 65° and maximizes azimuth separation. Polaris is excluded from the 3-star geometry pick but remains available below.</div>
        </aside>
        <section className={card}>
          <div className="grid grid-cols-[1fr_90px_90px_80px] border-b border-[#1d3a52] p-2 text-[9px] font-black tracking-[.12em] text-[#708496]"><span>BODY</span><span>Zn</span><span>Hc</span><span>MAG</span></div>
          <div>{usable.slice(0,20).map(s=><button key={s.name} onClick={()=>{setBody(s.name);setMode("reduction")}} className="grid w-full grid-cols-[1fr_90px_90px_80px] border-b border-[#18222d] p-2 text-left text-xs hover:bg-[#0a151f]"><b className={best3.some(b=>b.name===s.name)?"text-[#f0c46a]":"text-[#dbe5ee]"}>{s.name}{s.name==="Polaris"?" · POLARIS":""}</b><span>{s.zn.toFixed(1)}°</span><span>{s.hc.toFixed(1)}°</span><span>{s.mag.toFixed(1)}</span></button>)}</div>
        </section>
      </div>}

      {mode==="reduction"&&<div className="grid gap-[5px] xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className={card}>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>STAR / BODY</div><select value={body} onChange={e=>setBody(e.target.value)} className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2 text-sm">{NAV_STARS.map(s=><option key={s.name}>{s.name}</option>)}</select></div>
          <div className="grid grid-cols-2 border-b border-[#1d3a52]">
            <label className="border-r border-[#1d3a52] p-3"><span className={label}>Hs DEGREES</span><input value={hsDeg} onChange={e=>setHsDeg(e.target.value)} inputMode="decimal" className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2 text-lg font-black"/></label>
            <label className="p-3"><span className={label}>Hs MINUTES</span><input value={hsMin} onChange={e=>setHsMin(e.target.value)} inputMode="decimal" className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2 text-lg font-black"/></label>
          </div>
          <div className="grid grid-cols-2 border-b border-[#1d3a52]">
            <label className="border-r border-[#1d3a52] p-3"><span className={label}>INDEX CORR ' (+/-)</span><input value={ic} onChange={e=>setIc(e.target.value)} inputMode="decimal" className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2"/></label>
            <label className="p-3"><span className={label}>HEIGHT EYE m</span><input value={eye} onChange={e=>setEye(e.target.value)} inputMode="decimal" className="mt-2 w-full border border-[#33485a] bg-[#040d18] p-2"/></label>
          </div>
          <button onClick={addSight} className="m-3 h-10 border border-[#f2b84b] bg-[#f2b84b] px-4 text-xs font-black text-[#06111f]">ADD SIGHT TO PLOT</button>
        </aside>
        <section className={card}>
          <div className="border-b border-[#1d3a52] p-3"><div className={label}>REDUCTION · {selected.name}</div><div className="mt-1 text-sm text-[#7f9caf]">UTC {now.toISOString().slice(11,19)} · AP {formatLatitude(nav.lat)} / {formatLongitude(nav.lon)}</div></div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4">
            {[["Hs",`${reduction.hs.toFixed(4)}°`],["IC",`${reduction.ic.toFixed(2)}'`],["Dip",`${reduction.dip.toFixed(2)}'`],["Refraction",`${reduction.refraction.toFixed(2)}'`],["Ho",`${reduction.ho.toFixed(4)}°`],["Hc",`${selected.hc.toFixed(4)}°`],["Zn",`${selected.zn.toFixed(1)}°T`],["Intercept",`${Math.abs(reduction.intercept).toFixed(1)} NM ${reduction.intercept>=0?"TOWARD":"AWAY"}`]].map(([a,b],i)=><div key={a} className={`p-4 ${i%4<3?"xl:border-r":""} border-b border-[#1d3a52]`}><div className={label}>{a}</div><div className={`mt-2 text-xl font-black ${a==="Intercept"?"text-[#f0c46a]":""}`}>{b}</div></div>)}
          </div>
          <div className="p-3 text-[10px] leading-5 text-amber-200/80"><b>STAR REDUCTION CHECK:</b> Dip and standard refraction are approximate. The built-in star SHA/declination values are rounded for identification/planning, so use current Nautical Almanac data and normal sight-reduction procedures for navigational results.</div>
        </section>
      </div>}

      {mode==="plot"&&<div className="grid gap-[5px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className={`${card} p-2`}><LopPlot sights={sights} apLat={nav.lat} apLon={nav.lon}/></section>
        <aside className={card}>
          <div className="flex items-center justify-between border-b border-[#1d3a52] p-3"><div><div className={label}>SIGHT LOG</div><b className="text-lg">{sights.length} LOP{sights.length===1?"":"s"}</b></div><button onClick={()=>setSights([])} className={btn}>CLEAR</button></div>
          <div>{sights.slice().reverse().map(s=><div key={s.id} className="border-b border-[#18222d] p-3"><div className="flex justify-between gap-2"><b className="text-[#f0c46a]">{s.body}</b><span className="text-xs text-[#7f9caf]">{s.time.slice(11,19)}Z</span></div><div className="mt-1 text-xs">Zn {s.zn.toFixed(1)}° · Hc {s.hc.toFixed(3)}° · Ho {s.ho.toFixed(3)}°</div><div className="mt-1 text-xs font-black">{Math.abs(s.intercept).toFixed(1)} NM {s.intercept>=0?"T":"A"}</div></div>)}</div>
          {!sights.length&&<div className="p-4 text-xs text-[#708496]">No sights stored. Reduce a star and tap ADD SIGHT TO PLOT.</div>}
        </aside>
      </div>}

      <footer className="mt-[5px] border border-[#1d3a52] bg-[#06111f] px-3 py-2 text-[9px] leading-4 text-[#708496]">CELESTIAL WORKSTATION · Planning and training aid. Do not substitute rounded internal star data or computed output for the current Nautical Almanac, approved publications, required navigation equipment, or the navigator’s independent checks.</footer>
    </div>
  </main>
}
