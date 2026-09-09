"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ENC_KEY = "navdash-main-enc-layer";
const SEAMARKS_KEY = "navdash-main-seamarks-layer";
const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";

function readPreference(key: string, fallback: boolean) {
  try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : raw === "true"; } catch { return fallback; }
}
function hasAmiRoute() { try { return Boolean(window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY)); } catch { return false; } }

export function BridgeMapLayerControls() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [encOn, setEncOn] = useState(true);
  const [seamarksOn, setSeamarksOn] = useState(true);
  const [baseOn, setBaseOn] = useState(true);
  const [amiLoaded, setAmiLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false; let timer = 0;
    const findHost = () => {
      if (cancelled) return;
      const map = document.getElementById("v12-map");
      if (map) { setHost(map); setEncOn(readPreference(ENC_KEY, true)); setSeamarksOn(readPreference(SEAMARKS_KEY, true)); setAmiLoaded(hasAmiRoute()); return; }
      timer = window.setTimeout(findHost, 100);
    };
    findHost(); return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const refreshAmi = () => setAmiLoaded(hasAmiRoute());
    window.addEventListener("storage", refreshAmi); window.addEventListener("navdash-ami-overlay-updated", refreshAmi);
    return () => { window.removeEventListener("storage", refreshAmi); window.removeEventListener("navdash-ami-overlay-updated", refreshAmi); };
  }, []);

  useEffect(() => {
    if (!host) return;
    let frame = 0;
    const applyVisibility = () => {
      frame = 0;
      const isolated = host.querySelector<HTMLElement>("#navmap-main-isolated-v2"); if (!isolated) return;
      isolated.querySelectorAll<HTMLImageElement>("img.leaflet-tile").forEach((tile) => {
        const src = tile.src || "";
        if (src.includes("tile.openstreetmap.org")) { tile.style.setProperty("display", baseOn ? "" : "none", "important"); return; }
        if (src.includes("tiles.openseamap.org/seamark")) { tile.style.setProperty("display", seamarksOn ? "" : "none", "important"); return; }
        if (src.includes("gis.charttools.noaa.gov")) {
          try { const sourceUrl = new URL(src); tile.src = `/api/noaa-charts/wms${sourceUrl.search}`; } catch {}
          tile.style.setProperty("display", encOn ? "" : "none", "important"); return;
        }
        if (src.includes("/api/noaa-charts/wms")) tile.style.setProperty("display", encOn ? "" : "none", "important");
      });
    };
    const scheduleApply = () => { if (!frame) frame = window.requestAnimationFrame(applyVisibility); };
    try { window.localStorage.setItem(ENC_KEY, String(encOn)); window.localStorage.setItem(SEAMARKS_KEY, String(seamarksOn)); } catch {}
    scheduleApply(); const observer = new MutationObserver(scheduleApply); observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, [host, encOn, seamarksOn, baseOn]);

  function clearAmiRoute() { try { window.localStorage.removeItem(AMI_OVERLAY_STORAGE_KEY); } catch {} window.dispatchEvent(new CustomEvent("navdash-ami-overlay-updated", { detail: null })); setAmiLoaded(false); }
  if (!host) return null;
  const buttonBase: React.CSSProperties = { height: 28, padding: "0 10px", borderRadius: 3, background: "#071019", font: "800 9px system-ui", letterSpacing: ".08em", cursor: "pointer" };
  const toggleStyle = (on: boolean, color: string): React.CSSProperties => ({ ...buttonBase, color: on ? color : "#8294a5", border: on ? `1px solid ${color}88` : "1px solid rgba(148,163,184,.25)" });

  return createPortal(
    <div id="bc-map-layer-controls" style={{ position: "absolute", top: 8, right: 8, zIndex: 1300, display: "flex", gap: 4, padding: 4, border: "1px solid rgba(148,163,184,.2)", background: "rgba(4,8,12,.88)", backdropFilter: "blur(4px)", pointerEvents: "auto" }}>
      <button type="button" onClick={() => setBaseOn(v => !v)} style={toggleStyle(baseOn, "#f1d56b")}>BASEMAP {baseOn ? "ON" : "OFF"}</button>
      <button type="button" onClick={() => setEncOn(v => !v)} style={toggleStyle(encOn, "#45d6a8")}>ENC {encOn ? "ON" : "OFF"}</button>
      <button type="button" onClick={() => setSeamarksOn(v => !v)} style={toggleStyle(seamarksOn, "#42d3c8")}>SEAMARKS {seamarksOn ? "ON" : "OFF"}</button>
      <button type="button" disabled={!amiLoaded} onClick={clearAmiRoute} style={{ ...buttonBase, cursor: amiLoaded ? "pointer" : "default", opacity: amiLoaded ? 1 : 0.45, color: amiLoaded ? "#f1d56b" : "#8294a5", border: amiLoaded ? "1px solid rgba(241,213,107,.55)" : "1px solid rgba(148,163,184,.25)" }}>CLEAR AMI ROUTE</button>
    </div>, host,
  );
}
