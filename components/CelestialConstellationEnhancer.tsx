"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import { NAV_STARS, solveStar, type NavStar, type StarSolution } from "../lib/celestial";

type NavState = { lat:number; lon:number; heading:number|null; cog:number|null };
type SkyTarget = { svg:SVGSVGElement; host:HTMLElement; mode:"bridge"|"360" };
type HelperStar = NavStar & { id:string; constellation:string };
type Constellation = { name:string; segments:[string,string][] };
type DrawStar = StarSolution & { id:string; constellation:string; helper:boolean };

const norm=(v:number)=>((v%360)+360)%360;
const signedRel=(az:number,center:number)=>((az-center+540)%360)-180;
const raToSha=(hours:number,minutes=0)=>norm(360-(hours+minutes/60)*15);

function helper(id:string,h:number,m:number,dec:number,mag:number,constellation:string):HelperStar{
  return { no:0, id, name:id, sha:raToSha(h,m), dec, mag, constellation };
}

// Bright pattern stars used only for visual identification. Positions are rounded,
// matching the planning-grade precision of the existing NavDash star finder.
const HELPERS:HelperStar[]=[
  helper("Caph",0,9,59.1,2.3,"Cassiopeia"),helper("Navi",0,57,60.7,2.2,"Cassiopeia"),helper("Ruchbah",1,26,60.2,2.7,"Cassiopeia"),helper("Segin",1,54,63.7,3.4,"Cassiopeia"),
  helper("Mirach",1,10,35.6,2.1,"Andromeda"),helper("Almach",2,4,42.3,2.1,"Andromeda"),
  helper("Sheratan",1,55,20.8,2.6,"Aries"),helper("Mesarthim",1,53,19.3,3.9,"Aries"),
  helper("Algol",3,8,41.0,2.1,"Perseus"),helper("Mira",2,19,-3.0,3.0,"Cetus"),helper("Kaffaljidhma",2,43,3.2,3.5,"Cetus"),
  helper("Zibal",3,16,-8.8,4.8,"Eridanus"),helper("Cursa",5,8,-5.1,2.8,"Eridanus"),helper("Alcyone",3,47,24.1,2.9,"Taurus"),helper("Hyadum I",4,20,15.6,3.7,"Taurus"),
  helper("Menkalinan",5,59,44.9,1.9,"Auriga"),helper("Mintaka",5,32,-0.3,2.2,"Orion"),helper("Alnitak",5,41,-1.9,1.8,"Orion"),helper("Saiph",5,48,-9.7,2.1,"Orion"),
  helper("Mirzam",6,23,-18.0,2.0,"Canis Major"),helper("Wezen",7,8,-26.4,1.8,"Canis Major"),helper("Aludra",7,24,-29.3,2.4,"Canis Major"),helper("Gomeisa",7,27,8.3,2.9,"Canis Minor"),
  helper("Castor",7,35,31.9,1.6,"Gemini"),helper("Alhena",6,38,16.4,1.9,"Gemini"),helper("Zeta Hya",8,55,5.9,3.1,"Hydra"),helper("Gamma Hya",13,19,-23.2,3.0,"Hydra"),
  helper("Algieba",10,20,19.8,2.0,"Leo"),helper("Zosma",11,14,20.5,2.6,"Leo"),helper("Merak",11,2,56.4,2.4,"Ursa Major"),helper("Phecda",11,54,53.7,2.4,"Ursa Major"),
  helper("Megrez",12,15,57.0,3.3,"Ursa Major"),helper("Mizar",13,24,54.9,2.2,"Ursa Major"),helper("Kraz",12,34,-23.4,2.7,"Corvus"),helper("Algorab",12,30,-16.5,3.0,"Corvus"),helper("Minkar",12,10,-22.6,3.0,"Corvus"),
  helper("Mimosa",12,48,-59.7,1.3,"Crux"),helper("Delta Cru",12,15,-58.7,2.8,"Crux"),helper("Vindemiatrix",13,2,11.0,2.8,"Virgo"),helper("Porrima",12,42,-1.4,2.7,"Virgo"),helper("Muhlifain",12,42,-48.9,2.2,"Centaurus"),
  helper("Zubeneschamali",15,17,-9.4,2.6,"Libra"),helper("Pherkad",15,21,71.8,3.0,"Ursa Minor"),helper("Yildun",17,32,86.6,4.4,"Ursa Minor"),helper("Nusakan",15,28,29.1,3.7,"Corona Borealis"),helper("Gamma CrB",15,43,26.3,3.8,"Corona Borealis"),
  helper("Dschubba",16,0,-22.6,2.3,"Scorpius"),helper("Sargas",17,37,-43.0,1.9,"Scorpius"),helper("Lesath",17,31,-37.3,2.7,"Scorpius"),helper("Cebalrai",17,43,4.6,2.8,"Ophiuchus"),helper("Rastaban",17,30,52.3,2.8,"Draco"),helper("Grumium",17,54,56.9,3.8,"Draco"),
  helper("Kaus Media",18,21,-29.8,2.7,"Sagittarius"),helper("Kaus Borealis",18,28,-25.4,2.8,"Sagittarius"),helper("Ascella",19,3,-29.9,2.6,"Sagittarius"),helper("Sheliak",18,50,33.4,3.5,"Lyra"),helper("Sulafat",18,59,32.7,3.3,"Lyra"),
  helper("Tarazed",19,46,10.6,2.7,"Aquila"),helper("Alshain",19,55,6.4,3.7,"Aquila"),helper("Sadr",20,22,40.3,2.2,"Cygnus"),helper("Gienah Cyg",20,46,34.0,2.5,"Cygnus"),helper("Albireo",19,31,28.0,3.1,"Cygnus"),
  helper("Scheat",23,4,28.1,2.4,"Pegasus"),helper("Algenib",0,13,15.2,2.8,"Pegasus"),helper("Tiaki",22,43,-46.9,2.1,"Grus"),helper("Epsilon PsA",22,40,-27.0,4.2,"Piscis Austrinus"),helper("Beta Pav",20,45,-66.2,3.4,"Pavo"),
  helper("Beta TrA",15,55,-63.4,2.8,"Triangulum Australe"),helper("Gamma TrA",15,19,-68.7,2.9,"Triangulum Australe"),helper("Beta Phe",1,6,-46.7,3.3,"Phoenix"),helper("Regor",8,10,-47.3,1.8,"Vela"),helper("Aspidiske",9,17,-59.3,2.2,"Carina"),
];

