"use client";

import { useEffect } from "react";

const MAP_HOST_ID = "v12-map";
const MAP_SURFACE_ID = "navmap-main-isolated-v2";
const ROOT_MENU_ID = "navdash-map-context-menu";
const SUBMENU_ID = "navdash-map-context-submenu";

function mapHost() {
  return document.getElementById(MAP_HOST_ID);
}

function mapSurface() {
  return document.getElementById(MAP_SURFACE_ID);
}

function findToolGroup(host: HTMLElement) {
  const tools = Array.from(host.children).find((element) => {
    if (!(element instanceof HTMLElement)) return false;
    return /z-index:\s*760/.test(element.getAttribute("style") || "");
  });
  return tools instanceof HTMLElement && tools.firstElementChild instanceof HTMLElement
    ? tools.firstElementChild
    : null;
}

function originalButton(host: HTMLElement, label: string) {
  const group = findToolGroup(host);
  if (!group) return null;
  return Array.from(group.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => (button.textContent || "").trim().toUpperCase() === label,
  ) || null;
}

function originalToggle(host: HTMLElement, label: string) {
  const group = findToolGroup(host);
  if (!group) return null;
  return Array.from(group.querySelectorAll<HTMLLabelElement>("label")).find(
    (item) => (item.textContent || "").trim().toUpperCase().includes(label),
  ) || null;
}

function syncMeasureReadout(host: HTMLElement) {
  const label = host.querySelector<HTMLElement>(".navmap-measure-label");
  let readout = document.getElementById("navdash-measure-readout");
  if (!label?.textContent?.trim()) {
    readout?.remove();
    return;
  }
  label.style.setProperty("display", "none", "important");
  if (!(readout instanceof HTMLElement)) {
    readout = document.createElement("div");
    readout.id = "navdash-measure-readout";
    readout.style.cssText = "position:absolute;top:72px;right:12px;z-index:1200;padding:7px 10px;border:1px solid #22d3ee;background:rgba(7,16,25,.94);color:#d9fbff;border-radius:4px;font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    host.appendChild(readout);
  }
  readout.textContent = label.textContent.trim();
}

function findWxPanel(host: HTMLElement) {
  return Array.from(host.children).find((element) => {
    if (!(element instanceof HTMLElement)) return false;
    return /z-index:\s*770/.test(element.getAttribute("style") || "");
  }) as HTMLElement | undefined;
}

function ensureWxPanelOpen(panel: HTMLElement | undefined) {
  if (!panel) return;
  const toggle = Array.from(panel.querySelectorAll("button")).find((button) =>
    (button.textContent || "").trim().toUpperCase() === "WX LAYERS",
  );
  if (toggle instanceof HTMLButtonElement && !panel.querySelector('input[type="checkbox"], input[type="range"]')) toggle.click();
}

function findNoaaCheckbox(panel: HTMLElement | undefined) {
  if (!panel) return null;
  const heading = Array.from(panel.querySelectorAll("strong, span, div")).find((element) =>
    (element.textContent || "").trim().toUpperCase() === "NOAA ROUTE WX",
  );
  const direct = heading?.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (direct) return direct;
  return Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((checkbox) => {
    const text = (checkbox.closest("label")?.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
    return text.includes("NOAA") || text.includes("ROUTE WX");
  }) || null;
}

function menuTheme() {
  return document.documentElement.getAttribute("data-navdash-theme") === "day"
    ? { background: "rgba(255,255,255,.98)", text: "#17212b", muted: "#586773", hover: "#f3f6f8", active: "#006f78", border: "rgba(15,23,42,.22)" }
    : { background: "rgba(5,12,18,.98)", text: "#e7edf3", muted: "#91a0ad", hover: "#15212c", active: "#22d3ee", border: "rgba(241,213,107,.32)" };
}

function styleMenuPanel(panel: HTMLElement, zIndex = 1800) {
  const theme = menuTheme();
  panel.style.cssText = `position:absolute;z-index:${zIndex};min-width:218px;padding:6px;border-radius:7px;box-shadow:0 10px 28px rgba(0,0,0,.34);backdrop-filter:blur(8px);user-select:none;-webkit-user-select:none`;
  panel.style.background = theme.background;
  panel.style.border = `1px solid ${theme.border}`;
}

function styleMenuRow(row: HTMLElement, active = false, disabled = false) {
  const theme = menuTheme();
  row.style.cssText = "display:flex;width:100%;min-width:205px;align-items:center;justify-content:space-between;gap:14px;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px;white-space:nowrap";
  row.style.color = active ? theme.active : disabled ? theme.muted : theme.text;
  row.style.opacity = disabled ? "0.45" : "1";
}

function closeMenus() {
  document.getElementById(SUBMENU_ID)?.remove();
  document.getElementById(ROOT_MENU_ID)?.remove();
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
    row.addEventListener("click", () => { action(); closeMenus(); });
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
  range.style.cssText = "width:100%;accent-color:#22d3ee;touch-action:none";
  const pushValue = () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(source, range.value);
    else source.value = range.value;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
  };
  range.addEventListener("input", pushValue);
  range.addEventListener("change", pushValue);
  wrap.append(label, range);
  panel.appendChild(wrap);
}

