"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const current = readMode();
    setMode(current);
    relabelWeatherUi(current);
    const observer = new MutationObserver(() => relabelWeatherUi(current));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const attach = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>("#wxr-v2-topbar .wxr-center");
      if (target) {
        setHost(target);
        return;
      }
      timer = window.setTimeout(attach, 100);
    };

    attach();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const choose = (next: SourceMode) => {
    try { window.localStorage.setItem(SOURCE_KEY, next); } catch {}
    setMode(next);
    window.setTimeout(() => window.location.reload(), 50);
  };

  const button = (active: boolean): React.CSSProperties => ({
    height: 26,
    minWidth: 52,
    padding: "0 9px",
    borderRadius: 3,
    border: `1px solid ${active ? (nightMode ? "#22d3ee" : "#0891b2") : (nightMode ? "rgba(148,163,184,.28)" : "rgba(100,116,139,.35)")}`,
    background: active ? (nightMode ? "rgba(34,211,238,.16)" : "#ecfeff") : (nightMode ? "#071019" : "#ffffff"),
    color: active ? (nightMode ? "#d9fbff" : "#0e7490") : (nightMode ? "#9aabba" : "#475569"),
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: ".08em",
    cursor: "pointer",
    pointerEvents: "auto",
    touchAction: "manipulation",
  });

  if (!host) return null;

  return createPortal(
    <div
      data-wxr-source-selector
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        marginLeft: 4,
        paddingLeft: 10,
        borderLeft: nightMode ? "1px solid rgba(148,163,184,.22)" : "1px solid rgba(100,116,139,.28)",
        pointerEvents: "auto",
      }}
    >
      <span
        style={{
          padding: 0,
          border: 0,
          background: "transparent",
          color: nightMode ? "#708496" : "#64748b",
          fontSize: 8,
          fontWeight: 900,
          letterSpacing: ".12em",
          whiteSpace: "nowrap",
        }}
      >
        SOURCE
      </span>
      <button type="button" aria-pressed={mode === "grib"} style={button(mode === "grib")} onClick={() => choose("grib")}>GRIB</button>
      <button type="button" aria-pressed={mode === "noaa"} style={button(mode === "noaa")} onClick={() => choose("noaa")}>NOAA</button>
    </div>,
    host,
  );
}
