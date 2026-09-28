"use client";

import { useEffect, useState } from "react";

type Coverage = {
  totalNm: number;
  coveredNm: number;
  uncoveredNm: number;
  percent: number;
  coveredHours: number;
  voyageHours: number;
  validThrough: Date | null;
};

function parseHours(text: string) {
  const dayMatch = text.match(/(\d+)d/);
  const hourMatch = text.match(/(\d+)h/);
  const days = Number(dayMatch?.[1] || 0);
  const hours = Number(hourMatch?.[1] || 0);
  return days * 24 + hours;
}

function formatUtc(date: Date | null) {
  if (!date || !Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "") + "Z";
}

function readCoverage(): Coverage | null {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("main div"));
  const coverageLabel = cards.find((el) => el.textContent?.trim() === "ROUTE WX COVERAGE");
  const coverageCard = coverageLabel?.parentElement as HTMLElement | null;
  if (!coverageCard) return null;

  const coverageText = coverageCard.textContent || "";
  const hoursMatch = coverageText.match(/((?:\d+d\s*)?\d+h)\s+of\s+((?:\d+d\s*)?\d+h)/i);
  const percentMatch = coverageText.match(/(\d+(?:\.\d+)?)%\s+of\s+voyage/i);
  if (!hoursMatch || !percentMatch) return null;

  const voyageSection = Array.from(document.querySelectorAll<HTMLElement>("aside > section")).find((section) => section.textContent?.includes("VOYAGE"));
  if (!voyageSection) return null;
  const miniCards = Array.from(voyageSection.querySelectorAll<HTMLElement>(".grid.grid-cols-3 > div"));
  const nmCard = miniCards.find((el) => el.textContent?.trim().startsWith("NM"));
  const totalNm = Number((nmCard?.textContent || "").replace(/^NM\s*/i, "").trim());
  if (!Number.isFinite(totalNm) || totalNm <= 0) return null;

  const coveredHours = parseHours(hoursMatch[1]);
  const voyageHours = parseHours(hoursMatch[2]);
  const percent = Math.max(0, Math.min(100, Number(percentMatch[1])));
  const coveredNm = Math.min(totalNm, totalNm * percent / 100);
  const uncoveredNm = Math.max(0, totalNm - coveredNm);

  const departureInput = voyageSection.querySelector<HTMLInputElement>('input[type="datetime-local"]');
  const departure = departureInput?.value ? new Date(departureInput.value) : null;
  const validThrough = departure && Number.isFinite(departure.getTime())
    ? new Date(departure.getTime() + coveredHours * 3600000)
    : null;

  return { totalNm, coveredNm, uncoveredNm, percent, coveredHours, voyageHours, validThrough };
}

export default function ForecastCoverageSummary() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setCoverage(readCoverage()), 60);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener("input", refresh, true);
    window.addEventListener("change", refresh, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("input", refresh, true);
      window.removeEventListener("change", refresh, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (!coverage) return null;
  const partial = coverage.percent < 99.5;

  return (
    <div className={`mx-2 mb-2 border p-3 ${partial ? "border-amber-500/60 bg-amber-950/20" : "border-emerald-500/40 bg-emerald-950/10"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`text-[10px] font-black uppercase tracking-[0.15em] ${partial ? "text-amber-300" : "text-emerald-300"}`}>FORECAST ROUTE COVERAGE</div>
          <div className="mt-1 text-lg font-black">
            ~{coverage.coveredNm.toFixed(0)} NM of {coverage.totalNm.toFixed(0)} NM
            <span className="ml-2 text-sm text-slate-400">({coverage.percent.toFixed(0)}%)</span>
          </div>
        </div>
        <div className="text-right text-[10px] font-bold text-slate-400">
          <div>COVERED TIME <span className="text-slate-200">{coverage.coveredHours.toFixed(0)} h of {coverage.voyageHours.toFixed(0)} h</span></div>
          <div>FORECAST REACHES ABOUT <span className="text-slate-200">{formatUtc(coverage.validThrough)}</span></div>
          <div>{partial ? <span className="text-amber-300">~{coverage.uncoveredNm.toFixed(0)} NM BEYOND CURRENT FORECAST HORIZON</span> : <span className="text-emerald-300">FULL ROUTE INSIDE CURRENT FORECAST HORIZON</span>}</div>
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800"><div className={`h-full ${partial ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${coverage.percent}%` }} /></div>
      {partial && <div className="mt-2 text-[10px] font-bold text-amber-200">MAX WIND and MAX SEAS apply only to the forecast-covered portion. Conditions beyond this point are not represented by the current model window.</div>}
    </div>
  );
}
