"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function important(el: HTMLElement | null, prop: string, value: string) {
  if (!el) return;
  el.style.setProperty(prop, value, "important");
}

function hideTechnicalWxDetails(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("div,span,p").forEach((el) => {
    const text = (el.textContent || "").trim();
    if (!text) return;

    if (/^Isobar Samples$/i.test(text)) {
      const row = el.parentElement;
      if (row) important(row, "display", "none");
      return;
    }

    if (/^(\d+\s+)?(wind|map|grib|isobar)?\s*samples?$/i.test(text)) {
      important(el, "display", "none");
      return;
    }

    if (/\.exe\b/i.test(text) || /executable/i.test(text) || /sample(?:d)?\s+points?/i.test(text)) {
      const isDataSourceDetail =
        !!el.parentElement?.querySelector("div") &&
        /Data Source/i.test(el.parentElement?.textContent || "");
      if (isDataSourceDetail || /\.exe\b/i.test(text)) important(el, "display", "none");
    }
  });
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findPlanningCard(root: HTMLElement) {
  const heading = Array.from(root.querySelectorAll<HTMLElement>("div,span")).find((el) => {
    const text = (el.textContent || "").trim();
    return text === "Planning" || text === "Projection Origin";
  });
  return heading?.parentElement as HTMLElement | null;
}

function readAisSog(root: HTMLElement) {
  const label = Array.from(root.querySelectorAll<HTMLElement>("div,span")).find(
    (el) => (el.textContent || "").trim() === "SOG / COG",
  );
  const field = label?.parentElement as HTMLElement | null;
  const value = field?.querySelector<HTMLElement>(".font-black")?.textContent || "";
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*kt/i);
  const sog = match ? Number(match[1]) : NaN;
  return Number.isFinite(sog) ? sog : null;
}

function ensurePlanningUi(root: HTMLElement) {
  const card = findPlanningCard(root);
  if (!card) return;

  const heading = Array.from(card.querySelectorAll<HTMLElement>("div,span")).find((el) => {
    const text = (el.textContent || "").trim();
    return text === "Planning" || text === "Projection Origin";
  });
  if (heading && heading.textContent !== "Projection Origin") heading.textContent = "Projection Origin";

  card.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const text = (button.textContent || "").trim();
    if (text === "Current") button.textContent = "Current Position";
    if (text === "Departure") button.textContent = "Departure Position";
  });

  const speedLabel = Array.from(card.querySelectorAll<HTMLElement>("span")).find((el) => {
    const text = (el.textContent || "").trim();
    return text === "Planning Speed" || text === "ETA Speed (kt)";
  });
  if (speedLabel && speedLabel.textContent !== "ETA Speed (kt)") speedLabel.textContent = "ETA Speed (kt)";

  const speedInput = card.querySelector<HTMLInputElement>('input[type="number"]');
  if (!speedInput) return;

  let helper = card.querySelector<HTMLElement>("[data-wxr-eta-speed-helper]");
  if (!helper) {
    helper = document.createElement("div");
    helper.dataset.wxrEtaSpeedHelper = "true";
    helper.style.cssText = "margin-top:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;font:700 10px system-ui;color:#8294a5";

    const readout = document.createElement("span");
    readout.dataset.wxrAisSog = "true";
    readout.textContent = "AIS SOG: --";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.wxrUseAisSog = "true";
    button.textContent = "Use AIS SOG";
    button.disabled = true;
    button.style.cssText = "height:26px;padding:0 8px;border:1px solid rgba(201,162,39,.55);border-radius:3px;background:#071019;color:#e7c95c;font:900 9px system-ui;letter-spacing:.04em;opacity:.45";
    button.addEventListener("click", () => {
      const sog = Number(button.dataset.sog);
      if (Number.isFinite(sog) && sog >= 0) setReactInputValue(speedInput, sog.toFixed(1));
    });

    const note = document.createElement("span");
    note.textContent = "Drives leg ETAs.";

    helper.append(readout, button, note);
    speedInput.closest("label")?.insertAdjacentElement("afterend", helper);
  }
}

function refreshPlanningUi(root: HTMLElement) {
  ensurePlanningUi(root);
  const card = findPlanningCard(root);
  if (!card) return;

  const readout = card.querySelector<HTMLElement>("[data-wxr-ais-sog]");
  const button = card.querySelector<HTMLButtonElement>("[data-wxr-use-ais-sog]");
  if (!readout || !button) return;

  const sog = readAisSog(root);
  const nextReadout = sog === null ? "AIS SOG: --" : `AIS SOG: ${sog.toFixed(1)} kt`;
  if (readout.textContent !== nextReadout) readout.textContent = nextReadout;

  const enabled = sog !== null;
  if (button.disabled === enabled) button.disabled = !enabled;
  const nextOpacity = enabled ? "1" : ".45";
  if (button.style.opacity !== nextOpacity) button.style.opacity = nextOpacity;
  const nextSog = enabled ? String(sog) : "";
  if (button.dataset.sog !== nextSog) button.dataset.sog = nextSog;
}