function openSubmenu(anchor: HTMLElement, build: (panel: HTMLElement) => void) {
  document.getElementById(SUBMENU_ID)?.remove();
  const rootMenu = document.getElementById(ROOT_MENU_ID);
  if (!(rootMenu instanceof HTMLElement)) return;
  const panel = document.createElement("div");
  panel.id = SUBMENU_ID;
  panel.setAttribute("role", "menu");
  styleMenuPanel(panel);
  build(panel);
  rootMenu.appendChild(panel);
  const anchorRect = anchor.getBoundingClientRect();
  const rootRect = rootMenu.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const gap = 5;
  const right = anchorRect.right + gap;
  const left = anchorRect.left - panelRect.width - gap;
  const viewportLeft = right + panelRect.width <= window.innerWidth - 6 ? right : Math.max(6, left);
  let viewportTop = Math.min(anchorRect.top, window.innerHeight - panelRect.height - 6);
  viewportTop = Math.max(6, viewportTop);
  panel.style.left = `${viewportLeft - rootRect.left}px`;
  panel.style.top = `${viewportTop - rootRect.top}px`;
}

function categoryRow(menu: HTMLElement, label: string, build: (panel: HTMLElement) => void) {
  const theme = menuTheme();
  const row = document.createElement("button");
  row.type = "button";
  row.innerHTML = `<span>${label}</span><span style="font-size:14px;opacity:.72">›</span>`;
  styleMenuRow(row);
  const show = () => openSubmenu(row, build);
  row.addEventListener("mouseenter", () => { row.style.background = theme.hover; show(); });
  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
  row.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); show(); });
  menu.appendChild(row);
}

function buildCategorizedMenu(host: HTMLElement, menu: HTMLElement) {
  const wxPanel = findWxPanel(host);
  ensureWxPanelOpen(wxPanel);
  const layerControls = document.getElementById("bc-map-layer-controls");
  const pan = originalButton(host, "PAN");
  const fromShip = originalButton(host, "FROM SHIP");
  const twoPoints = originalButton(host, "TWO POINTS");
  const clearMeasure = originalButton(host, "CLEAR MEASURE");
  const sunLabel = originalToggle(host, "SUN EVENTS");
  const sunInput = sunLabel?.querySelector<HTMLInputElement>('input[type="checkbox"]') || null;
  const amiLabel = originalToggle(host, "AMI WX");
  const amiInput = amiLabel?.querySelector<HTMLInputElement>('input[type="checkbox"]') || null;

  categoryRow(menu, "MEASURE", (panel) => {
    addAction(panel, "PAN", () => pan?.click(), !(pan instanceof HTMLButtonElement), Boolean(pan?.style.border.includes("34,211,238")));
    addAction(panel, "FROM SHIP", () => fromShip?.click(), !(fromShip instanceof HTMLButtonElement), Boolean(fromShip?.style.border.includes("34,211,238")));
    addAction(panel, "TWO POINTS", () => twoPoints?.click(), !(twoPoints instanceof HTMLButtonElement), Boolean(twoPoints?.style.border.includes("34,211,238")));
    addAction(panel, "CLEAR MEASURE", () => { clearMeasure?.click(); pan?.click(); window.setTimeout(() => syncMeasureReadout(host), 60); }, !(clearMeasure instanceof HTMLButtonElement));
  });

  categoryRow(menu, "CHART LAYERS", (panel) => {
    if (!(layerControls instanceof HTMLElement)) return addAction(panel, "NO LAYER CONTROLS", () => {}, true);
    const buttons = Array.from(layerControls.querySelectorAll<HTMLButtonElement>("button")).filter((button) => !/CLEAR AMI ROUTE/i.test(button.textContent || ""));
    if (!buttons.length) addAction(panel, "NO LAYER CONTROLS", () => {}, true);
    buttons.forEach((source) => {
      const text = (source.textContent || "").trim();
      addAction(panel, text, () => source.click(), source.disabled, /\bON\b/i.test(text));
    });
  });

  categoryRow(menu, "WEATHER", (panel) => {
    addAction(panel, `AMI WX${amiInput?.checked ? "  ✓" : ""}`, () => amiInput?.click(), !(amiInput instanceof HTMLInputElement) || amiInput.disabled, Boolean(amiInput?.checked));
    const noaaCheckbox = findNoaaCheckbox(wxPanel);
    if (noaaCheckbox) addAction(panel, `NOAA ROUTE WX ${noaaCheckbox.checked ? "ON" : "OFF"}`, () => noaaCheckbox.click(), noaaCheckbox.disabled, noaaCheckbox.checked);
    else addAction(panel, "NOAA ROUTE WX UNAVAILABLE", () => {}, true);
    if (layerControls instanceof HTMLElement) {
      const clearAmi = Array.from(layerControls.querySelectorAll<HTMLButtonElement>("button")).find((button) => /CLEAR AMI ROUTE/i.test(button.textContent || ""));
      if (clearAmi) addAction(panel, "CLEAR AMI ROUTE", () => clearAmi.click(), clearAmi.disabled);
    }
    if (wxPanel) {
      Array.from(wxPanel.querySelectorAll("label")).forEach((label) => {
        const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox || checkbox === noaaCheckbox) return;
        const text = (label.textContent || "").replace(/\s+/g, " ").trim() || "WEATHER LAYER";
        addAction(panel, `${text}${checkbox.checked ? "  ✓" : ""}`, () => checkbox.click(), checkbox.disabled, checkbox.checked);
      });
      Array.from(wxPanel.querySelectorAll<HTMLInputElement>('input[type="range"]')).forEach((range, index) => {
        addRange(panel, range, (range.getAttribute("aria-label") || (index === 0 ? "FORECAST TIME" : `WEATHER RANGE ${index + 1}`)).toUpperCase());
      });
    }
  });

  categoryRow(menu, "DISPLAY", (panel) => {
    if (sunInput) addAction(panel, `SUN EVENTS${sunInput.checked ? "  ✓" : ""}`, () => sunInput.click(), sunInput.disabled, sunInput.checked);
    else addAction(panel, "NO DISPLAY CONTROLS", () => {}, true);
  });
}

