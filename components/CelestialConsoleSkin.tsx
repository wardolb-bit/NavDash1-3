"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Forces every Celestial workstation mode onto the same compact bridge-console
 * visual system used by the current main NavDash console. Presentation only.
 */
export function CelestialConsoleSkin() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/celestial")) return;

    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    main.classList.add("bc-celestial-console");

    let style = document.getElementById("bc-celestial-console-style") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "bc-celestial-console-style";
      style.textContent = `
        .bc-celestial-console {
          background:transparent !important;
          color:var(--nd-text) !important;
          font-family:"Avenir Next","Segoe UI",system-ui,sans-serif !important;
        }
        .bc-celestial-console > div {
          padding:0 28px 22px !important;
          max-width:1520px !important;
          margin:0 auto !important;
        }
        .bc-celestial-console header {
          margin:0 0 18px !important;
          border:1px solid var(--nd-border) !important;
          border-radius:14px !important;
          background:var(--nd-panel) !important;
          box-shadow:0 18px 55px var(--nd-shadow) !important;
          backdrop-filter:none !important;
        }
        .bc-celestial-console section,
        .bc-celestial-console aside {
          border:1px solid var(--nd-border) !important;
          border-radius:14px !important;
          background:var(--nd-panel) !important;
          box-shadow:0 18px 55px var(--nd-shadow) !important;
          backdrop-filter:none !important;
        }
        .bc-celestial-console button,
        .bc-celestial-console a[class*="border"] {
          border-radius:7px !important;
          box-shadow:none !important;
          min-height:30px !important;
          font-size:10px !important;
          letter-spacing:.08em !important;
        }
        .bc-celestial-console button[class*="bg-[#f2b84b]"] {
          color:#06111f !important;
          font-weight:900 !important;
        }
        .bc-celestial-console input,
        .bc-celestial-console select {
          border-radius:7px !important;
          border-color:var(--nd-border) !important;
          background:var(--nd-control-bg) !important;
          color:var(--nd-text) !important;
          box-shadow:none !important;
        }
        .bc-celestial-console [class*="rounded-"] { border-radius:10px !important; }
        .bc-celestial-console [class*="backdrop-blur"] { backdrop-filter:none !important; }
        .bc-celestial-console table,
        .bc-celestial-console [role="table"] { border-collapse:collapse !important; }
        .bc-celestial-console ::-webkit-scrollbar { width:8px; height:8px; }
        .bc-celestial-console ::-webkit-scrollbar-track { background:#040d18; }
        .bc-celestial-console ::-webkit-scrollbar-thumb { background:#1d3a52; }

        html[data-navdash-theme="day"] .bc-celestial-console header [class*="text-"],
        html[data-navdash-theme="day"] .bc-celestial-console #celestial-sunmoon-banner-slot [class*="text-"] {
          color:#000000 !important;
        }
      `;
      document.head.appendChild(style);
    }

    const syncMainLink = () => {
      const link = main.querySelector<HTMLAnchorElement>('header a[href="/"]');
      if (!link) return;
      const isDay = document.documentElement.getAttribute("data-navdash-theme") === "day";
      if (isDay) {
        link.style.setProperty("background", "#ffffff", "important");
        link.style.setProperty("background-color", "#ffffff", "important");
        link.style.setProperty("color", "#000000", "important");
        link.style.setProperty("border-color", "rgba(15,23,42,.28)", "important");
      } else {
        link.style.removeProperty("background");
        link.style.removeProperty("background-color");
        link.style.removeProperty("color");
        link.style.removeProperty("border-color");
      }
    };

    syncMainLink();
    const observer = new MutationObserver(syncMainLink);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-navdash-theme"] });
    const timer = window.setTimeout(syncMainLink, 250);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      main.classList.remove("bc-celestial-console");
    };
  }, [pathname]);

  return null;
}
