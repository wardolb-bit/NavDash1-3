"use client";

import { useEffect } from "react";

const STORAGE_KEY = "navdash-enc-brightness";
const EVENT_NAME = "navdash-enc-brightness-change";
const MIN_BRIGHTNESS = 40;
const MAX_BRIGHTNESS = 140;
const STEP = 10;

function clampBrightness(value: number) {
  return Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, Math.round(value / STEP) * STEP));
}

function readBrightness() {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) ? clampBrightness(stored) : 100;
  } catch {
    return 100;
  }
}

function menuTheme() {
  const day = document.documentElement.getAttribute("data-navdash-theme") === "day";
  return day
    ? { text: "#17212b", muted: "#586773", hover: "#f3f6f8", border: "rgba(15,23,42,.22)" }
    : { text: "#e7edf3", muted: "#91a0ad", hover: "#15212c", border: "rgba(241,213,107,.38)" };
}

export function BridgeEncBrightnessMenu() {
  useEffect(() => {
    const mountControls = () => {
      const menu = document.getElementById("navdash-map-context-menu");
      if (!(menu instanceof HTMLElement) || menu.querySelector("[data-enc-brightness-controls]")) return;

      const theme = menuTheme();
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-enc-brightness-controls", "true");

      const separator = document.createElement("div");
      separator.style.cssText = "height:1px;margin:4px 6px";
      separator.style.background = theme.border;
      wrapper.appendChild(separator);

      const label = document.createElement("div");
      label.style.cssText = "padding:7px 12px 4px;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.07em";
      label.style.color = theme.muted;

      const syncLabel = () => {
        label.textContent = `CHART BRIGHTNESS  ${readBrightness()}%`;
      };
      syncLabel();
      wrapper.appendChild(label);

      const adjust = (delta: number) => {
        const next = clampBrightness(readBrightness() + delta);
        try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
        syncLabel();
      };

      const makeButton = (text: string, delta: number) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.style.cssText = "display:flex;width:100%;min-width:190px;align-items:center;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px";
        button.style.color = theme.text;
        button.addEventListener("mouseenter", () => { button.style.background = theme.hover; });
        button.addEventListener("mouseleave", () => { button.style.background = "transparent"; });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          adjust(delta);
        });
        wrapper.appendChild(button);
      };

      makeButton("CHART DIMMER  −", -STEP);
      makeButton("CHART BRIGHTER  +", STEP);
      menu.appendChild(wrapper);
    };

    mountControls();
    const observer = new MutationObserver(mountControls);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