const C:Constellation[]=[
  {name:"Cassiopeia",segments:[["Caph","Schedar"],["Schedar","Navi"],["Navi","Ruchbah"],["Ruchbah","Segin"]]},
  {name:"Andromeda",segments:[["Alpheratz","Mirach"],["Mirach","Almach"]]}, {name:"Aries",segments:[["Hamal","Sheratan"],["Sheratan","Mesarthim"]]}, {name:"Perseus",segments:[["Mirfak","Algol"]]},
  {name:"Cetus",segments:[["Diphda","Mira"],["Mira","Kaffaljidhma"],["Kaffaljidhma","Menkar"]]}, {name:"Eridanus",segments:[["Achernar","Acamar"],["Acamar","Zibal"],["Zibal","Cursa"]]},
  {name:"Taurus",segments:[["Aldebaran","Hyadum I"],["Aldebaran","Alcyone"],["Aldebaran","Elnath"]]}, {name:"Auriga",segments:[["Capella","Menkalinan"],["Menkalinan","Elnath"]]},
  {name:"Orion",segments:[["Betelgeuse","Bellatrix"],["Bellatrix","Mintaka"],["Mintaka","Alnilam"],["Alnilam","Alnitak"],["Alnitak","Saiph"],["Saiph","Rigel"],["Rigel","Mintaka"],["Alnitak","Betelgeuse"]]},
  {name:"Canis Major",segments:[["Sirius","Mirzam"],["Sirius","Wezen"],["Wezen","Adhara"],["Adhara","Aludra"]]}, {name:"Canis Minor",segments:[["Procyon","Gomeisa"]]}, {name:"Gemini",segments:[["Castor","Pollux"],["Pollux","Alhena"]]},
  {name:"Hydra",segments:[["Zeta Hya","Alphard"],["Alphard","Gamma Hya"]]}, {name:"Leo",segments:[["Regulus","Algieba"],["Algieba","Zosma"],["Zosma","Denebola"]]},
  {name:"Ursa Major",segments:[["Dubhe","Merak"],["Merak","Phecda"],["Phecda","Megrez"],["Megrez","Dubhe"],["Megrez","Alioth"],["Alioth","Mizar"],["Mizar","Alkaid"]]},
  {name:"Corvus",segments:[["Gienah","Algorab"],["Algorab","Kraz"],["Kraz","Minkar"],["Minkar","Gienah"]]}, {name:"Crux",segments:[["Gacrux","Acrux"],["Mimosa","Delta Cru"]]}, {name:"Virgo",segments:[["Vindemiatrix","Porrima"],["Porrima","Spica"]]},
  {name:"Centaurus",segments:[["Rigil Kentaurus","Hadar"],["Hadar","Muhlifain"],["Muhlifain","Menkent"]]}, {name:"Libra",segments:[["Zubenelgenubi","Zubeneschamali"]]},
  {name:"Ursa Minor",segments:[["Polaris","Yildun"],["Yildun","Kochab"],["Kochab","Pherkad"]]}, {name:"Corona Borealis",segments:[["Nusakan","Alphecca"],["Alphecca","Gamma CrB"]]},
  {name:"Scorpius",segments:[["Dschubba","Antares"],["Antares","Sargas"],["Sargas","Shaula"],["Shaula","Lesath"]]}, {name:"Ophiuchus",segments:[["Rasalhague","Cebalrai"],["Cebalrai","Sabik"]]}, {name:"Draco",segments:[["Rastaban","Eltanin"],["Eltanin","Grumium"]]},
  {name:"Sagittarius",segments:[["Kaus Borealis","Kaus Media"],["Kaus Media","Kaus Australis"],["Kaus Australis","Ascella"],["Ascella","Nunki"],["Nunki","Kaus Borealis"]]}, {name:"Lyra",segments:[["Vega","Sheliak"],["Sheliak","Sulafat"],["Sulafat","Vega"]]},
  {name:"Aquila",segments:[["Tarazed","Altair"],["Altair","Alshain"]]}, {name:"Cygnus",segments:[["Deneb","Sadr"],["Sadr","Albireo"],["Gienah Cyg","Sadr"]]},
  {name:"Pegasus",segments:[["Markab","Scheat"],["Scheat","Alpheratz"],["Alpheratz","Algenib"],["Algenib","Markab"],["Markab","Enif"]]}, {name:"Grus",segments:[["Al Na'ir","Tiaki"]]}, {name:"Piscis Austrinus",segments:[["Fomalhaut","Epsilon PsA"]]},
  {name:"Pavo",segments:[["Peacock","Beta Pav"]]}, {name:"Triangulum Australe",segments:[["Atria","Beta TrA"],["Beta TrA","Gamma TrA"],["Gamma TrA","Atria"]]}, {name:"Phoenix",segments:[["Ankaa","Beta Phe"]]},
  {name:"Carina",segments:[["Canopus","Avior"],["Avior","Miaplacidus"],["Miaplacidus","Aspidiske"]]}, {name:"Vela",segments:[["Suhail","Regor"]]},
];

