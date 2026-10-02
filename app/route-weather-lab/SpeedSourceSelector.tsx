"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOwnShipAis } from "../../lib/useOwnShipAis";

type SpeedMode = "planned" | "sog";

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function SpeedSourceSelector() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<SpeedMode>("planned");
  const ownShip = useOwnShipAis();
  const liveSog = ownShip?.sog ?? null;
  const plannedSpeedRef = useRef<number | null>(null);
  const speedInputRef = useRef<HTMLInputElement | null>(null);
  const modeRef = useRef<SpeedMode>("planned");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const attach = () => {
      const aside = document.querySelector("main aside");
      const section = aside?.querySelector("section:first-child");
      const speedInput = section?.querySelector<HTMLInputElement>('input[type="number"]');
      if (!(section instanceof HTMLElement) || !speedInput) return false;

      speedInputRef.current = speedInput;
      setMount(section);

      const current = Number(speedInput.value);
      if (Number.isFinite(current) && current > 0 && plannedSpeedRef.current === null) {
        plannedSpeedRef.current = current;
      }

      const rememberPlanned = () => {
        if (modeRef.current !== "planned") return;
        const value = Number(speedInput.value);
        if (Number.isFinite(value) && value > 0) plannedSpeedRef.current = value;
      };

      speedInput.addEventListener("input", rememberPlanned);
      speedInput.addEventListener("change", rememberPlanned);

      return () => {
        speedInput.removeEventListener("input", rememberPlanned);
        speedInput.removeEventListener("change", rememberPlanned);
      };
    };

    const cleanup = attach();
    if (cleanup) return cleanup;

    const observer = new MutationObserver(() => {
      const lateCleanup = attach();
      if (lateCleanup) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (liveSog === null || !Number.isFinite(liveSog)) return;
    if (modeRef.current === "sog" && liveSog >= 1 && speedInputRef.current) {
      setReactInputValue(speedInputRef.current, liveSog.toFixed(1));
    }
  }, [liveSog]);

  function selectPlanned() {
    setMode("planned");
    modeRef.current = "planned";
    const input = speedInputRef.current;
    const planned = plannedSpeedRef.current;
    if (input && planned !== null) setReactInputValue(input, planned.toFixed(1));
  }

  function selectSog() {
    if (liveSog === null || liveSog < 1) return;
    const input = speedInputRef.current;
    if (input) {
      const current = Number(input.value);
      if (Number.isFinite(current) && current > 0) plannedSpeedRef.current = current;
      setReactInputValue(input, liveSog.toFixed(1));
    }
    setMode("sog");
    modeRef.current = "sog";
  }

  if (!mount) return null;

  const liveAvailable = liveSog !== null && liveSog >= 1;

  return createPortal(
    <div className="mt-3 border-t border-slate-800 pt-3" data-weather-speed-source>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">SPEED SOURCE</div>
        <div className="text-[9px] font-bold text-slate-500">{liveSog === null ? "AIS SOG --" : `AIS SOG ${liveSog.toFixed(1)} kt`}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={selectPlanned}
          className={`border px-3 py-2 text-[10px] font-black ${mode === "planned" ? "border-[#c9a227] bg-[#17130a] text-[#f1d56b]" : "border-slate-700 bg-[#050a0f] text-slate-400"}`}
        >
          PLANNED SPEED
        </button>
        <button
          type="button"
          onClick={selectSog}
          disabled={!liveAvailable}
          className={`border px-3 py-2 text-[10px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${mode === "sog" ? "border-cyan-400 bg-cyan-950/30 text-cyan-200" : "border-slate-700 bg-[#050a0f] text-slate-400"}`}
        >
          CURRENT SOG{liveSog !== null ? ` ${liveSog.toFixed(1)} KT` : ""}
        </button>
      </div>
      <div className="mt-2 text-[9px] leading-relaxed text-slate-500">
        {mode === "sog"
          ? "Route encounter ETAs are using live AIS SOG. Planned speed is preserved and restored when you switch back."
          : "Route encounter ETAs are using the entered voyage-planning speed."}
      </div>
    </div>,
    mount,
  );
}
