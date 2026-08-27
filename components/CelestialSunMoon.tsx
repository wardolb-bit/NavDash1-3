"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type Pos={lat:number;lon:number};
type EventValue=number|null;

type SolarEvents={sunrise:EventValue;sunset:EventValue;civilDawn:EventValue;civilDusk:EventValue;nauticalDawn:EventValue;nauticalDusk:EventValue;astroDawn:EventValue;astroDusk:EventValue;lan:EventValue};
type MoonEvents={moonrise:EventValue;moonset:EventValue;illumination:number};

const rad=(d:number)=>d*Math.PI/180;
const deg=(r:number)=>r*180/Math.PI;
const norm=(v:number)=>((v%360)+360)%360;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

function six(c:string){const n=c.charCodeAt(0);return n<88?n-48:n-56}
function bits(p:string){return p.split("").map(c=>six(c).toString(2).padStart(6,"0")).join("")}
function u(b:string,s:number,l:number){return parseInt(b.slice(s,s+l),2)}
function si(b:string,s:number,l:number){const v=u(b,s,l),t=2**(l-1);return v>=t?v-2**l:v}
function dd(raw:string,isLat:boolean){const k=isLat?2:3,d=Number(raw.slice(0,k)),m=Number(raw.slice(k));return d+m/60}
function decode(line:string):Partial<Pos>|null{
 const p=line.trim().split(","),t=(p[0]||"").replace(/^[$!]/,"");
 if((t==="AIVDO"||t==="ABVDO")&&p[1]==="1"&&p[2]==="1")try{const raw=bits(p[5]),fill=Number((p[6]||"0").split("*")[0]),b=fill?raw.slice(0,-fill):raw;if(![1,2,3].includes(u(b,0,6)))return null;const lon=si(b,61,28)/600000,lat=si(b,89,27)/600000;if(Math.abs(lat)>90||Math.abs(lon)>180)return null;return{lat,lon}}catch{return null}
 if(/..RMC$/.test(t)&&p[2]==="A"&&p[3]&&p[5])return{lat:dd(p[3],true)*(p[4]==="S"?-1:1),lon:dd(p[5],false)*(p[6]==="W"?-1:1)};
 if(/..GGA$/.test(t)&&p[2]&&p[4])return{lat:dd(p[2],true)*(p[3]==="S"?-1:1),lon:dd(p[4],false)*(p[5]==="W"?-1:1)};
 return null;
}

function shipOffsetHours(lon:number){return clamp(Math.round(lon/15),-12,14)}
function offsetLabel(h:number){if(h===0)return"UTC±0";return`UTC${h>0?"+":""}${h}`}
function localDayStartUtc(date:Date,offset:number){
 const localMs=date.getTime()+offset*3600000;
 const d=new Date(localMs);
 return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-offset*3600000;
}
function minutesToLocalText(minutes:EventValue){if(minutes===null)return"--";let m=((minutes%1440)+1440)%1440;const h=Math.floor(m/60),mm=Math.round(m%60);const hh=(h+(mm===60?1:0))%24;return`${String(hh).padStart(2,"0")}:${String(mm===60?0:mm).padStart(2,"0")}`}
function utcMinutesToLocal(utcMinutes:number,offset:number){return utcMinutes+offset*60}