const CONSTELLATION_BY_STAR=new Map<string,string>();
C.forEach(c=>c.segments.forEach(([a,b])=>{if(!CONSTELLATION_BY_STAR.has(a))CONSTELLATION_BY_STAR.set(a,c.name);if(!CONSTELLATION_BY_STAR.has(b))CONSTELLATION_BY_STAR.set(b,c.name)}));

function six(ch:string){const n=ch.charCodeAt(0);return n<88?n-48:n-56}
function bits(payload:string){return payload.split("").map(ch=>six(ch).toString(2).padStart(6,"0")).join("")}
function u(b:string,s:number,l:number){return parseInt(b.slice(s,s+l),2)}
function si(b:string,s:number,l:number){const v=u(b,s,l),t=2**(l-1);return v>=t?v-2**l:v}
function decode(line:string):Partial<NavState>|null{
  const p=line.trim().split(","),t=(p[0]||"").replace(/^[$!]/,"");
  if((t==="AIVDO"||t==="ABVDO")&&p[1]==="1"&&p[2]==="1"){
    try{const raw=bits(p[5]),fill=Number((p[6]||"0").split("*")[0]),b=fill?raw.slice(0,-fill):raw;if(![1,2,3].includes(u(b,0,6)))return null;const lon=si(b,61,28)/600000,lat=si(b,89,27)/600000,cogRaw=u(b,116,12),hdgRaw=u(b,128,9);if(Math.abs(lat)>90||Math.abs(lon)>180)return null;return{lat,lon,cog:cogRaw===3600?null:cogRaw/10,heading:hdgRaw===511?null:hdgRaw};}catch{return null}
  }
  if(/..HDT$/.test(t)){const h=Number(p[1]);return Number.isFinite(h)?{heading:norm(h)}:null}
  if(/..RMC$/.test(t)&&p[2]==="A"){const dd=(raw:string,isLat:boolean)=>{const k=isLat?2:3,d=Number(raw.slice(0,k)),m=Number(raw.slice(k));return d+m/60};const out:Partial<NavState>={};if(p[3]&&p[5]){out.lat=dd(p[3],true)*(p[4]==="S"?-1:1);out.lon=dd(p[5],false)*(p[6]==="W"?-1:1)}const c=Number(p[8]);if(Number.isFinite(c))out.cog=norm(c);return out;}
  if(/..GGA$/.test(t)&&p[2]&&p[4]){const dd=(raw:string,isLat:boolean)=>{const k=isLat?2:3,d=Number(raw.slice(0,k)),m=Number(raw.slice(k));return d+m/60};return{lat:dd(p[2],true)*(p[3]==="S"?-1:1),lon:dd(p[4],false)*(p[5]==="W"?-1:1)}}
  return null;
}