function monthName(month: number) {
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][month - 1] || "";
}

function cleanWeatherTime(value: string) {
  const text = value.trim();
  const utc = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+UTC$/i.exec(text);
  if (utc) return `${utc[3]} ${monthName(Number(utc[2]))} ${utc[4]}${utc[5]}Z`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (iso) return `${iso[3]} ${monthName(Number(iso[2]))} ${iso[4]}${iso[5]}Z`;
  return text;
}

function compassDirection(degrees: number) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = ((degrees % 360) + 360) % 360;
  return points[Math.round(normalized / 45) % 8];
}

function cleanWind(value: string) {
  const match = /^([\d.]+)\s*kt\s+from\s+([\d.]+)\s*(?:deg|°)$/i.exec(value.trim());
  if (!match) return value;
  const speed = Number(match[1]);
  const direction = Number(match[2]);
  if (!Number.isFinite(speed) || !Number.isFinite(direction)) return value;
  return `${compassDirection(direction)} ${speed.toFixed(1)} kt`;
}

function cleanEta(value: string) {
  const match = /^(\d{2})\/(\d{2})\s+(\d{4})$/.exec(value.trim());
  if (!match) return value;
  return `${match[2]} ${monthName(Number(match[1]))} ${match[3]} LT`;
}

function cleanRouteWeatherCards(root: HTMLElement) {
  const noaaOnly = (() => {
    try { return window.localStorage.getItem("navdash-wx-routing-source") === "noaa"; } catch { return false; }
  })();

  root.querySelectorAll<HTMLElement>("div").forEach((label) => {
    const text = (label.textContent || "").trim();
    if (!["WX Time", "Wind", "ETA WPT", "Seas"].includes(text)) return;
    const field = label.parentElement;
    const value = field?.querySelector<HTMLElement>(":scope > .font-black");
    if (!value) return;
    const current = (value.textContent || "").trim();
    let next = current;
    if (text === "WX Time") next = cleanWeatherTime(current);
    if (text === "Wind") next = cleanWind(current);
    if (text === "ETA WPT") next = cleanEta(current);
    if (text === "Seas" && noaaOnly && /^0(?:\.0+)?\s*ft$/i.test(current)) next = "--";
    if (next !== current) value.textContent = next;
  });
}

function compactWxLayout(shell: HTMLElement, header: HTMLElement) {
  const intro = header.querySelector<HTMLElement>("p");
  if (intro) important(intro, "display", "none");
  const heading = header.querySelector<HTMLElement>("h1");
  if (heading) important(heading, "font-size", "17px");

  const mainGrid = Array.from(shell.querySelectorAll<HTMLElement>("section")).find((el) =>
    el.className.includes("xl:grid-cols-[21rem_minmax(0,1fr)_22rem]"),
  );
  if (mainGrid) {
    important(mainGrid, "gap", "6px");
    important(mainGrid, "grid-template-columns", "17rem minmax(0,1fr) 18rem");
  }

  const map = shell.querySelector<HTMLElement>(".maplibregl-map");
  const mapFrame = map?.parentElement?.parentElement as HTMLElement | null;
  if (mapFrame) important(mapFrame, "border-radius", "3px");

  const routeStrip = Array.from(shell.querySelectorAll<HTMLElement>("div")).find((el) =>
    (el.textContent || "").trim() === "Route Weather Strip",
  )?.parentElement?.parentElement as HTMLElement | null;
  if (routeStrip) important(routeStrip, "margin-top", "6px");
}

