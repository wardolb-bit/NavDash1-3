"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

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

function findButton(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => cleanText(button.textContent) === text,
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

function enableNoaaWeatherPoints(root: HTMLElement) {
  if (selectedSourceMode() !== "NOAA") return false;

  const layersButton = findButton(root, "LAYERS");
  if (!layersButton) return false;
  layersButton.click();

  window.requestAnimationFrame(() => {
    const weatherText = Array.from(root.querySelectorAll<HTMLElement>("span,div")).find((element) => {
      const text = cleanText(element.textContent);
      return text === "Weather Points" || text === "GRIB Sample Points";
    });
    const row = weatherText?.closest("label") || weatherText?.parentElement?.closest("label") || null;
    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]') || null;
    if (checkbox && !checkbox.checked) checkbox.click();

    const routeButton = findButton(root, "ROUTE");
    routeButton?.click();
  });

  return true;
}

export default function WeatherMapUxOverlay() {
  const { nightMode } = useBridgeTheme();
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
    let storageHandler: (() => void) | null = null;
    let noaaPointsInitialized = false;

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
      setHost((current) => current === frame ? current : frame);

      const refresh = () => {
        if (cancelled) return;
        relabelWeatherPoints(main);
        if (!noaaPointsInitialized && selectedSourceMode() === "NOAA") {
          noaaPointsInitialized = enableNoaaWeatherPoints(main);
        }
        const nextStatus = readMapStatus(main);
        const nextLines = readSelectionLines(main);
        setStatus((current) =>
          current.mode === nextStatus.mode && current.product === nextStatus.product && current.valid === nextStatus.valid
            ? current
            : nextStatus,
        );
        setSelectionLines((current) => current.join("|") === nextLines.join("|") ? current : nextLines);
      };

      refresh();
      observer = new MutationObserver(refresh);
      observer.observe(main, { childList: true, subtree: true, characterData: true });
      storageHandler = refresh;
      window.addEventListener("storage", storageHandler);
    };

    attach();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      if (storageHandler) window.removeEventListener("storage", storageHandler);
    };
  }, []);

  useEffect(() => {
    if (!selectionSignature) setDismissedSignature("");
  }, [selectionSignature]);

  useEffect(() => {
    const topbar = document.getElementById("wxr-v2-topbar");
    if (!topbar) return;

    topbar.style.background = nightMode ? "#071019" : "#ffffff";
    topbar.style.color = nightMode ? "#e7edf3" : "#0f172a";
    topbar.style.borderColor = nightMode ? "rgba(201,162,39,.30)" : "rgba(148,163,184,.55)";

    const logo = topbar.querySelector<HTMLElement>(".wxr-logo");
    if (logo) {
      logo.style.background = nightMode ? "transparent" : "#ffffff";
      logo.style.color = nightMode ? "#e7c95c" : "#8a6d0a";
    }

    const small = topbar.querySelector<HTMLElement>("small");
    if (small) small.style.color = nightMode ? "#8294a5" : "#64748b";

    topbar.querySelectorAll<HTMLElement>(".wxr-center span").forEach((element) => {
      element.style.background = nightMode ? "#050a0f" : "#f8fafc";
      element.style.color = nightMode ? "#aebdca" : "#334155";
      element.style.borderColor = nightMode ? "rgba(148,163,184,.18)" : "rgba(148,163,184,.45)";
    });

    const action = topbar.querySelector<HTMLAnchorElement>(".wxr-actions a");
    if (action) {
      action.style.background = nightMode ? "#071019" : "#ffffff";
      action.style.color = nightMode ? "#e7c95c" : "#8a6d0a";
      action.style.borderColor = nightMode ? "rgba(201,162,39,.55)" : "rgba(138,109,10,.55)";
    }
  }, [host, nightMode]);

  if (!host) return null;

  const panel = nightMode
    ? "border border-cyan-300/35 bg-[#050b11]/95 text-slate-100 shadow-2xl shadow-black/50 backdrop-blur"
    : "border border-slate-300 bg-white/95 text-slate-950 shadow-xl shadow-slate-900/15 backdrop-blur";
  const muted = nightMode ? "text-slate-400" : "text-slate-600";

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
              className={`border px-2 py-1 text-[0.65rem] font-black ${nightMode ? "border-white/15 bg-white/5" : "border-slate-300 bg-slate-50"}`}
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