function readBridgeCenter(fallback:number){const candidates=Array.from(document.querySelectorAll("div"));for(const el of candidates){const text=el.textContent?.trim()||"";const match=text.match(/^(\d{1,3}(?:\.\d+)?)° T$/);if(match)return norm(Number(match[1]));}return fallback;}
function projectBridge(s:DrawStar,center:number){const left=50,right=950,top=24,horizon=430,maxAlt=75,rel=signedRel(s.zn,center);if(Math.abs(rel)>90||s.hc<0||s.hc>maxAlt)return null;return{x:left+((rel+90)/180)*(right-left),y:horizon-(s.hc/maxAlt)*(horizon-top)};}
function project360(s:DrawStar){const c=325,radius=280;if(s.hc<0||s.hc>90)return null;const r=((90-s.hc)/90)*radius,a=s.zn*Math.PI/180;return{x:c+r*Math.sin(a),y:c-r*Math.cos(a)};}

export default function CelestialConstellationEnhancer(){
  const [nav,setNav]=useState<NavState>({lat:13.4443,lon:144.7937,heading:null,cog:null});
  const [now,setNow]=useState(()=>new Date());
  const [target,setTarget]=useState<SkyTarget|null>(null);
  const [constellations,setConstellations]=useState(true);
  const [fieldStars,setFieldStars]=useState(true);
  const [selected,setSelected]=useState<DrawStar|null>(null);
  const [center,setCenter]=useState(0);

  useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),15000);return()=>window.clearInterval(id)},[]);
  useEffect(()=>{let ws:WebSocket|null=null,retry:number|undefined,done=false;const connect=()=>{try{ws=new WebSocket(getAisWebSocketUrl());ws.onclose=()=>{if(!done)retry=window.setTimeout(connect,3000)};ws.onmessage=e=>{try{const m=JSON.parse(String(e.data));if(m?.type!=="nmea"||typeof m.line!=="string")return;const d=decode(m.line);if(d)setNav(v=>({...v,...d}))}catch{}}}catch{if(!done)retry=window.setTimeout(connect,3000)}};connect();return()=>{done=true;if(retry)window.clearTimeout(retry);ws?.close()};},[]);
  useEffect(()=>{const scan=()=>{const bridge=document.querySelector('svg[aria-label="Bridge window celestial star view"]') as SVGSVGElement|null;const round=document.querySelector('svg[aria-label="360 degree star horizon plot"]') as SVGSVGElement|null;const svg=bridge??round;if(!svg){setTarget(null);return}const host=svg.parentElement;if(!host)return;if(host.style.position!=="relative")host.style.position="relative";setTarget(prev=>prev?.svg===svg?prev:{svg,host,mode:bridge?"bridge":"360"});if(bridge)setCenter(readBridgeCenter(norm(nav.heading??nav.cog??0)));};scan();const id=window.setInterval(scan,500);return()=>window.clearInterval(id);},[nav.heading,nav.cog]);

  const sky=useMemo<DrawStar[]>(()=>{const navSolved=NAV_STARS.map(s=>({...solveStar(s,nav.lat,nav.lon,now),id:s.name,constellation:CONSTELLATION_BY_STAR.get(s.name)||"Navigational star",helper:false}));const helperSolved=HELPERS.map(s=>({...solveStar(s,nav.lat,nav.lon,now),id:s.id,constellation:s.constellation,helper:true}));return [...navSolved,...helperSolved];},[nav.lat,nav.lon,now]);
  const byId=useMemo(()=>new Map(sky.map(s=>[s.id,s])),[sky]);

  if(!target)return null;
  const project=(s:DrawStar)=>target.mode==="bridge"?projectBridge(s,center):project360(s);
  const visibleHelpers=sky.filter(s=>s.helper&&project(s));
  const visibleNav=sky.filter(s=>!s.helper&&project(s));

  const constellationLayer=<g aria-label="Constellation overlay">
    {constellations&&C.flatMap(c=>c.segments.map(([a,b],i)=>{const sa=byId.get(a),sb=byId.get(b);if(!sa||!sb)return null;const pa=project(sa),pb=project(sb);if(!pa||!pb)return null;return <line key={`${c.name}-${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#56bad0" strokeOpacity="0.34" strokeWidth="1.35"/>}))}
    {constellations&&C.map(c=>{const ids=Array.from(new Set(c.segments.flat()));const pts=ids.map(id=>byId.get(id)).filter((s):s is DrawStar=>!!s).map(project).filter((p):p is {x:number;y:number}=>!!p);if(pts.length<2)return null;const x=pts.reduce((n,p)=>n+p.x,0)/pts.length,y=pts.reduce((n,p)=>n+p.y,0)/pts.length;return <text key={`${c.name}-label`} x={x} y={y} fill="#79ddd5" fillOpacity="0.46" fontSize={target.mode==="bridge"?10:9} fontWeight="700" textAnchor="middle" letterSpacing="1.2">{c.name.toUpperCase()}</text>})}
    {constellations&&visibleHelpers.map(s=>{const p=project(s)!;return <circle key={`${s.id}-node`} cx={p.x} cy={p.y} r={fieldStars?(s.mag<=2?2.7:2):1.5} fill="#d7eef3" fillOpacity={fieldStars?0.78:0.42}/>})}
    {fieldStars&&visibleHelpers.filter(s=>s.mag<=2.9).map(s=>{const p=project(s)!;return <text key={`${s.id}-name`} x={p.x+5} y={p.y-4} fill="#a7bdc9" fillOpacity="0.82" fontSize={target.mode==="bridge"?9:8}>{s.name}</text>})}
    {visibleHelpers.map(s=>{const p=project(s)!;return <circle key={`${s.id}-hit`} cx={p.x} cy={p.y} r="9" fill="transparent" style={{cursor:"pointer"}} onClick={()=>setSelected(s)}/>})}
    {visibleNav.map(s=>{const p=project(s)!;return <circle key={`${s.id}-navhit`} cx={p.x} cy={p.y} r="10" fill="transparent" style={{cursor:"pointer"}} onClick={()=>setSelected(s)}/>})}
  </g>;

  const controls=<div style={{position:"absolute",right:12,top:12,zIndex:15,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,pointerEvents:"auto"}}>
    <div style={{display:"flex",gap:5,padding:5,border:"1px solid var(--nd-border)",background:"color-mix(in srgb, var(--nd-panel) 92%, transparent)",boxShadow:"0 4px 14px rgba(0,0,0,.18)"}}>
      <button type="button" onClick={()=>setConstellations(v=>!v)} style={{height:28,padding:"0 9px",border:"1px solid var(--nd-border)",background:constellations?"var(--nd-teal)":"var(--nd-control-bg)",color:constellations?"#041213":"var(--nd-control-text)",fontSize:9,fontWeight:900,letterSpacing:".08em"}}>CONSTELLATIONS</button>
      <button type="button" onClick={()=>setFieldStars(v=>!v)} style={{height:28,padding:"0 9px",border:"1px solid var(--nd-border)",background:fieldStars?"var(--nd-gold)":"var(--nd-control-bg)",color:fieldStars?"#06111f":"var(--nd-control-text)",fontSize:9,fontWeight:900,letterSpacing:".08em"}}>STAR FIELD</button>
    </div>
    {selected&&<div style={{minWidth:225,border:"1px solid var(--nd-border)",background:"color-mix(in srgb, var(--nd-panel) 94%, transparent)",padding:"8px 10px",color:"var(--nd-text)",fontSize:10,lineHeight:1.35,boxShadow:"0 4px 14px rgba(0,0,0,.18)"}}><div style={{fontSize:12,fontWeight:900,color:"var(--nd-gold)"}}>{selected.name.toUpperCase()}</div><div style={{marginTop:2,color:"var(--nd-muted)",fontWeight:700}}>{selected.constellation.toUpperCase()}</div><div style={{marginTop:5,fontWeight:800}}>Az {selected.zn.toFixed(0)}°T · Alt {selected.hc.toFixed(1)}° · Mag {selected.mag.toFixed(2)}</div></div>}
  </div>;

  return <>{createPortal(constellationLayer,target.svg)}{createPortal(controls,target.host)}</>;
}
