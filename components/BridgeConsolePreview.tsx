"use client";

import { useEffect } from "react";

function setImportant(el: HTMLElement | null, property: string, value: string) {
  if (!el) return;
  el.style.setProperty(property, value, "important");
}

function findTextBlock(root: HTMLElement, label: string) {
  return Array.from(root.querySelectorAll<HTMLElement>("div")).find((el) => el.textContent?.trim() === label) || null;
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

      // Purpose-built top status bar.
      let statusBar = document.getElementById("bridge-console-statusbar") as HTMLElement | null;
      if (!statusBar) {
        statusBar = document.createElement("div");
        statusBar.id = "bridge-console-statusbar";
        statusBar.innerHTML = `
          <div class="bc-brand"><span class="bc-mark">N</span><span><b>NAVDASH 1.3</b><small>M/V MB480</small></span></div>
          <div class="bc-status"><span class="bc-chip"><i></i>AIS</span><span class="bc-chip">ROUTE</span><span class="bc-chip">WX</span></div>
          <div class="bc-mode">BRIDGE CONSOLE</div>
        `;
        shell.insertBefore(statusBar, shell.firstChild);
      }
      statusBar.style.cssText = "height:54px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 14px;margin-bottom:6px;border:1px solid rgba(201,162,39,.28);border-radius:8px;background:#08111a;color:#e5edf5;box-shadow:inset 0 1px 0 rgba(255,255,255,.025);font-family:system-ui,sans-serif";
      const brand = statusBar.querySelector<HTMLElement>(".bc-brand");
      if (brand) brand.style.cssText = "display:flex;align-items:center;gap:9px;letter-spacing:.08em";
      const mark = statusBar.querySelector<HTMLElement>(".bc-mark");
      if (mark) mark.style.cssText = "display:grid;place-items:center;width:32px;height:32px;border:1px solid #c9a227;border-radius:5px;color:#e7c95c;font-weight:900";
      const brandText = statusBar.querySelector<HTMLElement>(".bc-brand span:last-child");
      if (brandText) brandText.style.cssText = "display:flex;flex-direction:column;line-height:1.05";
      const small = statusBar.querySelector<HTMLElement>("small");
      if (small) small.style.cssText = "font-size:9px;color:#8fa3b6;margin-top:4px;letter-spacing:.18em";
      const status = statusBar.querySelector<HTMLElement>(".bc-status");
      if (status) status.style.cssText = "display:flex;align-items:center;gap:8px;flex:1;justify-content:center";
      statusBar.querySelectorAll<HTMLElement>(".bc-chip").forEach((chip) => {
        chip.style.cssText = "padding:6px 10px;border:1px solid rgba(148,163,184,.18);border-radius:4px;background:#050b11;color:#b9c7d4;font-size:10px;font-weight:800;letter-spacing:.12em";
      });
      const dot = statusBar.querySelector<HTMLElement>(".bc-chip i");
      if (dot) dot.style.cssText = "display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:#34d399;box-shadow:0 0 10px rgba(52,211,153,.5)";
      const mode = statusBar.querySelector<HTMLElement>(".bc-mode");
      if (mode) mode.style.cssText = "font-size:10px;font-weight:900;letter-spacing:.16em;color:#e7c95c";

      if (header) {
        header.dataset.bridgeRole = "utilities";
        setImportant(header, "margin-bottom", "6px");
        setImportant(header, "padding", "6px 8px");
        setImportant(header, "border-radius", "6px");
        setImportant(header, "background", "#091119");
        setImportant(header, "box-shadow", "none");
        const firstRow = header.firstElementChild as HTMLElement | null;
        if (firstRow) {
          setImportant(firstRow, "display", "flex");
          setImportant(firstRow, "justify-content", "flex-end");
          setImportant(firstRow, "align-items", "center");
          setImportant(firstRow, "gap", "6px");
        }
        const branding = firstRow?.firstElementChild as HTMLElement | null;
        if (branding) setImportant(branding, "display", "none");
        header.querySelectorAll<HTMLElement>("button, label").forEach((control) => {
          setImportant(control, "width", "auto");
          setImportant(control, "min-width", "92px");
          setImportant(control, "height", "34px");
          setImportant(control, "padding", "0 10px");
          setImportant(control, "border-radius", "5px");
          setImportant(control, "font-size", "11px");
          setImportant(control, "box-shadow", "none");
        });
      }

      if (mainGrid) {
        mainGrid.dataset.bridgeRole = "main-grid";
        setImportant(mainGrid, "display", "grid");
        setImportant(mainGrid, "grid-template-columns", "minmax(0, 1fr) 292px");
        setImportant(mainGrid, "gap", "8px");
        setImportant(mainGrid, "align-items", "stretch");
      }

      // Move primary nav below the map/rail like the mockup.
      if (navStrip && mainGrid && navStrip.previousElementSibling === header) {
        mainGrid.insertAdjacentElement("afterend", navStrip);
      }
      if (navStrip) {
        navStrip.dataset.bridgeRole = "nav";
        setImportant(navStrip, "display", "grid");
        setImportant(navStrip, "grid-template-columns", "repeat(4,minmax(0,1fr))");
        setImportant(navStrip, "gap", "6px");
        setImportant(navStrip, "margin", "6px 0 0");
        navStrip.querySelectorAll<HTMLElement>("button").forEach((button) => {
          setImportant(button, "padding", "9px 10px");
          setImportant(button, "border-radius", "5px");
          setImportant(button, "font-size", "11px");
        });
      }

      chart.dataset.bridgeRole = "chart";
      setImportant(chart, "padding", "6px");
      setImportant(chart, "border-radius", "7px");
      setImportant(chart, "background", "#08111a");
      setImportant(chart, "box-shadow", "none");
      const chartHead = chart.firstElementChild as HTMLElement | null;
      if (chartHead) setImportant(chartHead, "display", "none");
      const navNote = map.nextElementSibling as HTMLElement | null;
      if (navNote) setImportant(navNote, "display", "none");

      map.dataset.bridgeRole = "map";
      setImportant(map, "display", "block");
      setImportant(map, "width", "100%");
      setImportant(map, "height", "calc(100vh - 178px)");
      setImportant(map, "min-height", "600px");
      setImportant(map, "border-radius", "5px");
      setImportant(map, "background", "#0b1722");
      setImportant(map, "position", "relative");
      setImportant(map, "z-index", "1");

      if (rail) {
        rail.dataset.bridgeRole = "rail";
        setImportant(rail, "display", "grid");
        setImportant(rail, "grid-template-rows", "auto 1fr");
        setImportant(rail, "gap", "6px");
        setImportant(rail, "width", "292px");
      }

      setImportant(route, "padding", "8px");
      setImportant(route, "border-radius", "7px");
      setImportant(route, "background", "#08111a");
      setImportant(route, "box-shadow", "none");

      // Flatten voyage snapshot cards into instrument readouts.
      const snapshotGrid = route.children[1] as HTMLElement | undefined;
      if (snapshotGrid) {
        setImportant(snapshotGrid, "display", "grid");
        setImportant(snapshotGrid, "grid-template-columns", "1fr 1fr");
        setImportant(snapshotGrid, "gap", "6px");
        setImportant(snapshotGrid, "margin-top", "6px");
        Array.from(snapshotGrid.children).forEach((child, index) => {
          const el = child as HTMLElement;
          setImportant(el, "border-radius", "5px");
          setImportant(el, "padding", "8px");
          setImportant(el, "background", "#050b11");
          setImportant(el, "border", "1px solid rgba(148,163,184,.14)");
          if (index < 2) setImportant(el, "grid-column", "1 / -1");
        });
      }
      route.querySelectorAll<HTMLElement>(".text-2xl").forEach((value) => {
        setImportant(value, "font-size", "24px");
        setImportant(value, "line-height", "1.1");
      });
      route.querySelectorAll<HTMLElement>(".text-xl,.text-lg").forEach((value) => {
        setImportant(value, "font-size", "15px");
        setImportant(value, "line-height", "1.2");
      });

      // Make the active-leg control read like a compact console module.
      const activeLeg = route.nextElementSibling as HTMLElement | null;
      if (activeLeg) {
        setImportant(activeLeg, "padding", "8px");
        setImportant(activeLeg, "border-radius", "7px");
        setImportant(activeLeg, "background", "#08111a");
        setImportant(activeLeg, "box-shadow", "none");
        activeLeg.querySelectorAll<HTMLElement>("button").forEach((button) => {
          setImportant(button, "border-radius", "4px");
          setImportant(button, "padding", "8px 6px");
          setImportant(button, "font-size", "10px");
        });
      }

      let badge = document.getElementById("bridge-console-runtime-badge") as HTMLElement | null;
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "bridge-console-runtime-badge";
        badge.textContent = "BRIDGE CONSOLE LAYOUT ACTIVE";
        document.body.appendChild(badge);
      }
      badge.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:100000;background:#c9a227;color:#071019;padding:7px 10px;border-radius:5px;font:800 10px system-ui;letter-spacing:.08em;box-shadow:0 6px 20px rgba(0,0,0,.45)";

      for (const delay of [0, 100, 350, 900]) {
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay);
      }
    };

    apply();
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
