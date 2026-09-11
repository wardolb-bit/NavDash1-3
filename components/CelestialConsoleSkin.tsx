"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useBridgeTheme } from "../lib/useBridgeTheme";

/**
 * Forces every Celestial workstation mode onto the same compact bridge-console
 * visual system used by the current main NavDash console. Presentation only.
 */
export function CelestialConsoleSkin() {
  const pathname = usePathname();
  const { nightMode, toggleTheme } = useBridgeTheme();

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
          background:#04080c !important;
          color:#dbe5ee !important;
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        }
        .bc-celestial-console > div {
          padding:6px !important;
          max-width:none !important;
          margin:0 !important;
        }
        .bc-celestial-console header {
          margin:0 0 5px !important;
          border:1px solid rgba(201,162,39,.30) !important;
          border-radius:0 !important;
          background:#071019 !important;
          box-shadow:none !important;
          backdrop-filter:none !important;
        }
        .bc-celestial-console section,
        .bc-celestial-console aside {
          border:1px solid rgba(148,163,184,.14) !important;
          border-radius:0 !important;
          background:#071019 !important;
          box-shadow:none !important;
          backdrop-filter:none !important;
        }
        .bc-celestial-console button,
        .bc-celestial-console a[class*="border"] {
          border-radius:3px !important;
          box-shadow:none !important;
          min-height:30px !important;
          font-size:10px !important;
          letter-spacing:.08em !important;
        }
        .bc-celestial-console button[class*="bg-[#c9a227]"] {
          color:#071019 !important;
          font-weight:900 !important;
        }
        .bc-celestial-console input,
        .bc-celestial-console select {
          border-radius:0 !important;
          border-color:#33485a !important;
          background:#04080c !important;
          color:#dbe5ee !important;
          box-shadow:none !important;
        }
        .bc-celestial-console [class*="rounded-"] { border-radius:0 !important; }
        .bc-celestial-console [class*="shadow-"] { box-shadow:none !important; }
        .bc-celestial-console [class*="backdrop-blur"] { backdrop-filter:none !important; }
        .bc-celestial-console table,
        .bc-celestial-console [role="table"] { border-collapse:collapse !important; }
        .bc-celestial-console ::-webkit-scrollbar { width:8px; height:8px; }
        .bc-celestial-console ::-webkit-scrollbar-track { background:#04080c; }
        .bc-celestial-console ::-webkit-scrollbar-thumb { background:#263442; }

        html[data-navdash-theme="day"] .bc-celestial-console header [class*="text-"],
        html[data-navdash-theme="day"] .bc-celestial-console #celestial-sunmoon-banner-slot [class*="text-"] {
          color:#000000 !important;
        }
        html[data-navdash-theme="day"] .bc-celestial-console #celestial-theme-toggle,
        html[data-navdash-theme="day"] .bc-celestial-console header a[href="/bridge"],
        html[data-navdash-theme="day"] .bc-celestial-console header a[href="/"],
        html[data-navdash-theme="day"] .bc-celestial-console header a[href="/navdash"] {
          background:#ffffff !important;
          background-color:#ffffff !important;
          color:#000000 !important;
          border-color:rgba(15,23,42,.28) !important;
        }
      `;
      document.head.appendChild(style);
    }

    const syncHeaderControls = () => {
      const link = main.querySelector<HTMLAnchorElement>('header a[href="/"], header a[href="/navdash"], header a[href="/bridge"]');
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

      let themeButton = document.getElementById("celestial-theme-toggle") as HTMLButtonElement | null;
      if (!themeButton) {
        themeButton = document.createElement("button");
        themeButton.id = "celestial-theme-toggle";
        themeButton.type = "button";
        themeButton.className = link.className;
        link.parentElement?.insertBefore(themeButton, link);
      }
      themeButton.textContent = isDay ? "NIGHT MODE" : "DAY MODE";
      themeButton.onclick = toggleTheme;
    };

    syncHeaderControls();
    const observer = new MutationObserver(syncHeaderControls);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-navdash-theme"] });
    const timer = window.setTimeout(syncHeaderControls, 250);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      document.getElementById("celestial-theme-toggle")?.remove();
      main.classList.remove("bc-celestial-console");
    };
  }, [pathname, nightMode, toggleTheme]);

  return null;
}