export function WxRoutingBridgeSkin() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/wx-routing") return;

    let cancelled = false;
    let retryTimer = 0;
    let refreshTimer = 0;
    let observer: MutationObserver | null = null;

    const apply = () => {
      if (cancelled) return;

      const main = document.querySelector<HTMLElement>("main");
      const shell = main?.firstElementChild as HTMLElement | null;
      const header = shell?.querySelector<HTMLElement>(":scope > header") || null;
      if (!main || !shell || !header) {
        retryTimer = window.setTimeout(apply, 100);
        return;
      }

      const globalNav = document.querySelector<HTMLElement>("body > nav");
      if (globalNav) important(globalNav, "display", "none");

      important(main, "background", "#04080c");
      important(main, "color", "#dbe5ee");
      important(shell, "padding", "5px");
      important(shell, "gap", "4px");

      let topbar = document.getElementById("wxr-v2-topbar");
      if (!topbar) {
        topbar = document.createElement("div");
        topbar.id = "wxr-v2-topbar";
        topbar.innerHTML = `
          <div class="wxr-brand"><span class="wxr-logo">N</span><span><b>NAVDASH</b><small>M/V MB480 · WEATHER ROUTING</small></span></div>
          <div class="wxr-center"><span class="wxr-live"><i></i>WX ROUTING</span></div>
          <div class="wxr-actions"><a href="/">NAV CONSOLE</a></div>
        `;
        shell.insertBefore(topbar, header);
      }

      topbar.style.cssText = "height:42px;display:grid;grid-template-columns:250px 1fr 160px;align-items:center;padding:0 10px;border:1px solid rgba(201,162,39,.30);background:#071019;color:#e7edf3;font:700 11px system-ui;letter-spacing:.08em";
      const brand = topbar.querySelector<HTMLElement>(".wxr-brand");
      if (brand) brand.style.cssText = "display:flex;align-items:center;gap:8px";
      const logo = topbar.querySelector<HTMLElement>(".wxr-logo");
      if (logo) logo.style.cssText = "display:grid;place-items:center;width:26px;height:26px;border:1px solid #c9a227;color:#e7c95c;font-size:14px;font-weight:900";
      const stack = topbar.querySelector<HTMLElement>(".wxr-brand span:last-child");
      if (stack) stack.style.cssText = "display:flex;flex-direction:column;line-height:1";
      const small = topbar.querySelector<HTMLElement>("small");
      if (small) small.style.cssText = "margin-top:3px;font-size:7px;color:#8294a5;letter-spacing:.13em";
      const center = topbar.querySelector<HTMLElement>(".wxr-center");
      if (center) center.style.cssText = "display:flex;justify-content:center;gap:6px";
      topbar.querySelectorAll<HTMLElement>(".wxr-center span").forEach((el) => {
        el.style.cssText = "padding:4px 8px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#aebdca;font-size:8px";
      });
      const dot = topbar.querySelector<HTMLElement>(".wxr-live i");
      if (dot) dot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;background:#22d3ee;margin-right:6px;box-shadow:0 0 8px rgba(34,211,238,.55)";
      const action = topbar.querySelector<HTMLAnchorElement>(".wxr-actions a");
      if (action) action.style.cssText = "display:inline-flex;height:28px;min-width:100px;align-items:center;justify-content:center;border:1px solid rgba(201,162,39,.55);background:#071019;color:#e7c95c;text-decoration:none;font:900 8px system-ui;letter-spacing:.10em";
      const actions = topbar.querySelector<HTMLElement>(".wxr-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end";

      important(header, "padding", "4px 7px");
      important(header, "margin", "0");
      important(header, "border-radius", "0");
      important(header, "border", "1px solid rgba(148,163,184,.14)");
      important(header, "background", "#071019");
      important(header, "box-shadow", "none");

      const heading = header.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.textContent = "WX ROUTING";
        heading.style.cssText = "margin:0;color:#edf4fa;font-size:17px;font-weight:900;letter-spacing:.08em";
      }
      const kicker = header.querySelector<HTMLElement>("div > div");
      if (kicker) kicker.style.cssText = "color:#c9a227;font-size:7px;font-weight:900;letter-spacing:.15em;text-transform:uppercase";

      header.querySelectorAll<HTMLElement>("button,label").forEach((el) => {
        important(el, "border-radius", "3px");
        important(el, "height", "28px");
        important(el, "padding", "0 8px");
        important(el, "font-size", "8px");
        important(el, "font-weight", "900");
        important(el, "letter-spacing", ".05em");
        important(el, "box-shadow", "none");
      });

      shell.querySelectorAll<HTMLElement>("section, aside").forEach((el) => {
        if (el.closest("header")) return;
        important(el, "border-radius", "0");
        important(el, "box-shadow", "none");
      });

      shell.querySelectorAll<HTMLElement>("button").forEach((el) => {
        important(el, "border-radius", "3px");
        important(el, "box-shadow", "none");
      });

      hideTechnicalWxDetails(shell);
      cleanRouteWeatherCards(shell);
      refreshPlanningUi(shell);
      compactWxLayout(shell, header);

      if (!observer) {
        observer = new MutationObserver(() => {
          hideTechnicalWxDetails(shell);
          cleanRouteWeatherCards(shell);
          compactWxLayout(shell, header);
        });
        observer.observe(shell, { childList: true, subtree: true, characterData: true });
      }

      if (!refreshTimer) {
        refreshTimer = window.setInterval(() => {
          if (!cancelled) {
            refreshPlanningUi(shell);
            cleanRouteWeatherCards(shell);
          }
        }, 750);
      }
    };

    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(refreshTimer);
      observer?.disconnect();
      document.getElementById("wxr-v2-topbar")?.remove();
    };
  }, [pathname]);

  return null;
}