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
    helper.style.cssText = "margin-top:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;font:700 10px system-ui;color:#7f9caf";

    const readout = document.createElement("span");
    readout.dataset.wxrAisSog = "true";
    readout.textContent = "AIS SOG: --";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.wxrUseAisSog = "true";
    button.textContent = "Use AIS SOG";
    button.disabled = true;
    button.style.cssText = "height:26px;padding:0 8px;border:1px solid rgba(242,184,75,.55);border-radius:3px;background:#06111f;color:#f0c46a;font:900 9px system-ui;letter-spacing:.04em;opacity:.45";
    button.addEventListener("click", () => {
      const sog = Number(button.dataset.sog);
      if (Number.isFinite(sog) && sog >= 0) setReactInputValue(speedInput, sog.toFixed(1));
    });

    const note = document.createElement("span");
    note.textContent = "This speed drives leg ETAs.";

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
      globalNav?.style.removeProperty("display");

      important(main, "background", "transparent");
      important(main, "color", "var(--nd-text)");
      important(shell, "padding", "0 28px 22px");
      important(shell, "gap", "18px");
      important(shell, "max-width", "1520px");
      important(shell, "margin", "0 auto");

      let topbar = document.getElementById("wxr-v2-topbar");
      if (!topbar) {
        topbar = document.createElement("div");
        topbar.id = "wxr-v2-topbar";
        topbar.innerHTML = `
          <div class="wxr-brand"><span class="wxr-logo">N</span><span><b>NAVDASH</b><small>M/V MB480 · WEATHER ROUTING</small></span></div>
          <div class="wxr-center"><span class="wxr-live"><i></i>WX ROUTING</span><span>GRIB / ROUTE EXPOSURE</span></div>
          <div class="wxr-actions"><a href="/">NAV CONSOLE</a></div>
        `;
        shell.insertBefore(topbar, header);
      }

      topbar.style.cssText = "display:none";
      const brand = topbar.querySelector<HTMLElement>(".wxr-brand");
      if (brand) brand.style.cssText = "display:flex;align-items:center;gap:9px";
      const logo = topbar.querySelector<HTMLElement>(".wxr-logo");
      if (logo) logo.style.cssText = "display:grid;place-items:center;width:28px;height:28px;border:1px solid #f2b84b;color:#f0c46a;font-size:15px;font-weight:900";
      const stack = topbar.querySelector<HTMLElement>(".wxr-brand span:last-child");
      if (stack) stack.style.cssText = "display:flex;flex-direction:column;line-height:1";
      const small = topbar.querySelector<HTMLElement>("small");
      if (small) small.style.cssText = "margin-top:4px;font-size:8px;color:#7f9caf;letter-spacing:.14em";
      const center = topbar.querySelector<HTMLElement>(".wxr-center");
      if (center) center.style.cssText = "display:flex;justify-content:center;gap:8px";
      topbar.querySelectorAll<HTMLElement>(".wxr-center span").forEach((el) => {
        el.style.cssText = "padding:5px 9px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#aebdca;font-size:9px";
      });
      const dot = topbar.querySelector<HTMLElement>(".wxr-live i");
      if (dot) dot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;background:#22d3ee;margin-right:6px;box-shadow:0 0 8px rgba(34,211,238,.55)";
      const action = topbar.querySelector<HTMLAnchorElement>(".wxr-actions a");
      if (action) action.style.cssText = "display:inline-flex;height:30px;min-width:110px;align-items:center;justify-content:center;border:1px solid rgba(242,184,75,.55);background:#06111f;color:#f0c46a;text-decoration:none;font:900 9px system-ui;letter-spacing:.10em";
      const actions = topbar.querySelector<HTMLElement>(".wxr-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end";

      important(header, "padding", "18px 20px");
      important(header, "margin", "0 0 18px");
      important(header, "border-radius", "14px");
      important(header, "border", "1px solid var(--nd-border)");
      important(header, "background", "var(--nd-panel)");
      important(header, "box-shadow", "0 18px 55px var(--nd-shadow)");

      const heading = header.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.textContent = "WX ROUTING";
        heading.style.cssText = "margin:0;color:var(--nd-text);font-size:20px;font-weight:700;letter-spacing:.02em";
      }
      const kicker = header.querySelector<HTMLElement>("div > div");
      if (kicker) kicker.style.cssText = "color:#f2b84b;font-size:8px;font-weight:900;letter-spacing:.16em;text-transform:uppercase";
      const intro = header.querySelector<HTMLElement>("p");
      if (intro) intro.style.cssText = "margin-top:5px;color:var(--nd-muted);font-size:11px;line-height:1.45";

      header.querySelectorAll<HTMLElement>("button,label").forEach((el) => {
        important(el, "border-radius", "7px");
        important(el, "height", "36px");
        important(el, "padding", "0 9px");
        important(el, "font-size", "9px");
        important(el, "font-weight", "900");
        important(el, "letter-spacing", ".06em");
        important(el, "box-shadow", "none");
      });

      shell.querySelectorAll<HTMLElement>("section, aside").forEach((el) => {
        if (el.closest("header")) return;
        important(el, "border-radius", "14px");
        important(el, "border-color", "var(--nd-border)");
        important(el, "background", "var(--nd-panel)");
        important(el, "box-shadow", "0 18px 55px var(--nd-shadow)");
      });

      shell.querySelectorAll<HTMLElement>("button").forEach((el) => {
        important(el, "border-radius", "7px");
        important(el, "box-shadow", "none");
      });

      hideTechnicalWxDetails(shell);
      refreshPlanningUi(shell);

      if (!observer) {
        observer = new MutationObserver(() => hideTechnicalWxDetails(shell));
        observer.observe(shell, { childList: true, subtree: true, characterData: true });
      }

      if (!refreshTimer) {
        refreshTimer = window.setInterval(() => {
          if (!cancelled) refreshPlanningUi(shell);
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
