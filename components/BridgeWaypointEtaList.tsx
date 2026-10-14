"use client";
import { useEffect, useState } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import { geodesicDistanceNm, normalizeRouteWaypoints, routeLegDistanceNm, type RouteWaypoint } from "../lib/routeNavigation";

type Fix={lat:number;lon:number;sog:number;received:number};
type Route={waypoints:RouteWaypoint[];active:number};
function sixBit(c:string){let v=c.charCodeAt(0)-48;if(v>40)v-=8;return v;}
function u(b:string,i:number,n:number){return parseInt(b.slice(i,i+n),2);}
function signed(b:string,i:number,n:number){const v=u(b,i,n);return v>=2**(n-1)?v-2**n:v;}
function fixFromAis(input:string):Omit<Fix,"received">|null{
 if(!input.startsWith("!AIVDO"))return null;
 const parts=input.split(",");if(Number(parts[1])!==1||!parts[5])return null;
 const bits=Array.from(parts[5],c=>sixBit(c).toString(2).padStart(6,"0")).join("");
 const type=u(bits,0,6);let lat:number,lon:number,sog:number;
 if([1,2,3].includes(type)){lon=signed(bits,61,28)/600000;lat=signed(bits,89,27)/600000;const speed=u(bits,50,10);sog=speed<1023?speed/10:NaN;}
 else if([18,19].includes(type)){lon=signed(bits,57,28)/600000;lat=signed(bits,85,27)/600000;const speed=u(bits,46,10);sog=speed<1023?speed/10:NaN;}
 else return null;
 return Math.abs(lat)<=90&&Math.abs(lon)<=180&&Number.isFinite(sog)?{lat,lon,sog}:null;
}
function extractRoute(data:any):Route|null{
 const waypoints=normalizeRouteWaypoints(data?.waypoints);
 if(waypoints.length<2)return null;
 const index=Number(data?.activeWaypointIndex);
 return {waypoints,active:Number.isFinite(index)?Math.max(1,Math.min(waypoints.length-1,Math.trunc(index))):1};
}
// Zone Description is positive west and negative east. Local nautical time = UTC - ZD.
function zd(lon:number){return Math.max(-12,Math.min(12,-Math.floor((lon+7.5)/15)));}
function zdText(zone:number){return `ZD ${zone>0?"+":""}${zone} (UTC${-zone>=0?"+":""}${-zone})`;}
function localEta(at:number,zone:number){
 const date=new Date(at-zone*3600000);
 const stamp=`${date.getUTCDate().toString().padStart(2,"0")} ${date.toLocaleString("en-US",{month:"short",timeZone:"UTC"})} ${date.getUTCHours().toString().padStart(2,"0")}:${date.getUTCMinutes().toString().padStart(2,"0")}`;
 return stamp;
}
export function BridgeWaypointEtaList(){
 const [route,setRoute]=useState<Route|null>(null);
 const [fix,setFix]=useState<Fix|null>(null);
 const [now,setNow]=useState(Date.now());
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  let alive=true,ws:WebSocket|null=null,retry=0;
  const receiveRoute=(data:any)=>{if(!alive)return;const next=extractRoute(data);setRoute(next);};
  const load=async()=>{
   try{
    const saved=window.localStorage.getItem("navconsole-saved-route");
    if(saved){const next=extractRoute(JSON.parse(saved));if(next){receiveRoute(JSON.parse(saved));return;}}
    const res=await fetch("/api/route-state",{cache:"no-store"});
    if(res.ok)receiveRoute(await res.json());
   }catch{}
  };
  const sync=(event:Event)=>receiveRoute((event as CustomEvent).detail);
  window.addEventListener("navdash-route-state-updated",sync);
  const timer=window.setInterval(()=>{setNow(Date.now());load();},5000);
  const connect=()=>{
   if(!alive)return;
   try{
    ws=new WebSocket(getAisWebSocketUrl());
    ws.onmessage=e=>{
     let raw=String(e.data||"");
     try{
      const v=JSON.parse(raw);
      if(v?.type==="route-state"){receiveRoute(v);return;}
      raw=typeof v==="string"?v:v?.sentence||v?.nmea||v?.raw||v?.line||"";
     }catch{}
     for(const line of raw.split(/\r?\n/)){
      const next=fixFromAis(line.trim());
      if(next)setFix({...next,received:Date.now()});
     }
    };
    ws.onclose=()=>{if(alive)retry=window.setTimeout(connect,2500);};
   }catch{retry=window.setTimeout(connect,2500);}
  };
  load();connect();
  return ()=>{alive=false;window.clearInterval(timer);window.clearTimeout(retry);window.removeEventListener("navdash-route-state-updated",sync);if(ws){ws.onclose=null;ws.close();}};
 },[]);
 const day=typeof document!=="undefined"&&(document.documentElement.dataset.navdashTheme==="day"||document.documentElement.classList.contains("day-mode"));
 const good=!!fix&&now-fix.received<45000&&fix.sog>0.1;
 const speed=good?fix!.sog:NaN;
 const rows=route?.waypoints.map((wp,index)=>{
  const passed=index<route.active;
  let nm=NaN;
  if(!passed&&fix){
   nm=routeLegDistanceNm(fix,wp);
   for(let leg=route.active+1;leg<=index;leg++)nm+=geodesicDistanceNm(route.waypoints[leg-1],route.waypoints[leg]);
  }
  const zone=zd(wp.lon);
  const eta=!passed&&good&&Number.isFinite(nm)?localEta(now+nm/speed*3600000,zone):"—";
  return {wp,index,passed,nm,zone,eta};
 })||[];
 return <>
  <button type="button" onClick={()=>setOpen(v=>!v)} style={{position:"fixed",right:18,top:74,zIndex:1150,border:"1px solid #4b8799",borderRadius:7,background:day?"#e6f1f5":"#102b3c",color:day?"#15354b":"#d6eef3",fontSize:11,fontWeight:700,letterSpacing:".08em",padding:"9px 12px"}}>
   WAYPOINT ETAS {open?"▴":"▾"}
  </button>
  {open&&<section style={{position:"fixed",right:18,top:113,zIndex:1150,width:"min(490px,calc(100vw - 36px))",maxHeight:"min(66vh,600px)",overflow:"auto",background:day?"#f5fafc":"#0b2332",color:day?"#183747":"#d8edf5",border:"1px solid #48768a",borderRadius:9,boxShadow:"0 12px 35px #0007",padding:12,fontSize:12}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}>
    <strong>ACTIVE ROUTE · WAYPOINT ARRIVALS</strong><button onClick={()=>setOpen(false)} aria-label="Close waypoint ETAs">✕</button>
   </div>
   <p style={{fontSize:11,opacity:.8,margin:"0 0 10px"}}>{good?`LIVE SOG ${speed.toFixed(1)} KT · ETA assumes constant SOG`:"LIVE SOG UNAVAILABLE · ETA SUPPRESSED"} · Waypoint nautical ZD</p>
   {!route?<p>No active route loaded.</p>:<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontVariantNumeric:"tabular-nums"}}>
    <thead><tr style={{textAlign:"left",fontSize:10,opacity:.7}}><th style={{padding:"6px 4px"}}>WAYPOINT</th><th>DTG NM</th><th>ETA LOCAL</th><th>ZONE</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.index} style={{borderTop:"1px solid #58728644",opacity:row.passed?.45:1}}>
     <td style={{padding:"9px 4px",maxWidth:150,overflowWrap:"anywhere"}}>{row.wp.name||`WP${String(row.index+1).padStart(2,"0")}`}{row.passed?" · PASSED":row.index===route.active?" · NEXT":""}</td>
     <td style={{whiteSpace:"nowrap"}}>{row.passed?"—":Number.isFinite(row.nm)?row.nm.toFixed(1):"—"}</td>
     <td style={{whiteSpace:"nowrap",fontWeight:600}}>{row.eta}</td>
     <td style={{whiteSpace:"nowrap",fontSize:10}}>{zdText(row.zone)}</td>
    </tr>)}</tbody>
   </table></div>}
   <p style={{fontSize:10,opacity:.7,marginBottom:0}}>Planning estimate only. Based on current SOG along remaining route legs, without weather, current or maneuvering allowance. ZD is a longitude-based nautical zone, not civil time.</p>
  </section>}
 </>;
}
