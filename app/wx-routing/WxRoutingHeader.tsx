"use client";

import type { Dispatch, SetStateAction } from "react";
import type { WxRoutingPanel } from "./wxRoutingTypes";

type Props = {
  dayMode: boolean;
  nightMode: boolean;
  activePanel: WxRoutingPanel;
  onPanelChange: Dispatch<SetStateAction<WxRoutingPanel>>;
  onToggleTheme: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  buttonClass: string;
  activeButtonClass: string;
  labelClass: string;
  mutedClass: string;
};

const PANELS: WxRoutingPanel[] = ["GRIB", "ROUTE", "STORM", "WHAT IF", "COMPARE", "LAYERS"];

export default function WxRoutingHeader({
  dayMode,
  nightMode,
  activePanel,
  onPanelChange,
  onToggleTheme,
  isFullscreen,
  onToggleFullscreen,
  buttonClass,
  activeButtonClass,
  labelClass,
  mutedClass,
}: Props) {
  return (
    <header className={`flex flex-col gap-3 border p-3 lg:flex-row lg:items-center lg:justify-between ${dayMode ? "border-slate-300 bg-white text-slate-900" : "border-white/10 bg-[#071019] text-[#dbe5ee]"}`}>
      <div>
        <div className={labelClass}>NavDash 1.3 Weather</div>
        <h1 className="text-3xl font-black uppercase tracking-wide">WX Routing</h1>
        <p className={`mt-1 text-sm ${mutedClass}`}>
          Planning Aid - Verify against official forecasts, approved charts, vessel limitations, and Master/bridge-team judgment.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PANELS.map((item) => (
          <button
            key={item}
            type="button"
            className={activePanel === item ? activeButtonClass : buttonClass}
            onClick={() => onPanelChange(item)}
          >
            {item}
          </button>
        ))}
        <button type="button" className={buttonClass} onClick={onToggleTheme}>
          {nightMode ? "Day Mode" : "Night Mode"}
        </button>
        <button type="button" className={buttonClass} onClick={onToggleFullscreen}>
          {isFullscreen ? "Exit Full Screen" : "Full Screen"}
        </button>
      </div>
    </header>
  );
}
