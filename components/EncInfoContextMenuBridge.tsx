"use client";

import { useEffect } from "react";

const MAP_SURFACE_ID = "navmap-main-isolated-v2";
const ROOT_MENU_ID = "navdash-map-context-menu";
const INFO_ROW_ID = "navdash-enc-info-context-row";

function menuTheme() {
  return document.documentElement.getAttribute("data-navdash-theme") === "day"
    ? { text: "#17212b", hover: "#f3f6f8" }
    : { text: "#e7edf3", hover: "#15212c" };
}

function invokeEncInfo(clientX: number, clientY: number) {
  const surface = document.getElementById(MAP_SURFACE_ID) as any;
  const map = surface?.__navdashLeafletMap;
  const control = document.querySelector<HTMLButtonElement>(".navdash-enc-control");
  if (!(surface instanceof HTMLElement) || !map || !(control instanceof HTMLButtonElement)) return;

  const rect = surface.getBoundingClientRect();
  const latlng = map.containerPointToLatLng([clientX - rect.left, clientY - rect.top]);
  if (!latlng) return;

  if (control.getAttribute("data-active") !== "true") control.click();
  map.fire("click", { latlng });

  const originalClosePopup = map.closePopup;
  try {
    map.closePopup = () => map;
    if (control.getAttribute("data-active") === "true") control.click();
  } finally {
    map.closePopup = originalClosePopup;
  }
}

export function EncInfoContextMenuBridge() {
  useEffect(() => {
    let lastPoint: { x: number; y: number } | null = null;

    const hideLegacyControl = () => {
      const control = document.querySelector<HTMLElement>(".navdash-enc-control");
      if (control) control.style.setProperty("display", "none", "important");
    };

    const captureContextPoint = (event: MouseEvent) => {
      const surface = document.getElementById(MAP_SURFACE_ID);
      if (!(surface instanceof HTMLElement) || !surface.contains(event.target as Node)) return;
      lastPoint = { x: event.clientX, y: event.clientY };
    };

    const injectInfoRow = () => {
      hideLegacyControl();
      const menu = document.getElementById(ROOT_MENU_ID);
      if (!(menu instanceof HTMLElement) || menu.querySelector(`#${INFO_ROW_ID}`)) return;

      const theme = menuTheme();
      const row = document.createElement("button");
      row.id = INFO_ROW_ID;
      row.type = "button";
      row.textContent = "INFO";
      row.style.cssText = "display:flex;width:100%;min-width:205px;align-items:center;justify-content:space-between;gap:14px;border:0;background:transparent;padding:10px 12px;text-align:left;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.07em;cursor:pointer;border-radius:4px;white-space:nowrap";
      row.style.color = theme.text;
      row.addEventListener("mouseenter", () => { row.style.background = theme.hover; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
      row.addEventListener("click", () => {
        if (lastPoint) invokeEncInfo(lastPoint.x, lastPoint.y);
        menu.remove();
      });
      menu.prepend(row);
    };

    const observer = new MutationObserver(injectInfoRow);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("contextmenu", captureContextPoint, true);
    const timer = window.setInterval(() => {
      hideLegacyControl();
      injectInfoRow();
    }, 500);

    hideLegacyControl();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("contextmenu", captureContextPoint, true);
    };
  }, []);

  return null;
}
