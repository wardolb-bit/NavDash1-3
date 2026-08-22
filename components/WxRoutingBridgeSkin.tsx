"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function important(el: HTMLElement | null, prop: string, value: string) {
  if (!el) return;
  el.style.setProperty(prop, value, "important");
}

export function WxRoutingBridgeSkin() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/wx-routing") return;

    let cancelled = false;
    let retryTimer = 0;
    let observer: MutationObserver | null = null;

    const hideTechnicalWxDetails = (root: HTMLElement) => {
      root.querySelectorAll<HTMLElement>("div,span,p").forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return;

        // Hide the small operationally-irrelevant sample counters while
        // preserving the actual layer names and controls.
        if (/^Isobar Samples$/i.test(text)) {
          const row = el.parentElement;
          if (row) important(row, "display", "none");
          return;
        }

        if (/^(\d+\s+)?(wind|map|grib|isobar)?\s*samples?$/i.test(text)) {
          important(el, "display", "none");
          return;
        }

        // The GRIB backend may report its local executable path and parsing
        // sample counts in sourceNotes. That is useful for debugging, not for
        // the bridge display, so suppress only that rendered technical line.
        if (/\.exe\b/i.test(text) || /executable/i.test(text) || /sample(?:d)?\s+points?/i.test(text)) {
          const card = el.closest<HTMLElement>("div");
          const isDataSourceDetail = !!el.parentElement?.querySelector("div") && /Data Source/i.test(el.parentElement?.textContent || "");
          if (isDataSourceDetail || /\.exe\b/i.test(text)) important(el, "display", "none");
        }
      });
    };

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
      important(shell, "padding", "6px");
      important(shell, "gap", "5px");

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

      topbar.style.cssText = "height:46px;display:grid;grid-template-columns:280px 1fr 180px;align-items:center;padding:0 12px;margin-bottom:0;border:1px solid rgba(201,162,39,.30);background:#071019;color:#e7edf3;font:700 11px system-ui;letter-spacing:.08em";
      const brand = topbar.querySelector<HTMLElement>(".wxr-brand");
      if (brand) brand.style.cssText = "display:flex;align-items:center;gap:9px";
      const logo = topbar.querySelector<HTMLElement>(".wxr-logo");
      if (logo) logo.style.cssText = "display:grid;place-items:center;width:28px;height:28px;border:1px solid #c9a227;color:#e7c95c;font-size:15px;font-weight:900";
      const stack = topbar.querySelector<HTMLElement>(".wxr-brand span:last-child");
      if (stack) stack.style.cssText = "display:flex;flex-direction:column;line-height:1";
      const small = topbar.querySelector<HTMLElement>("small");
      if (small) small.style.cssText = "margin-top:4px;font-size:8px;color:#8294a5;letter-spacing:.14em";
      const center = topbar.querySelector<HTMLElement>(".wxr-center");
      if (center) center.style.cssText = "display:flex;justify-content:center;gap:8px";
      topbar.querySelectorAll<HTMLElement>(".wxr-center span").forEach((el) => {
        el.style.cssText = "padding:5px 9px;border:1px solid rgba(148,163,184,.18);background:#050a0f;color:#aebdca;font-size:9px";
      });
      const dot = topbar.querySelector<HTMLElement>(".wxr-live i");
      if (dot) dot.style.cssText = "display:inline-block;width:6px;height:6px;border-radius:50%;background:#22d3ee;margin-right:6px;box-shadow:0 0 8px rgba(34,211,238,.55)";
      const action = topbar.querySelector<HTMLAnchorElement>(".wxr-actions a");
      if (action) action.style.cssText = "display:inline-flex;height:30px;min-width:110px;align-items:center;justify-content:center;border:1px solid rgba(201,162,39,.55);background:#071019;color:#e7c95c;text-decoration:none;font:900 9px system-ui;letter-spacing:.10em";
      const actions = topbar.querySelector<HTMLElement>(".wxr-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end";

      important(header, "padding", "6px 8px");
      important(header, "margin", "0");
      important(header, "border-radius", "0");
      important(header, "border", "1px solid rgba(148,163,184,.14)");
      important(header, "background", "#071019");
      important(header, "box-shadow", "none");

      const heading = header.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.textContent = "WX ROUTING";
        heading.style.cssText = "margin:0;color:#edf4fa;font-size:20px;font-weight:900;letter-spacing:.08em";
      }
      const kicker = header.querySelector<HTMLElement>("div > div");
      if (kicker) kicker.style.cssText = "color:#c9a227;font-size:8px;font-weight:900;letter-spacing:.16em;text-transform:uppercase";
      const intro = header.querySelector<HTMLElement>("p");
      if (intro) intro.style.cssText = "margin-top:3px;color:#8294a5;font-size:10px;line-height:1.35";

      header.querySelectorAll<HTMLElement>("button,label").forEach((el) => {
        important(el, "border-radius", "3px");
        important(el, "height", "30px");
        important(el, "padding", "0 9px");
        important(el, "font-size", "9px");
        important(el, "font-weight", "900");
        important(el, "letter-spacing", ".06em");
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
      if (!observer) {
        observer = new MutationObserver(() => hideTechnicalWxDetails(shell));
        observer.observe(shell, { childList: true, subtree: true, characterData: true });
      }
    };

    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      observer?.disconnect();
      document.getElementById("wxr-v2-topbar")?.remove();
    };
  }, [pathname]);

  return null;
}
