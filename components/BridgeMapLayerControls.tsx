"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ENC_KEY = "navdash-main-enc-layer";
const SEAMARKS_KEY = "navdash-main-seamarks-layer";

function readPreference(key: string, fallback: boolean) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function BridgeMapLayerControls() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [encOn, setEncOn] = useState(true);
  const [seamarksOn, setSeamarksOn] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const findHost = () => {
      if (cancelled) return;
      const map = document.getElementById("v12-map");
      if (map) {
        setHost(map);
        setEncOn(readPreference(ENC_KEY, true));
        setSeamarksOn(readPreference(SEAMARKS_KEY, true));
        return;
      }
      timer = window.setTimeout(findHost, 100);
    };

    findHost();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!host) return;

    let frame = 0;
    const applyVisibility = () => {
      frame = 0;
      const isolated = host.querySelector<HTMLElement>("#navmap-main-isolated-v2");
      if (!isolated) return;

      isolated.querySelectorAll<HTMLImageElement>("img.leaflet-tile").forEach((tile) => {
        const src = tile.src || "";
        if (src.includes("tiles.openseamap.org/seamark")) {
          tile.style.setProperty("display", seamarksOn ? "" : "none", "important");
        } else if (src.includes("gis.charttools.noaa.gov")) {
          tile.style.setProperty("display", encOn ? "" : "none", "important");
        }
      });
    };

    const scheduleApply = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(applyVisibility);
    };

    try {
      window.localStorage.setItem(ENC_KEY, String(encOn));
      window.localStorage.setItem(SEAMARKS_KEY, String(seamarksOn));
    } catch {}

    scheduleApply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [host, encOn, seamarksOn]);

  if (!host) return null;

  const buttonBase: React.CSSProperties = {
    height: 28,
    padding: "0 10px",
    borderRadius: 3,
    background: "#06111f",
    font: "800 9px system-ui",
    letterSpacing: ".08em",
    cursor: "pointer",
  };

  return createPortal(
    <div
      id="bc-map-layer-controls"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 1300,
        display: "flex",
        gap: 4,
        padding: 4,
        border: "1px solid rgba(148,163,184,.2)",
        background: "rgba(4,8,12,.88)",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setEncOn((value) => !value)}
        style={{
          ...buttonBase,
          color: encOn ? "#45d6a8" : "#7f9caf",
          border: encOn ? "1px solid rgba(69,214,168,.55)" : "1px solid rgba(148,163,184,.25)",
        }}
      >
        ENC {encOn ? "ON" : "OFF"}
      </button>
      <button
        type="button"
        onClick={() => setSeamarksOn((value) => !value)}
        style={{
          ...buttonBase,
          color: seamarksOn ? "#56bad0" : "#7f9caf",
          border: seamarksOn ? "1px solid rgba(66,211,200,.55)" : "1px solid rgba(148,163,184,.25)",
        }}
      >
        SEAMARKS {seamarksOn ? "ON" : "OFF"}
      </button>
    </div>,
    host,
  );
}
