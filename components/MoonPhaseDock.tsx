"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

const mod = (value:number, divisor:number) => ((value % divisor) + divisor) % divisor;

function lunarPhase(date:Date){
  const ageDays = mod((date.getTime() - NEW_MOON_EPOCH_MS) / 86400000, SYNODIC_MONTH_DAYS);
  const phase = ageDays / SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos(phase * Math.PI * 2)) / 2;

  let name = "New Moon";
  if (phase >= 0.03 && phase < 0.22) name = "Waxing Crescent";
  else if (phase >= 0.22 && phase < 0.28) name = "First Quarter";
  else if (phase >= 0.28 && phase < 0.47) name = "Waxing Gibbous";
  else if (phase >= 0.47 && phase < 0.53) name = "Full Moon";
  else if (phase >= 0.53 && phase < 0.72) name = "Waning Gibbous";
  else if (phase >= 0.72 && phase < 0.78) name = "Last Quarter";
  else if (phase >= 0.78 && phase < 0.97) name = "Waning Crescent";

  return { ageDays, phase, illumination, name };
}

function illuminatedPath(phase:number, radius=54, center=60){
  const angle = phase * Math.PI * 2;
  const terminator = Math.cos(angle);
  const waxing = phase <= 0.5;
  const right:Array<[number,number]> = [];
  const left:Array<[number,number]> = [];

  for(let i=0;i<=72;i++){
    const y = -radius + (i / 72) * radius * 2;
    const q = Math.sqrt(Math.max(0, radius * radius - y * y));
    const xLeft = waxing ? terminator * q : -q;
    const xRight = waxing ? q : -terminator * q;
    right.push([center + xRight, center + y]);
    left.push([center + xLeft, center + y]);
  }

  const points = [...right, ...left.reverse()];
  return `M ${points.map(([x,y])=>`${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}

function MoonDisk({phase,embedded=false}:{phase:number;embedded?:boolean}){
  const path = illuminatedPath(phase);
  return <svg viewBox="0 0 120 120" className={embedded?"h-full max-h-[230px] min-h-[150px] w-full max-w-[230px]":"h-[112px] w-[112px]"} aria-label="Illustrated current moon phase">
    <defs>
      <radialGradient id="moon-lit" cx="38%" cy="32%" r="72%">
        <stop offset="0%" stopColor="#f3f0de"/>
        <stop offset="65%" stopColor="#c8c4b3"/>
        <stop offset="100%" stopColor="#8f8c81"/>
      </radialGradient>
      <radialGradient id="moon-dark" cx="38%" cy="32%" r="72%">
        <stop offset="0%" stopColor="#20252a"/>
        <stop offset="100%" stopColor="#07090b"/>
      </radialGradient>
      <clipPath id="moon-clip"><circle cx="60" cy="60" r="54"/></clipPath>
    </defs>
    <circle cx="60" cy="60" r="56" fill="#020406" stroke="#344452" strokeWidth="1.5"/>
    <circle cx="60" cy="60" r="54" fill="url(#moon-dark)"/>
    <path d={path} fill="url(#moon-lit)" clipPath="url(#moon-clip)"/>
    <g clipPath="url(#moon-clip)" opacity="0.26" fill="#55564f">
      <circle cx="43" cy="41" r="7"/><circle cx="73" cy="33" r="4"/><circle cx="82" cy="67" r="8"/>
      <circle cx="51" cy="77" r="5"/><circle cx="32" cy="63" r="3.5"/><circle cx="68" cy="88" r="3"/>
    </g>
    <circle cx="60" cy="60" r="54" fill="none" stroke="#9ca8b2" strokeOpacity="0.35"/>
  </svg>
}

function LunarPhasePanel({phase,illumination,name,ageDays,embedded=false}:{phase:number;illumination:number;name:string;ageDays:number;embedded?:boolean}){
  if(embedded){
    return <section className="flex min-h-[220px] flex-1 flex-col border-t border-[#263442] bg-[#071019] text-[#dbe5ee]" aria-label="Current lunar phase">
      <div className="border-b border-[#263442] px-3 py-2">
        <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#708496]">LUNAR PHASE</div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4 p-3">
        <MoonDisk phase={phase} embedded/>
        <div className="min-w-[105px]">
          <div className="text-base font-black leading-tight text-[#e7c95c]">{name}</div>
          <div className="mt-3 text-[9px] font-black uppercase tracking-[.12em] text-[#708496]">Illumination</div>
          <div className="text-3xl font-black">{Math.round(illumination * 100)}%</div>
          <div className="mt-2 text-[11px] text-[#9eafbd]">Age {ageDays.toFixed(1)} days</div>
        </div>
      </div>
      <div className="border-t border-[#263442] px-3 py-2 text-[8px] leading-3 text-[#708496]">Illustrated phase is computed from UTC and intended for bridge awareness, not almanac replacement.</div>
    </section>;
  }

  return <aside className="fixed bottom-3 right-3 z-[60] w-[250px] border border-[#33485a] bg-[#071019]/95 text-[#dbe5ee] shadow-2xl backdrop-blur-sm max-sm:w-[205px]" aria-label="Current lunar phase">
    <div className="border-b border-[#263442] px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#708496]">LUNAR PHASE</div>
    </div>
    <div className="flex items-center gap-3 p-3 max-sm:flex-col">
      <MoonDisk phase={phase}/>
      <div className="min-w-0 flex-1 max-sm:text-center">
        <div className="text-sm font-black leading-tight text-[#e7c95c]">{name}</div>
        <div className="mt-2 text-[9px] font-black uppercase tracking-[.12em] text-[#708496]">Illumination</div>
        <div className="text-xl font-black">{Math.round(illumination * 100)}%</div>
        <div className="mt-1 text-[10px] text-[#9eafbd]">Age {ageDays.toFixed(1)} days</div>
      </div>
    </div>
    <div className="border-t border-[#263442] px-3 py-2 text-[8px] leading-3 text-[#708496]">Illustrated phase is computed from UTC and intended for bridge awareness, not almanac replacement.</div>
  </aside>;
}

export default function MoonPhaseDock(){
  const pathname = usePathname();
  const [now,setNow] = useState(()=>new Date());
  const [finderTarget,setFinderTarget] = useState<HTMLElement|null>(null);

  useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),60000);return()=>window.clearInterval(id)},[]);

  useEffect(()=>{
    if(!pathname.startsWith("/celestial")){
      setFinderTarget(null);
      return;
    }

    let stopped=false;
    let timer=0;
    let activeTarget:HTMLElement|null=null;

    const scan=()=>{
      if(stopped)return;
      const main=document.querySelector("main");
      const finderButton=Array.from(main?.querySelectorAll("button")||[]).find(button=>button.textContent?.trim()==="STAR FINDER") as HTMLButtonElement|undefined;
      const finderActive=!!finderButton&&String(finderButton.className).includes("bg-[#c9a227]");
      const target=finderActive?(main?.querySelector("aside") as HTMLElement|null):null;

      if(activeTarget&&activeTarget!==target){
        activeTarget.style.removeProperty("display");
        activeTarget.style.removeProperty("flex-direction");
      }
      activeTarget=target;
      if(target){
        target.style.setProperty("display","flex");
        target.style.setProperty("flex-direction","column");
      }
      setFinderTarget(prev=>prev===target?prev:target);
      timer=window.setTimeout(scan,500);
    };

    scan();
    return()=>{
      stopped=true;
      window.clearTimeout(timer);
      if(activeTarget){
        activeTarget.style.removeProperty("display");
        activeTarget.style.removeProperty("flex-direction");
      }
    };
  },[pathname]);

  const moon = useMemo(()=>lunarPhase(now),[now]);
  const panel=<LunarPhasePanel phase={moon.phase} illumination={moon.illumination} name={moon.name} ageDays={moon.ageDays} embedded={!!finderTarget}/>;

  return finderTarget?createPortal(panel,finderTarget):panel;
}
