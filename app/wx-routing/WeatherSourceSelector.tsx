"use client";

import { useEffect, useState } from "react";

const SOURCE_KEY = "navdash-wx-routing-source";
type SourceMode = "grib" | "noaa";

function readMode(): SourceMode {
  try {
    return window.localStorage.getItem(SOURCE_KEY) === "noaa" ? "noaa" : "grib";
  } catch {
    return "grib";
  }
}

export default function WeatherSourceSelector() {
  const [mode, setMode] = useState<SourceMode>("grib");

  useEffect(() => { setMode(readMode()); }, []);

  const choose = (next: SourceMode) => {
    try { window.localStorage.setItem(SOURCE_KEY, next); } catch {}
    setMode(next);
    window.location.reload();
  };

  const button = (active: boolean): React.CSSProperties => ({
    height: 30,
    padding: "0 10px",
    borderRadius: 4,
    border: `1px solid ${active ? "#22d3ee" : "rgba(148,163,184,.28)"}`,
    background: active ? "rgba(34,211,238,.16)" : "#071019",
    color: active ? "#d9fbff" : "#9aabba",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: ".08em",
    cursor: "pointer",
  });

  return (
    <div style={{ position: "fixed", right: 14, top: 14, zIndex: 5000, display: "flex", alignItems: "center", gap: 5, padding: 5, border: "1px solid rgba(148,163,184,.22)", borderRadius: 6, background: "rgba(4,8,12,.94)", backdropFilter: "blur(6px)", boxShadow: "0 6px 18px rgba(0,0,0,.28)" }}>
      <span style={{ padding: "0 5px", color: "#708496", fontSize: 9, fontWeight: 900, letterSpacing: ".12em" }}>WX SOURCE</span>
      <button type="button" aria-pressed={mode === "grib"} style={button(mode === "grib")} onClick={() => choose("grib")}>GRIB</button>
      <button type="button" aria-pressed={mode === "noaa"} style={button(mode === "noaa")} onClick={() => choose("noaa")}>NOAA</button>
      <span style={{ marginLeft: 3, padding: "0 6px", color: mode === "noaa" ? "#d9fbff" : "#cbd5e1", fontSize: 9, fontWeight: 900, letterSpacing: ".08em", whiteSpace: "nowrap" }}>
        {mode === "noaa" ? "NOAA ONLY" : "GRIB ONLY"}
      </span>
    </div>
  );
}