function solarParams(date:Date){
 const jd=date.getTime()/86400000+2440587.5,t=(jd-2451545)/36525;
 const L0=norm(280.46646+t*(36000.76983+t*0.0003032));
 const M=norm(357.52911+t*(35999.05029-0.0001537*t));
 const e=0.016708634-t*(0.000042037+0.0000001267*t);
 const C=Math.sin(rad(M))*(1.914602-t*(0.004817+0.000014*t))+Math.sin(rad(2*M))*(0.019993-0.000101*t)+Math.sin(rad(3*M))*0.000289;
 const trueLong=L0+C,omega=125.04-1934.136*t,lambda=trueLong-0.00569-0.00478*Math.sin(rad(omega));
 const eps0=23+(26+(21.448-t*(46.815+t*(0.00059-t*0.001813)))/60)/60;
 const eps=eps0+0.00256*Math.cos(rad(omega));
 const decl=deg(Math.asin(Math.sin(rad(eps))*Math.sin(rad(lambda))));
 const y=Math.tan(rad(eps/2))**2;
 const eq=4*deg(y*Math.sin(2*rad(L0))-2*e*Math.sin(rad(M))+4*e*y*Math.sin(rad(M))*Math.cos(2*rad(L0))-0.5*y*y*Math.sin(4*rad(L0))-1.25*e*e*Math.sin(2*rad(M)));
 return{decl,eq};
}
function solarEvent(lat:number,lon:number,date:Date,alt:number,rise:boolean){
 const noonUtc=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),12));
 const {decl,eq}=solarParams(noonUtc),cosH=(Math.sin(rad(alt))-Math.sin(rad(lat))*Math.sin(rad(decl)))/(Math.cos(rad(lat))*Math.cos(rad(decl)));
 if(cosH>1||cosH<-1)return null;
 const H=deg(Math.acos(clamp(cosH,-1,1))),solarNoon=720-4*lon-eq;
 return solarNoon+(rise?-4*H:4*H);
}
function solarEvents(lat:number,lon:number,date:Date,offset:number):SolarEvents{
 const noon=new Date(localDayStartUtc(date,offset)+12*3600000);
 const e=(alt:number,rise:boolean)=>{const v=solarEvent(lat,lon,noon,alt,rise);return v===null?null:utcMinutesToLocal(v,offset)};
 const p=solarParams(noon),lan=utcMinutesToLocal(720-4*lon-p.eq,offset);
 return{sunrise:e(-0.833,true),sunset:e(-0.833,false),civilDawn:e(-6,true),civilDusk:e(-6,false),nauticalDawn:e(-12,true),nauticalDusk:e(-12,false),astroDawn:e(-18,true),astroDusk:e(-18,false),lan};
}

function moonRaDec(date:Date){
 const d=date.getTime()/86400000+2440587.5-2451543.5;
 const N=norm(125.1228-0.0529538083*d),i=5.1454,w=norm(318.0634+0.1643573223*d),a=60.2666,e=0.0549,M=norm(115.3654+13.0649929509*d);
 let E=rad(M)+e*Math.sin(rad(M))*(1+e*Math.cos(rad(M)));
 for(let k=0;k<3;k++)E=E-(E-e*Math.sin(E)-rad(M))/(1-e*Math.cos(E));
 const xv=a*(Math.cos(E)-e),yv=a*Math.sqrt(1-e*e)*Math.sin(E),v=deg(Math.atan2(yv,xv)),r=Math.sqrt(xv*xv+yv*yv);
 const xh=r*(Math.cos(rad(N))*Math.cos(rad(v+w))-Math.sin(rad(N))*Math.sin(rad(v+w))*Math.cos(rad(i)));
 const yh=r*(Math.sin(rad(N))*Math.cos(rad(v+w))+Math.cos(rad(N))*Math.sin(rad(v+w))*Math.cos(rad(i)));
 const zh=r*Math.sin(rad(v+w))*Math.sin(rad(i));
 const lon=deg(Math.atan2(yh,xh)),lat=deg(Math.atan2(zh,Math.sqrt(xh*xh+yh*yh)));
 const ecl=rad(23.4393-3.563e-7*d),xe=r*Math.cos(rad(lon))*Math.cos(rad(lat)),ye=r*Math.sin(rad(lon))*Math.cos(rad(lat)),ze=r*Math.sin(rad(lat));
 const xeq=xe,yeq=ye*Math.cos(ecl)-ze*Math.sin(ecl),zeq=ye*Math.sin(ecl)+ze*Math.cos(ecl);
 return{ra:norm(deg(Math.atan2(yeq,xeq))),dec:deg(Math.atan2(zeq,Math.sqrt(xeq*xeq+yeq*yeq)))};
}
function gmst(date:Date){const jd=date.getTime()/86400000+2440587.5,t=(jd-2451545)/36525;return norm(280.46061837+360.98564736629*(jd-2451545)+0.000387933*t*t-t*t*t/38710000)}
function moonAlt(lat:number,lon:number,date:Date){const m=moonRaDec(date),H=rad(norm(gmst(date)+lon-m.ra));return deg(Math.asin(Math.sin(rad(lat))*Math.sin(rad(m.dec))+Math.cos(rad(lat))*Math.cos(rad(m.dec))*Math.cos(H)))}
function sunEclipticLon(date:Date){const jd=date.getTime()/86400000+2440587.5,t=(jd-2451545)/36525,L0=norm(280.46646+t*(36000.76983+t*0.0003032)),M=norm(357.52911+t*(35999.05029-0.0001537*t)),C=Math.sin(rad(M))*(1.914602-t*(0.004817+0.000014*t))+Math.sin(rad(2*M))*(0.019993-0.000101*t)+Math.sin(rad(3*M))*0.000289;return norm(L0+C)}
function moonEclipticLon(date:Date){const d=date.getTime()/86400000+2440587.5-2451543.5,N=norm(125.1228-0.0529538083*d),w=norm(318.0634+0.1643573223*d),M=norm(115.3654+13.0649929509*d);return norm(N+w+M)}
function moonEvents(lat:number,lon:number,date:Date,offset:number):MoonEvents{
 const start=localDayStartUtc(date,offset),step=10,threshold=-0.3;let rise:EventValue=null,set:EventValue=null,prev=moonAlt(lat,lon,new Date(start))-threshold;
 for(let m=step;m<=1440;m+=step){const cur=moonAlt(lat,lon,new Date(start+m*60000))-threshold;if(rise===null&&prev<0&&cur>=0){const f=-prev/(cur-prev);rise=m-step+step*f}if(set===null&&prev>=0&&cur<0){const f=prev/(prev-cur);set=m-step+step*f}prev=cur}
 const mid=new Date(start+12*3600000),phase=rad(norm(moonEclipticLon(mid)-sunEclipticLon(mid))),illumination=(1-Math.cos(phase))/2*100;
 return{moonrise:rise,moonset:set,illumination};
}

