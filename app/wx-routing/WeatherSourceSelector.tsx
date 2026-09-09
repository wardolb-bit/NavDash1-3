"use client";

import { useEffect, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

const SOURCE_KEY = "navdash-wx-routing-source";
type SourceMode = "grib" | "noaa";

function readMode(): SourceMode {
  try {
    return window.localStorage.getItem(SOURCE_KEY) === "noaa" ? "noaa" : "grib";
  } catch {
    return "grib";
  }
}

function relabelWeatherUi(mode: SourceMode) {
  const replacements: Array<[RegExp, string]> = [
    [/^GRIB Sample Points$/i, "Weather Points"],
    [/^GRIB Forecast File$/i, mode === "noaa" ? "NOAA Forecast" : "GRIB Forecast File"],
    [/^Imported GRIB weather is displayed as route exposure, projected forecast values, flowing wind, and pressure isobars when data is available\.$/i,
      mode === "noaa"
        ? "NOAA route weather is displayed as route exposure, forecast points, and flowing wind where the selected NOAA product provides data."
        : "Imported GRIB weather is displayed as route exposure, projected forecast values, flowing wind, and pressure isobars when data is available."],
    [/^Load a route and GRIB file to show leg-by-leg weather\.$/i, "Load a route and weather source to show leg-by-leg weather."],
  ];

  document.querySelectorAll<HTMLElement>("div,span,p").forEach((element) => {
    const text = (element.textContent || "").trim();
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(text) && element.children.length === 0 && element.textContent !== replacement) {
        element.textContent = replacement;
        break;
      }
    }
  });
}

export default function WeatherSourceSelector() {
  const { nightMode } = useBridgeTheme();
  const [mode, setMode] = useState<SourceMode>("grib");

  useEffect(() => {
    const current = readMode();
    setMode(current);
    relabelWeatherUi(current);
    const observer = new MutationObserver(() => relabelWeatherUi(current));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const choose = (next: SourceMode) => {
    try { window.localStorage.setItem(SOURCE_KEY, next); } catch {}
    setMode(next);
    window.setTimeout(() => window.location.reload(), 50);
  };

  const button = (active: boolean): React.CSSProperties => ({
    height: 30,
    padding: "0 10px",
    borderRadius: 4,
    border: `1px solid ${active ? (nightMode ? "#22d3ee" : "#0891b2") : (nightMode ? "rgba(148,163,184,.28)" : "rgba(100,116,139,.35)")}`,
    background: active ? (nightMode ? "rgba(34,211,238,.16)" : "#ecfeff") : (nightMode ? "#071019" : "#ffffff"),
    color: active ? (nightMode ? "#d9fbff" : "#0e7490") : (nightMode ? "#9aabba" : "#475569"),
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: ".08em",
    cursor: "pointer",
    pointerEvents: "auto",
    touchAction: "manipulation",
  });

  return (
    <div style={{ position: "fixed", right: 14, top: 62, zIndex: 2147483647, isolation: "isolate", pointerEvents: "auto", display: "flex", alignItems: "center", gap: 5, padding: 5, border: nightMode ? "1px solid rgba(148,163,184,.22)" : "1px solid rgba(148,163,184,.45)", borderRadius: 6, background: nightMode ? "rgba(4,8,12,.94)" : "rgba(255,255,255,.96)", backdropFilter: "blur(6px)", boxShadow: nightMode ? "0 6px 18px rgba(0,0,0,.28)" : "0 6px 18px rgba(15,23,42,.12)" }}>
      <span style={{ padding: "0 5px", color: nightMode ? "#708496" : "#64748b", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", pointerEvents: "none" }}>WX SOURCE</span>
      <button type="button" aria-pressed={mode === "grib"} style={button(mode === "grib")} onClick={() => choose("grib")}>GRIB</button>
      <button type="button" aria-pressed={mode === "noaa"} style={button(mode === "noaa")} onClick={() => choose("noaa")}>NOAA</button>
      <span style={{ marginLeft: 3, padding: "0 6px", color: mode === "noaa" ? (nightMode ? "#d9fbff" : "#0e7490") : (nightMode ? "#cbd5e1" : "#334155"), fontSize: 9, fontWeight: 900, letterSpacing: ".08em", whiteSpace: "nowrap", pointerEvents: "none" }}>
        {mode === "noaa" ? "NOAA ONLY" : "GRIB ONLY"}
      </span>
    </div>
  );
}
