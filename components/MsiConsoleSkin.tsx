"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function MsiConsoleSkin() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/msi") return;

    const main = document.querySelector<HTMLElement>("main");
    const globalNav = document.querySelector<HTMLElement>("body > nav");
    if (!main) return;

    main.classList.add("bc-msi-console");
    const previousNavDisplay = globalNav?.style.display ?? "";
    if (globalNav) globalNav.style.setProperty("display", "none", "important");

    let style = document.getElementById("bc-msi-console-style") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "bc-msi-console-style";
      style.textContent = `
        .bc-msi-console { background:#040d18 !important; color:#dbe5ee !important; padding:6px !important; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important; }
        .bc-msi-console > div { max-width:none !important; margin:0 !important; gap:5px !important; }
        .bc-msi-console section, .bc-msi-console article { border-radius:0 !important; box-shadow:none !important; backdrop-filter:none !important; border-color:rgba(148,163,184,.14) !important; background:#06111f !important; }
        .bc-msi-console section:first-child { border-color:rgba(242,184,75,.30) !important; }
        .bc-msi-console [class*="rounded-"] { border-radius:0 !important; }
        .bc-msi-console [class*="shadow-"] { box-shadow:none !important; }
        .bc-msi-console [class*="backdrop-blur"] { backdrop-filter:none !important; }
        .bc-msi-console button, .bc-msi-console a[class*="border"] { border-radius:3px !important; box-shadow:none !important; min-height:30px !important; font-size:10px !important; letter-spacing:.08em !important; }
        .bc-msi-console input, .bc-msi-console select { border-radius:0 !important; border-color:#33485a !important; background:#040d18 !important; color:#dbe5ee !important; box-shadow:none !important; }
        .bc-msi-console pre { background:#040d18 !important; border:1px solid rgba(148,163,184,.14); padding:12px !important; }
        .bc-msi-console h1 { font-size:20px !important; letter-spacing:.04em !important; }
        .bc-msi-console h2 { font-size:18px !important; }
        html[data-navdash-theme="day"] .bc-msi-console { background:#edf3f7 !important; color:#122434 !important; }
        html[data-navdash-theme="day"] .bc-msi-console section,
        html[data-navdash-theme="day"] .bc-msi-console article { background:#ffffff !important; border-color:rgba(15,23,42,.18) !important; color:#122434 !important; }
        html[data-navdash-theme="day"] .bc-msi-console pre { background:#f7f9fb !important; color:#122434 !important; border-color:rgba(15,23,42,.18) !important; }
        html[data-navdash-theme="day"] .bc-msi-console input,
        html[data-navdash-theme="day"] .bc-msi-console select { background:#ffffff !important; color:#122434 !important; border-color:rgba(15,23,42,.22) !important; }
        html[data-navdash-theme="day"] .bc-msi-console [class*="text-slate-100"],
        html[data-navdash-theme="day"] .bc-msi-console [class*="text-slate-200"],
        html[data-navdash-theme="day"] .bc-msi-console [class*="text-slate-300"] { color:#122434 !important; }
        html[data-navdash-theme="day"] .bc-msi-console [class*="text-slate-400"],
        html[data-navdash-theme="day"] .bc-msi-console [class*="text-slate-500"] { color:#52697a !important; }
      `;
      document.head.appendChild(style);
    }

    return () => {
      main.classList.remove("bc-msi-console");
      if (globalNav) {
        globalNav.style.removeProperty("display");
        if (previousNavDisplay) globalNav.style.display = previousNavDisplay;
      }
    };
  }, [pathname]);

  return null;
}
