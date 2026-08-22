"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type OwnShip = { lat:number; lon:number; sog:number; cog:number; heading:number|null };

function six(c:string){let v=c.charCodeAt(0)-48;if(v>40)v-=8;return v;}
function bits(payload:string){return payload.split("").map(c=>six(c).toString(2).padStart(6,"0")).join("");}
function u(b:string,s:number,l:number){return parseInt(b.slice(s,s+l),2);}
function signed(b:string,s:number,l:number){const raw=b.slice(s,s+l),v=parseInt(raw,2),sign=2**(l-1);return v>=sign?v-2**l:v;}
function decode(line:string):OwnShip|null{
  try{
    if(!line.startsWith("!AIVDO"))return null;
    const p=line.split(","); if(Number(p[1])!==1||!p[5])return null;
    const b=bits(p[5]),t=u(b,0,6); if(![1,2,3].includes(t))return null;
    const sog=u(b,50,10)/10,lon=signed(b,61,28)/600000,lat=signed(b,89,27)/600000,cog=u(b,116,12)/10,h=u(b,128,9);
    if(Math.abs(lat)>90||Math.abs(lon)>180)return null;
    return {lat,lon,sog,cog,heading:h===511?null:h};
  }catch{return null;}
}
function fmtLat(v:number){const h=v>=0?"N":"S",a=Math.abs(v),d=Math.floor(a),m=(a-d)*60;return `${String(d).padStart(2,"0")}° ${m.toFixed(3).padStart(6,"0")}' ${h}`;}
function fmtLon(v:number){const h=v>=0?"E":"W",a=Math.abs(v),d=Math.floor(a),m=(a-d)*60;return `${String(d).padStart(3,"0")}° ${m.toFixed(3).padStart(6,"0")}' ${h}`;}

/**
 * Bridge rail position helper only.
 *
 * The actual map marker belongs to app/page.tsx. Do not hide, replace, rotate,
 * or otherwise mutate Leaflet's own-ship layer from this helper.
 */
export function BridgeOwnShipEnhancer(){
 useEffect(()=>{
   let ws:WebSocket|null=null, retry=0;
   const publish=(ship:OwnShip)=>{
     const lat=document.getElementById("bc2-lat"),lon=document.getElementById("bc2-lon");
     if(lat)lat.textContent=fmtLat(ship.lat);
     if(lon)lon.textContent=fmtLon(ship.lon);
     document.documentElement.dataset.bcOwnCog=String(ship.cog);
   };
   const connect=()=>{
     try{
       ws=new WebSocket(getAisWebSocketUrl());
       ws.onmessage=e=>{
         let raw=String(e.data||"");
         try{
           const j=JSON.parse(raw);
           raw=typeof j==="string"?j:(j?.sentence||j?.nmea||j?.raw||"");
         }catch{}
         raw.split(/\r?\n/).forEach(line=>{const d=decode(line.trim());if(d)publish(d);});
       };
       ws.onclose=()=>{retry=window.setTimeout(connect,2000);};
       ws.onerror=()=>{};
     }catch{
       retry=window.setTimeout(connect,2000);
     }
   };
   connect();
   return()=>{window.clearTimeout(retry);if(ws){ws.onclose=null;ws.close();}};
 },[]);
 return null;
}
