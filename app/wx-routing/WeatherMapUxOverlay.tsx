"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type MapStatus = {
  mode: "NOAA" | "GRIB";
  product: string;
  valid: string;
};

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findExact(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLElement>("div,span")).find(
    (element) => cleanText(element.textContent) === text,
  ) || null;
}

function selectedSourceMode(): "NOAA" | "GRIB" {
  try {
    return window.localStorage.getItem("navdash-wx-routing-source") === "noaa" ? "NOAA" : "GRIB";
  } catch {
    return "GRIB";
  }
}

function readMapStatus(root: HTMLElement): MapStatus {
  const mode = selectedSourceMode();
  const dataSourceLabel = findExact(root, "Data Source");
  const dataSourceCard = dataSourceLabel?.parentElement || null;
  const sourceLines = dataSourceCard
    ? Array.from(dataSourceCard.children)
        .map((element) => cleanText(element.textContent))
        .filter((text) => text && text !== "Data Source")
    : [];

  const sourceNotes = sourceLines.find((text) => /NOAA|NWS|NDFD|GRIB|GFS|Wave/i.test(text)) || "";
  let product = mode === "NOAA" ? "NOAA / NWS" : "Imported GRIB";
  if (/NDFD Oceanic/i.test(sourceNotes)) product = "NDFD OCEANIC";
  else if (/NDFD/i.test(sourceNotes)) product = "NDFD";
  else if (/GFS/i.test(sourceNotes)) product = "GFS";
  else if (/NOAA|NWS/i.test(sourceNotes)) product = "NOAA / NWS";

  const validLabel = findExact(root, "Valid Time");
  const validField = validLabel?.parentElement?.querySelector<HTMLElement>(".font-black");
  const valid = cleanText(validField?.textContent) || "NO FORECAST TIME";

  return { mode, product, valid };
}

function readSelectionLines(root: HTMLElement) {
  const label = findExact(root, "Route Leg");
  const card = label?.parentElement || null;
  if (!card) return [] as string[];

  const detail = Array.from(card.children).find((child) => {
    const element = child as HTMLElement;
    const text = cleanText(element.textContent);
    return element !== label && text && !/Click a colored route leg/i.test(text);
  }) as HTMLElement | undefined;

  if (!detail) return [] as string[];

  const lines = Array.from(detail.children)
    .map((element) => cleanText(element.textContent))
    .filter(Boolean)
    .filter((text) => !/^No risk flags$/i.test(text));

  const useful = lines.some((text) => /Wind:|Gust:|Seas:|Waves:|Valid:|WX Time:/i.test(text));
  return useful ? lines.slice(0, 10) : [];
}

function relabelWeatherPoints(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("span,div").forEach((element) => {
    if (cleanText(element.textContent) === "GRIB Sample Points") element.textContent = "Weather Points";
  });
}

export default function WeatherMapUxOverlay() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<MapStatus>({ mode: "GRIB", product: "Imported GRIB", valid: "NO FORECAST TIME" });
  const [selectionLines, setSelectionLines] = useState<string[]>([]);
  const [dismissedSignature, setDismissedSignature] = useState("");

  const selectionSignature = useMemo(() => selectionLines.join("|"), [selectionLines]);
  const showSelection = selectionLines.length > 0 && selectionSignature !== dismissedSignature;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let observer: MutationObserver | null = null;

    const attach = () => {
      if (cancelled) return;
      const main = document.querySelector<HTMLElement>("main");
      const map = document.querySelector<HTMLElement>(".maplibregl-map");
      const frame = map?.parentElement?.parentElement || map?.parentElement || null;
      if (!main || !frame) {
        timer = window.setTimeout(attach, 150);
        return;
      }

      if (getComputedStyle(frame).position === "static") frame.style.position = "relative";
      setHost(frame);

      const refresh = () => {
        if (cancelled) return;
        relabelWeatherPoints(main);
        setStatus(readMapStatus(main));
        setSelectionLines(readSelectionLines(main));
      };

      refresh();
      observer = new MutationObserver(refresh);
      observer.observe(main, { childList: true, subtree: true, characterData: true });
      window.addEventListener("storage", refresh);

      return () => window.removeEventListener("storage", refresh);
    };

    const detach = attach();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      detach?.();
    };
  }, []);

  useEffect(() => {
    if (selectionSignature && selectionSignature !== dismissedSignature) return;
    if (!selectionSignature) setDismissedSignature("");
  }, [dismissedSignature, selectionSignature]);

  if (!host) return null;

  const night = typeof document !== "undefined" && !document.documentElement.classList.contains("light");
  const panel = night
    ? "border border-cyan-300/35 bg-[#050b11]/95 text-slate-100 shadow-2xl shadow-black/50 backdrop-blur"
    : "border border-slate-300 bg-white/95 text-slate-950 shadow-xl shadow-slate-900/15 backdrop-blur";
  const muted = night ? "text-slate-400" : "text-slate-600";

  return createPortal(
    <>
      <div className={`pointer-events-none absolute left-3 top-3 z-30 max-w-[72%] px-3 py-2 ${panel}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] font-black uppercase tracking-[0.12em]">
          <span className={status.mode === "NOAA" ? "text-cyan-300" : "text-amber-300"}>{status.mode} ONLY</span>
          <span className={muted}>·</span>
          <span>{status.product}</span>
          <span className={muted}>·</span>
          <span>{status.valid}</span>
        </div>
        <div className={`mt-1 text-[0.62rem] font-bold ${muted}`}>
          Weather points: arrow = wind direction · label = wind / seas · color = exposure
        </div>
      </div>

      {showSelection ? (
        <div className={`absolute bottom-3 left-3 z-40 w-[min(22rem,calc(100%-1.5rem))] p-3 ${panel}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-cyan-300">Selected Weather</div>
            <button
              type="button"
              className={`border px-2 py-1 text-[0.65rem] font-black ${night ? "border-white/15 bg-white/5" : "border-slate-300 bg-slate-50"}`}
              onClick={() => setDismissedSignature(selectionSignature)}
            >
              CLOSE
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs">
            {selectionLines.map((line, index) => (
              <div key={`${line}-${index}`} className={index === 0 ? "font-black" : index === 1 ? muted : "font-bold"}>
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={`pointer-events-none absolute bottom-3 right-3 z-30 px-2.5 py-1.5 text-[0.62rem] font-bold ${panel} ${muted}`}>
          Click a weather point or colored route leg for details
        </div>
      )}
    </>,
    host,
  );
}
