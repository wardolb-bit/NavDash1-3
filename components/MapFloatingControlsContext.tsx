"use client";

import { useEffect } from "react";

function mapHost() {
  return document.getElementById("v12-map");
}

function findWxPanel(host: HTMLElement) {
  return Array.from(host.children).find((element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = element.getAttribute("style") || "";
    return /z-index:\s*770/.test(style);
  }) as HTMLElement | undefined;
}

function ensureWxPanelOpen(panel: HTMLElement | undefined) {
  if (!panel) return;
  const toggle = Array.from(panel.querySelectorAll("button")).find((button) =>
    (button.textContent || "").trim().toUpperCase() === "WX LAYERS",
  );
  if (!(toggle instanceof HTMLButtonElement)) return;
  if (!panel.querySelector('input[type="checkbox"], input[type="range"]')) toggle.click();
}

function menuTheme() {
  return document.documentElement.getAttribute("data-navdash-theme") === "day"
    ? { text: "#17212b", muted: "#586773", hover: "#f3f6f8", active: "#006f78", border: "rgba(15,23,42,.18)" }
    : { text: "#e7edf3", muted: "#91a0ad", hover: "#15212c", active: "#22d3ee", border: "rgba(241,213,107,.28)" };
}

function addSeparator(menu: HTMLElement) {
  const line = document.createElement("div");
  line.style.cssText = "height:1px;margin:4px 6px";
  line.style.background = menuTheme().border;
  menu.appendChild(line);
}

function addHeading(menu: HTMLElement, text: string) {
  const heading = document.createElement("div");
  heading.textContent = text;
  heading.style.cssText = "padding:7px 12px 4px;font:800 9px/1.2 system-ui,sans-serif;letter-spacing:.12em;opacity:.65";
  heading.style.color = menuTheme().muted;
  menu.appendChild(heading);
}

function addAction(menu: HTMLElement, text: string, action: () => void, disabled = false, active = false) {
  const theme = menuTheme();
  const row = document.createElement("button");
  row.type = "button";
  row.textContent = text;
  row.disabled = disabled;
  row.style.cssText = "display:flex;width:100%;min-width:220px;align-items:center;justify-content:space-between;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px";
  row.style.color = active ? theme.active : disabled ? theme.muted : theme.text;
  row.style.opacity = disabled ? "0.45" : "1";
  if (!disabled) {
    row.addEventListener("mouseenter", () => { row.style.background = theme.hover; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", () => {
      action();
      document.getElementById("navdash-map-context-menu")?.remove();
    });
  }
  menu.appendChild(row);
}

function addRange(menu: HTMLElement, source: HTMLInputElement, labelText: string) {
  const theme = menuTheme();
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:8px 12px 10px;min-width:220px";

  const label = document.createElement("div");
  label.textContent = labelText;
  label.style.cssText = "margin-bottom:6px;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.06em";
  label.style.color = theme.text;

  const range = document.createElement("input");
  range.type = "range";
  range.min = source.min;
  range.max = source.max;
  range.step = source.step;
  range.value = source.value;
  range.disabled = source.disabled;
  range.style.cssText = "width:100%;accent-color:#22d3ee";
  range.addEventListener("input", () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(source, range.value);
    else source.value = range.value;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });

  wrap.append(label, range);
  menu.appendChild(wrap);
}

function augmentContextMenu() {
  const host = mapHost();
  const menu = document.getElementById("navdash-map-context-menu");
  if (!(host instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;
  if (menu.dataset.floatingControlsAdded === "true") return;
  menu.dataset.floatingControlsAdded = "true";

  const layerControls = document.getElementById("bc-map-layer-controls");
  const wxPanel = findWxPanel(host);
  ensureWxPanelOpen(wxPanel);

  if (layerControls instanceof HTMLElement) {
    const buttons = Array.from(layerControls.querySelectorAll("button"));
    if (buttons.length) {
      addSeparator(menu);
      addHeading(menu, "CHART LAYERS");
      buttons.forEach((source) => {
        const text = (source.textContent || "").trim();
        const active = /\bON\b/i.test(text);
        addAction(menu, text, () => source.click(), source.disabled, active);
      });
    }
  }

  if (wxPanel instanceof HTMLElement) {
    const labels = Array.from(wxPanel.querySelectorAll("label"));
    const ranges = Array.from(wxPanel.querySelectorAll<HTMLInputElement>('input[type="range"]'));
    if (labels.length || ranges.length) {
      addSeparator(menu);
      addHeading(menu, "WEATHER LAYERS");

      labels.forEach((label) => {
        const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox) return;
        const text = (label.textContent || "").replace(/\s+/g, " ").trim() || "WEATHER LAYER";
        addAction(menu, `${text}${checkbox.checked ? "  ✓" : ""}`, () => checkbox.click(), checkbox.disabled, checkbox.checked);
      });

      ranges.forEach((range, index) => {
        const labelText = range.getAttribute("aria-label") || (index === 0 ? "FORECAST TIME" : `WEATHER RANGE ${index + 1}`);
        addRange(menu, range, labelText.toUpperCase());
      });
    }
  }
}

function hideFloatingMenus() {
  const host = mapHost();
  if (!(host instanceof HTMLElement)) return;

  const layerControls = document.getElementById("bc-map-layer-controls");
  if (layerControls instanceof HTMLElement) layerControls.style.setProperty("display", "none", "important");

  const wxPanel = findWxPanel(host);
  if (wxPanel) {
    ensureWxPanelOpen(wxPanel);
    wxPanel.style.setProperty("display", "none", "important");
  }
}

export function MapFloatingControlsContext() {
  useEffect(() => {
    const sync = () => {
      hideFloatingMenus();
      augmentContextMenu();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 750);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
