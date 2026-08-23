"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

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

function normalizeRoute(data:any):Waypoint[]{
  const raw=Array.isArray(data?.waypoints)?data.waypoints:Array.isArray(data)?data:[];
  return raw
    .map((w:any)=>({lat:Number(w?.lat??w?.latitude),lon:Number(w?.lon??w?.lng??w?.longitude)}))
    .filter((w:Waypoint)=>Number.isFinite(w.lat)&&Number.isFinite(w.lon));
}

function routeFromStorage():Waypoint[]{
  try{
    const raw=localStorage.getItem(ROUTE_STORAGE_KEY); if(!raw)return[];
    return normalizeRoute(JSON.parse(raw));
  }catch{return[];}
}

function numberFrom(text:string){const m=text.match(/(-?\d+(?:\.\d+)?)/);return m?Number(m[1]):NaN;}

export function BridgeRouteDistanceWgs84(){
  useEffect(()=>{
    let closed=false;
    let route:Waypoint[]=routeFromStorage();
    let socket:WebSocket|null=null;
    let retryTimer=0;
    let routeTimer=0;

    const refreshRouteFallback=async()=>{
      if(closed)return;
      const local=routeFromStorage();
      if(local.length>=2) route=local;
      else if(route.length<2){
        try{
          const response=await fetch("/api/route-state",{cache:"no-store"});
          if(response.ok){
            const fetched=normalizeRoute(await response.json());
            if(fetched.length>=2) route=fetched;
          }
        }catch{}
      }
      routeTimer=window.setTimeout(refreshRouteFallback,1500);
    };

    const connect=()=>{
      if(closed)return;
      try{
        socket=new WebSocket(getAisWebSocketUrl());
        socket.onmessage=(event)=>{
          try{
            const msg=JSON.parse(String(event.data||""));
            if(msg?.type==="route-state"){
              const shared=normalizeRoute(msg);
              if(shared.length>=2) route=shared;
            }
          }catch{}
        };
        socket.onclose=()=>{if(!closed)retryTimer=window.setTimeout(connect,2000);};
      }catch{retryTimer=window.setTimeout(connect,2000);}
    };

    const tick=()=>{
      if(route.length<2)return;
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

    refreshRouteFallback();
    connect();
    const timer=window.setInterval(tick,1000); tick();

    return()=>{
      closed=true;
      window.clearInterval(timer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(routeTimer);
      if(socket){socket.onclose=null;socket.close();}
    };
  },[]);
  return null;
}