function hideFloatingMenus(host: HTMLElement) {
  const group = findToolGroup(host);
  if (group) group.style.setProperty("display", "none", "important");
  const layerControls = document.getElementById("bc-map-layer-controls");
  if (layerControls instanceof HTMLElement) layerControls.style.setProperty("display", "none", "important");
  const wxPanel = findWxPanel(host);
  if (wxPanel) {
    ensureWxPanelOpen(wxPanel);
    wxPanel.style.setProperty("display", "none", "important");
  }
}

function openRootMenu(host: HTMLElement, clientX: number, clientY: number) {
  closeMenus();
  const menu = document.createElement("div");
  menu.id = ROOT_MENU_ID;
  menu.setAttribute("role", "menu");
  styleMenuPanel(menu, 1700);
  menu.style.overflow = "visible";
  host.appendChild(menu);
  buildCategorizedMenu(host, menu);
  const hostRect = host.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const x = Math.max(6, Math.min(clientX - hostRect.left, hostRect.width - menuRect.width - 6));
  const y = Math.max(6, Math.min(clientY - hostRect.top, hostRect.height - menuRect.height - 6));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

export function MapFloatingControlsContext() {
  useEffect(() => {
    let host: HTMLElement | null = null;
    let surface: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let longPressTimer = 0;
    let pointerStart: { x: number; y: number } | null = null;

    const cancelLongPress = () => {
      window.clearTimeout(longPressTimer);
      longPressTimer = 0;
      pointerStart = null;
    };

    const detachSurface = () => {
      if (!surface) return;
      surface.removeEventListener("contextmenu", onContextMenu);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
      surface = null;
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!host) return;
      event.preventDefault();
      event.stopPropagation();
      openRootMenu(host, event.clientX, event.clientY);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!host || event.pointerType !== "touch" || !event.isPrimary) return;
      cancelLongPress();
      pointerStart = { x: event.clientX, y: event.clientY };
      longPressTimer = window.setTimeout(() => {
        if (!host || !pointerStart) return;
        openRootMenu(host, pointerStart.x, pointerStart.y);
        navigator.vibrate?.(15);
        cancelLongPress();
      }, 650);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 12) cancelLongPress();
    };
    const onPointerUp = () => cancelLongPress();

    const attachSurface = () => {
      const next = mapSurface();
      if (!(next instanceof HTMLElement) || next === surface) return;
      detachSurface();
      surface = next;
      surface.addEventListener("contextmenu", onContextMenu);
      surface.addEventListener("pointerdown", onPointerDown);
      surface.addEventListener("pointermove", onPointerMove);
      surface.addEventListener("pointerup", onPointerUp);
      surface.addEventListener("pointercancel", onPointerUp);
    };

    const sync = () => {
      const nextHost = mapHost();
      if (!(nextHost instanceof HTMLElement)) return;
      if (host !== nextHost) {
        observer?.disconnect();
        host = nextHost;
        observer = new MutationObserver(() => {
          if (!host) return;
          hideFloatingMenus(host);
          attachSurface();
          syncMeasureReadout(host);
        });
        observer.observe(host, { childList: true, subtree: true });
      }
      hideFloatingMenus(host);
      attachSurface();
      syncMeasureReadout(host);
    };

    const closeIfOutside = (event: PointerEvent) => {
      const menu = document.getElementById(ROOT_MENU_ID);
      if (menu && event.target instanceof Node && !menu.contains(event.target)) closeMenus();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenus(); };
    const syncAfterClick = () => window.setTimeout(() => { if (host) syncMeasureReadout(host); }, 60);
    const onResize = () => { closeMenus(); if (host) window.setTimeout(() => syncMeasureReadout(host!), 30); };

    sync();
    const timer = window.setInterval(sync, 500);
    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("click", syncAfterClick, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.clearInterval(timer);
      cancelLongPress();
      detachSurface();
      observer?.disconnect();
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("click", syncAfterClick, true);
      window.removeEventListener("resize", onResize);
      closeMenus();
    };
  }, []);

  return null;
}
