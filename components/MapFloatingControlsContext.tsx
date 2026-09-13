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
    ? {
        background: "rgba(255,255,255,.98)",
        text: "#17212b",
        muted: "#586773",
        hover: "#f3f6f8",
        active: "#006f78",
        border: "rgba(15,23,42,.22)",
      }
    : {
        background: "rgba(5,12,18,.98)",
        text: "#e7edf3",
        muted: "#91a0ad",
        hover: "#15212c",
        active: "#22d3ee",
        border: "rgba(241,213,107,.32)",
      };
}

function styleMenuPanel(panel: HTMLElement) {
  const theme = menuTheme();
  panel.style.cssText = "position:fixed;z-index:1800;min-width:218px;padding:6px;border-radius:7px;box-shadow:0 10px 28px rgba(0,0,0,.34);backdrop-filter:blur(8px);user-select:none;-webkit-user-select:none";
  panel.style.background = theme.background;
  panel.style.border = `1px solid ${theme.border}`;
}

function styleMenuRow(row: HTMLElement, active = false, disabled = false) {
  const theme = menuTheme();
  row.style.cssText = "display:flex;width:100%;min-width:205px;align-items:center;justify-content:space-between;gap:14px;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px;white-space:nowrap";
  row.style.color = active ? theme.active : disabled ? theme.muted : theme.text;
  row.style.opacity = disabled ? "0.45" : "1";
}

function addAction(panel: HTMLElement, text: string, action: () => void, disabled = false, active = false) {
  const theme = menuTheme();
  const row = document.createElement("button");
  row.type = "button";
  row.textContent = text;
  row.disabled = disabled;
  styleMenuRow(row, active, disabled);
  if (!disabled) {
    row.addEventListener("mouseenter", () => { row.style.background = theme.hover; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", () => {
      action();
      document.getElementById("navdash-map-context-submenu")?.remove();
      document.getElementById("navdash-map-context-menu")?.remove();
    });
  }
  panel.appendChild(row);
}

function addRange(panel: HTMLElement, source: HTMLInputElement, labelText: string) {
  const theme = menuTheme();
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:8px 12px 10px;min-width:240px";

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
  panel.appendChild(wrap);
}

function moveExistingButton(panel: HTMLElement, button: HTMLButtonElement) {
  const theme = menuTheme();
  styleMenuRow(button, button.style.color.includes("34, 211, 238") || button.style.color.includes("0, 111, 120"), button.disabled);
  button.style.background = "transparent";
  button.addEventListener("mouseenter", () => { if (!button.disabled) button.style.background = theme.hover; });
  button.addEventListener("mouseleave", () => { button.style.background = "transparent"; });
  button.addEventListener("click", () => {
    document.getElementById("navdash-map-context-submenu")?.remove();
    document.getElementById("navdash-map-context-menu")?.remove();
  });
  panel.appendChild(button);
}

function openSubmenu(anchor: HTMLElement, build: (panel: HTMLElement) => void) {
  document.getElementById("navdash-map-context-submenu")?.remove();

  const panel = document.createElement("div");
  panel.id = "navdash-map-context-submenu";
  panel.setAttribute("role", "menu");
  styleMenuPanel(panel);
  build(panel);
  document.body.appendChild(panel);

  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 5;
  const roomRight = window.innerWidth - anchorRect.right;
  let left = roomRight >= panelRect.width + gap
    ? anchorRect.right + gap
    : anchorRect.left - panelRect.width - gap;
  left = Math.max(6, Math.min(left, window.innerWidth - panelRect.width - 6));

  let top = anchorRect.top;
  if (top + panelRect.height > window.innerHeight - 6) top = window.innerHeight - panelRect.height - 6;
  top = Math.max(6, top);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function categoryRow(menu: HTMLElement, label: string, build: (panel: HTMLElement) => void) {
  const theme = menuTheme();
  const row = document.createElement("button");
  row.type = "button";
  row.innerHTML = `<span>${label}</span><span style="font-size:14px;opacity:.72">›</span>`;
  styleMenuRow(row);

  const show = () => openSubmenu(row, build);
  row.addEventListener("mouseenter", () => {
    row.style.background = theme.hover;
    show();
  });
  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
  row.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    show();
  });
  menu.appendChild(row);
}

