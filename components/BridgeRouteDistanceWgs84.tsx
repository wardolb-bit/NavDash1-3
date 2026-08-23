"use client";

import { useEffect } from "react";

type Waypoint = { lat: number; lon: number };
const ROUTE_STORAGE_KEY = "navconsole-saved-route";

function rad(v:number){return v*Math.PI/180;}
function gcNm(a:Waypoint,b:Waypoint){
  const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon), p1=rad(a.lat), p2=rad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
  return 3440.065*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}

function rhumbWgs84Nm(a:Waypoint,b:Waypoint){
  const A=6378137, f=1/298.257223563, e2=f*(2-f), e=Math.sqrt(e2);
  const p1=rad(a.lat), p2=rad(b.lat);
  let dl=rad(b.lon-a.lon); if(dl>Math.PI)dl-=2*Math.PI; if(dl< -Math.PI)dl+=2*Math.PI;
  const iso=(p:number)=>Math.log(Math.tan(Math.PI/4+p/2))-e/2*Math.log((1+e*Math.sin(p))/(1-e*Math.sin(p)));
  const M=(p:number)=>A*((1-e2/4-3*e2*e2/64-5*e2**3/256)*p-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*p)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*p)-(35*e2**3/3072)*Math.sin(6*p));
  const dPsi=iso(p2)-iso(p1), dM=M(p2)-M(p1);
  const q=Math.abs(dPsi)>1e-12?dM/dPsi:A*Math.cos(p1)/Math.sqrt(1-e2*Math.sin(p1)**2);
  return Math.hypot(dM,q*dl)/1852;
}

function routeFromStorage():Waypoint[]{
  try{
    const raw=localStorage.getItem(ROUTE_STORAGE_KEY); if(!raw)return[];
    const p=JSON.parse(raw); const r=Array.isArray(p?.waypoints)?p.waypoints:Array.isArray(p)?p:[];
    return r.map((w:any)=>({lat:Number(w.lat??w.latitude),lon:Number(w.lon??w.lng??w.longitude)})).filter((w:Waypoint)=>Number.isFinite(w.lat)&&Number.isFinite(w.lon));
  }catch{return[];}
}

function numberFrom(text:string){const m=text.match(/(-?\d+(?:\.\d+)?)/);return m?Number(m[1]):NaN;}

export function BridgeRouteDistanceWgs84(){
  useEffect(()=>{
    const tick=()=>{
      const route=routeFromStorage(); if(route.length<2)return;
      const legText=document.getElementById("bc2-top-leg")?.textContent||"";
      const m=legText.match(/(\d+)\s*[→>-]\s*(\d+)/) || legText.match(/LEG\s*(\d+)/i);
      if(!m)return;

      const dest=Math.max(1,Math.min(route.length,Number(m[2]||m[1])));
      let correction=0;
      for(let i=dest-1;i<route.length-1;i++) correction+=rhumbWgs84Nm(route[i],route[i+1])-gcNm(route[i],route[i+1]);

      for(const id of ["bc2-top-dtg","bc2-dtg"]){
        const el=document.getElementById(id); if(!el)continue;
        const currentText=el.textContent||"";
        const lastCorrected=el.dataset.lastCorrected||"";

        // The underlying bridge console keeps writing a fresh live DTG as the
        // ship moves. Capture each fresh value as the new great-circle base;
        // do not freeze the first value we ever saw.
        if(!lastCorrected || currentText!==lastCorrected){
          const freshBase=numberFrom(currentText);
          if(Number.isFinite(freshBase)) el.dataset.gcBase=String(freshBase);
        }

        const base=Number(el.dataset.gcBase);
        if(!Number.isFinite(base))continue;
        const corrected=base+correction;
        const decimals=currentText.match(/\.(\d+)/)?.[1]?.length??0;
        const output=(id==="bc2-top-dtg"?"DTG ":"")+corrected.toFixed(decimals)+" NM";
        el.textContent=output;
        el.dataset.lastCorrected=output;
      }
    };

    const timer=window.setInterval(tick,1000); tick();
    return()=>window.clearInterval(timer);
  },[]);
  return null;
}
