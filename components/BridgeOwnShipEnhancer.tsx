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

export function BridgeOwnShipEnhancer(){
 useEffect(()=>{
   let ws:WebSocket|null=null, retry=0, last:OwnShip|null=null, observer:MutationObserver|null=null;
   const publish=(ship:OwnShip)=>{
     last=ship;
     const lat=document.getElementById("bc2-lat"),lon=document.getElementById("bc2-lon");
     if(lat)lat.textContent=fmtLat(ship.lat); if(lon)lon.textContent=fmtLon(ship.lon);
     document.documentElement.dataset.bcOwnCog=String(ship.cog);
     updateSymbol();
   };
   const updateSymbol=()=>{
     const map=document.getElementById("v12-map"); if(!map)return;
     const circles=Array.from(map.querySelectorAll<SVGCircleElement>('circle[stroke="#22d3ee"],circle[stroke="#22D3EE"]'));
     const own=circles.find(c=>Number(c.getAttribute("r"))>=8); if(!own)return;
     own.style.opacity="0"; own.style.fillOpacity="0"; own.style.pointerEvents="none";
     const svg=own.ownerSVGElement; if(!svg)return;
     let marker=svg.querySelector<SVGGElement>("#bc-ownship-vessel");
     if(!marker){marker=document.createElementNS("http://www.w3.org/2000/svg","g");marker.id="bc-ownship-vessel";marker.style.pointerEvents="none";marker.innerHTML='<circle r="13" fill="#041016" fill-opacity="0.76" stroke="#22d3ee" stroke-opacity="0.35" stroke-width="1"/><path d="M 0 -15 L 9 10 L 0 6 L -9 10 Z" fill="#071019" stroke="#22d3ee" stroke-width="2.4" stroke-linejoin="round"/><path d="M 0 -11 L 0 6" stroke="#e7c95c" stroke-width="1.6"/><circle r="2.5" fill="#22d3ee"/>';svg.appendChild(marker);}
     const cx=Number(own.getAttribute("cx")||0),cy=Number(own.getAttribute("cy")||0),cog=last?.cog??0;
     marker.setAttribute("transform",`translate(${cx} ${cy}) rotate(${Number.isFinite(cog)?cog:0})`);
   };
   const connect=()=>{
     try{ws=new WebSocket(getAisWebSocketUrl());ws.onmessage=e=>{let raw=String(e.data||"");try{const j=JSON.parse(raw);raw=typeof j==="string"?j:(j?.sentence||j?.nmea||j?.raw||"");}catch{} raw.split(/\r?\n/).forEach(line=>{const d=decode(line.trim());if(d)publish(d);});};ws.onclose=()=>{retry=window.setTimeout(connect,2000);};ws.onerror=()=>{};}catch{retry=window.setTimeout(connect,2000);}
   };
   const map=document.getElementById("v12-map"); if(map){observer=new MutationObserver(updateSymbol);observer.observe(map,{subtree:true,childList:true,attributes:true,attributeFilter:["cx","cy","r","transform"]});}
   else {const wait=window.setInterval(()=>{const m=document.getElementById("v12-map");if(m){window.clearInterval(wait);observer=new MutationObserver(updateSymbol);observer.observe(m,{subtree:true,childList:true,attributes:true,attributeFilter:["cx","cy","r","transform"]});}},250);}
   connect();
   return()=>{window.clearTimeout(retry);observer?.disconnect();if(ws){ws.onclose=null;ws.close();}};
 },[]);
 return null;
}