function buildCategorizedMenu() {
  const host = mapHost();
  const menu = document.getElementById("navdash-map-context-menu");
  if (!(host instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;
  if (menu.dataset.categorized === "true") return;

  const wxPanel = findWxPanel(host);
  ensureWxPanelOpen(wxPanel);
  const layerControls = document.getElementById("bc-map-layer-controls");

  const existingButtons = Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button"));
  const byText = (text: string) => existingButtons.find((button) => (button.textContent || "").trim().toUpperCase().startsWith(text));

  const pan = byText("PAN");
  const fromShip = byText("FROM SHIP");
  const twoPoints = byText("TWO POINTS");
  const clearMeasure = byText("CLEAR MEASURE");
  const sunEvents = byText("SUN EVENTS");
  const amiWx = byText("AMI WX");

  menu.innerHTML = "";
  menu.dataset.categorized = "true";
  menu.style.minWidth = "190px";

  categoryRow(menu, "MEASURE", (panel) => {
    [pan, fromShip, twoPoints, clearMeasure].forEach((button) => {
      if (button instanceof HTMLButtonElement) moveExistingButton(panel, button);
    });
  });

  categoryRow(menu, "CHART LAYERS", (panel) => {
    if (!(layerControls instanceof HTMLElement)) {
      addAction(panel, "NO LAYER CONTROLS", () => {}, true);
      return;
    }
    const buttons = Array.from(layerControls.querySelectorAll<HTMLButtonElement>("button"));
    const chartButtons = buttons.filter((button) => !/CLEAR AMI ROUTE/i.test(button.textContent || ""));
    if (!chartButtons.length) addAction(panel, "NO LAYER CONTROLS", () => {}, true);
    chartButtons.forEach((source) => {
      const text = (source.textContent || "").trim();
      addAction(panel, text, () => source.click(), source.disabled, /\bON\b/i.test(text));
    });
  });

  categoryRow(menu, "WEATHER", (panel) => {
    if (amiWx instanceof HTMLButtonElement) moveExistingButton(panel, amiWx);

    if (layerControls instanceof HTMLElement) {
      const clearAmi = Array.from(layerControls.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
        /CLEAR AMI ROUTE/i.test(button.textContent || ""),
      );
      if (clearAmi) addAction(panel, "CLEAR AMI ROUTE", () => clearAmi.click(), clearAmi.disabled);
    }

    if (wxPanel instanceof HTMLElement) {
      Array.from(wxPanel.querySelectorAll("label")).forEach((label) => {
        const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox) return;
        const text = (label.textContent || "").replace(/\s+/g, " ").trim() || "WEATHER LAYER";
        addAction(panel, `${text}${checkbox.checked ? "  ✓" : ""}`, () => checkbox.click(), checkbox.disabled, checkbox.checked);
      });

      Array.from(wxPanel.querySelectorAll<HTMLInputElement>('input[type="range"]')).forEach((range, index) => {
        const labelText = range.getAttribute("aria-label") || (index === 0 ? "FORECAST TIME" : `WEATHER RANGE ${index + 1}`);
        addRange(panel, range, labelText.toUpperCase());
      });
    }
  });

  categoryRow(menu, "DISPLAY", (panel) => {
    if (sunEvents instanceof HTMLButtonElement) moveExistingButton(panel, sunEvents);
    else addAction(panel, "NO DISPLAY CONTROLS", () => {}, true);
  });
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
      buildCategorizedMenu();
      if (!document.getElementById("navdash-map-context-menu")) {
        document.getElementById("navdash-map-context-submenu")?.remove();
      }
    };

    const closeSubmenuOnOutside = (event: PointerEvent) => {
      const submenu = document.getElementById("navdash-map-context-submenu");
      const root = document.getElementById("navdash-map-context-menu");
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (submenu && !submenu.contains(target) && (!root || !root.contains(target))) submenu.remove();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 500);
    document.addEventListener("pointerdown", closeSubmenuOnOutside, true);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("pointerdown", closeSubmenuOnOutside, true);
      document.getElementById("navdash-map-context-submenu")?.remove();
    };
  }, []);

  return null;
}
