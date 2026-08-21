"use client";

import { useEffect } from "react";

function setImportant(el: HTMLElement | null, property: string, value: string) {
  if (!el) return;
  el.style.setProperty(property, value, "important");
}

export function BridgeConsolePreview() {
  useEffect(() => {
    let attempts = 0;
    let timer = 0;

    const apply = () => {
      attempts += 1;

      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      const chart = document.getElementById("v12-section-chart") as HTMLElement | null;
      const map = document.getElementById("v12-map") as HTMLElement | null;
      const route = document.getElementById("v12-section-route") as HTMLElement | null;

      if (!shell || !chart || !map || !route) {
        if (attempts < 60) timer = window.setTimeout(apply, 100);
        return;
      }

      shell.dataset.bridgeConsole = "active";
      setImportant(shell, "padding", "8px");
      setImportant(shell, "background", "#05090e");

      const shellChildren = Array.from(shell.children) as HTMLElement[];
      const header = shellChildren.find((el) => el.tagName === "HEADER") || null;
      const navStrip = header?.nextElementSibling as HTMLElement | null;
      const mainGrid = navStrip?.nextElementSibling as HTMLElement | null;
      const rail = route.parentElement as HTMLElement | null;

      if (header) {
        header.dataset.bridgeRole = "header";
        setImportant(header, "margin-bottom", "6px");
        setImportant(header, "padding", "8px 10px");
        setImportant(header, "border-radius", "8px");
        setImportant(header, "background", "#091119");
        setImportant(header, "box-shadow", "none");
      }

      if (navStrip) {
        navStrip.dataset.bridgeRole = "nav";
        setImportant(navStrip, "display", "flex");
        setImportant(navStrip, "gap", "6px");
        setImportant(navStrip, "margin-bottom", "6px");
      }

      if (mainGrid) {
        mainGrid.dataset.bridgeRole = "main-grid";
        setImportant(mainGrid, "display", "grid");
        setImportant(mainGrid, "grid-template-columns", "minmax(0, 1fr) 300px");
        setImportant(mainGrid, "gap", "8px");
        setImportant(mainGrid, "align-items", "start");
      }

      chart.dataset.bridgeRole = "chart";
      setImportant(chart, "padding", "8px");
      setImportant(chart, "border-radius", "8px");
      setImportant(chart, "background", "#08111a");
      setImportant(chart, "box-shadow", "none");

      map.dataset.bridgeRole = "map";
      setImportant(map, "display", "block");
      setImportant(map, "width", "100%");
      setImportant(map, "height", "calc(100vh - 190px)");
      setImportant(map, "min-height", "560px");
      setImportant(map, "border-radius", "6px");
      setImportant(map, "background", "#0b1722");
      setImportant(map, "position", "relative");
      setImportant(map, "z-index", "1");

      if (rail) {
        rail.dataset.bridgeRole = "rail";
        setImportant(rail, "display", "grid");
        setImportant(rail, "gap", "8px");
        setImportant(rail, "width", "300px");
      }

      setImportant(route, "padding", "8px");
      setImportant(route, "border-radius", "8px");
      setImportant(route, "background", "#08111a");
      setImportant(route, "box-shadow", "none");

      const badgeId = "bridge-console-runtime-badge";
      let badge = document.getElementById(badgeId) as HTMLElement | null;
      if (!badge) {
        badge = document.createElement("div");
        badge.id = badgeId;
        badge.textContent = "BRIDGE CONSOLE LAYOUT ACTIVE";
        document.body.appendChild(badge);
      }
      badge.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:100000;background:#c9a227;color:#071019;padding:8px 12px;border-radius:6px;font:800 12px system-ui;letter-spacing:.08em;box-shadow:0 6px 20px rgba(0,0,0,.45)";

      for (const delay of [0, 100, 350, 900]) {
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay);
      }
    };

    apply();
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