export function CelestialSunMoon(){
 const pathname=usePathname();
 const [pos,setPos]=useState<Pos>({lat:13.4443,lon:144.7937});
 const [now,setNow]=useState(new Date());
 const [bannerTarget,setBannerTarget]=useState<HTMLElement|null>(null);
 const [plannerTarget,setPlannerTarget]=useState<HTMLElement|null>(null);
 const [plannerActive,setPlannerActive]=useState(false);
 const [plannerDate,setPlannerDate]=useState<Date|null>(null);

 useEffect(()=>{if(!pathname.startsWith("/celestial"))return;const id=window.setInterval(()=>setNow(new Date()),30000);return()=>window.clearInterval(id)},[pathname]);
 useEffect(()=>{if(!pathname.startsWith("/celestial"))return;let ws:WebSocket|null=null,retry:number|undefined,done=false;const connect=()=>{try{ws=new WebSocket(getAisWebSocketUrl());ws.onmessage=e=>{try{const m=JSON.parse(String(e.data));if(m?.type!=="nmea"||typeof m.line!=="string")return;const d=decode(m.line);if(d?.lat!==undefined&&d.lon!==undefined)setPos({lat:d.lat,lon:d.lon})}catch{}};ws.onclose=()=>{if(!done)retry=window.setTimeout(connect,3000)}}catch{retry=window.setTimeout(connect,3000)}};connect();return()=>{done=true;if(retry)clearTimeout(retry);ws?.close()}},[pathname]);
 useEffect(()=>{if(!pathname.startsWith("/celestial")){setBannerTarget(null);setPlannerTarget(null);return}let stop=false,timer=0;const scan=()=>{if(stop)return;const main=document.querySelector("main");const header=main?.querySelector("header") as HTMLElement|null;if(header){let slot=document.getElementById("celestial-sunmoon-banner-slot") as HTMLElement|null;if(!slot){slot=document.createElement("div");slot.id="celestial-sunmoon-banner-slot";header.insertAdjacentElement("afterend",slot)}setBannerTarget(slot)}const buttons=Array.from(main?.querySelectorAll("button")||[]);const planner=buttons.find(b=>b.textContent?.trim()==="SIGHT PLANNER") as HTMLButtonElement|undefined;const active=!!planner&&(getComputedStyle(planner).backgroundColor!=="rgb(8, 18, 27)");setPlannerActive(active);const input=main?.querySelector('input[type="datetime-local"]') as HTMLInputElement|null;if(input?.value){const d=new Date(input.value);if(!Number.isNaN(d.getTime()))setPlannerDate(d)}if(active){let pslot=document.getElementById("celestial-sunmoon-planner-slot") as HTMLElement|null;if(!pslot){pslot=document.createElement("div");pslot.id="celestial-sunmoon-planner-slot";slot?.insertAdjacentElement("afterend",pslot)}setPlannerTarget(pslot)}else setPlannerTarget(null);timer=window.setTimeout(scan,300)};scan();return()=>{stop=true;window.clearTimeout(timer)}},[pathname]);

 const offset=shipOffsetHours(pos.lon),solar=useMemo(()=>solarEvents(pos.lat,pos.lon,now,offset),[pos.lat,pos.lon,now,offset]),moon=useMemo(()=>moonEvents(pos.lat,pos.lon,now,offset),[pos.lat,pos.lon,now,offset]);
 const pDate=plannerDate??now,pOffset=shipOffsetHours(pos.lon),pSolar=useMemo(()=>solarEvents(pos.lat,pos.lon,pDate,pOffset),[pos.lat,pos.lon,pDate,pOffset]),pMoon=useMemo(()=>moonEvents(pos.lat,pos.lon,pDate,pOffset),[pos.lat,pos.lon,pDate,pOffset]);
 if(!pathname.startsWith("/celestial"))return null;
 const cell="border-r border-[#263442] px-3 py-2 last:border-r-0";
 const lab="text-[8px] font-black tracking-[.15em] text-[#708496]";
 const val="mt-1 text-[13px] font-black text-[#dbe5ee]";
 return <>
  {bannerTarget&&createPortal(<div className="mb-[5px] grid grid-cols-2 border border-[#263442] bg-[#071019] sm:grid-cols-3 xl:grid-cols-6">
   <div className={cell}><div className={lab}>SHIP LT</div><div className={`${val} text-[#e7c95c]`}>{new Date(now.getTime()+offset*3600000).toISOString().slice(11,16)} · {offsetLabel(offset)}</div></div>
   <div className={cell}><div className={lab}>SUNRISE</div><div className={val}>{minutesToLocalText(solar.sunrise)}</div></div>
   <div className={cell}><div className={lab}>SUNSET</div><div className={val}>{minutesToLocalText(solar.sunset)}</div></div>
   <div className={cell}><div className={lab}>MOONRISE</div><div className={val}>{minutesToLocalText(moon.moonrise)}</div></div>
   <div className={cell}><div className={lab}>MOONSET</div><div className={val}>{minutesToLocalText(moon.moonset)}</div></div>
   <div className={cell}><div className={lab}>MOON</div><div className={`${val} text-[#42d3c8]`}>{moon.illumination.toFixed(0)}% ILLUM</div></div>
  </div>,bannerTarget)}
  {plannerActive&&plannerTarget&&createPortal(<section className="mb-[5px] border border-[#263442] bg-[#071019]">
   <div className="border-b border-[#263442] px-3 py-2"><span className={lab}>LIGHT CONDITIONS · VESSEL POSITION · SHIP LOCAL TIME {offsetLabel(pOffset)}</span></div>
   <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
    {[["ASTRO DAWN",pSolar.astroDawn],["NAUT DAWN",pSolar.nauticalDawn],["CIVIL DAWN",pSolar.civilDawn],["SUNRISE",pSolar.sunrise],["LAN",pSolar.lan],["SUNSET",pSolar.sunset],["NAUT DUSK",pSolar.nauticalDusk],["ASTRO DUSK",pSolar.astroDusk]].map(([a,b])=><div key={String(a)} className={cell}><div className={lab}>{a}</div><div className={a==="NAUT DAWN"||a==="NAUT DUSK"||a==="LAN"?`${val} text-[#e7c95c]`:val}>{minutesToLocalText(b as EventValue)}</div></div>)}
   </div>
   <div className="grid grid-cols-3 border-t border-[#263442]"><div className={cell}><div className={lab}>MOONRISE</div><div className={val}>{minutesToLocalText(pMoon.moonrise)}</div></div><div className={cell}><div className={lab}>MOONSET</div><div className={val}>{minutesToLocalText(pMoon.moonset)}</div></div><div className={cell}><div className={lab}>MOON ILLUMINATION</div><div className={`${val} text-[#42d3c8]`}>{pMoon.illumination.toFixed(0)}%</div></div></div>
  </section>,plannerTarget)}
 </>;
}
