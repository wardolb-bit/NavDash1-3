"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Forces every Celestial workstation mode onto the same compact bridge-console
 * visual system used by the current main NavDash console. This is intentionally
 * presentation-only: celestial calculations, AIS, planner, reduction and plot
 * logic remain owned by the Celestial page.
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
        .bc-celestial-console input,
        .bc-celestial-console select {
          border-radius:0 !important;
          border-color:#33485a !important;
          background:#04080c !important;
          color:#dbe5ee !important;
          box-shadow:none !important;
        }
        .bc-celestial-console [class*="rounded-"] {
          border-radius:0 !important;
        }
        .bc-celestial-console [class*="shadow-"] {
          box-shadow:none !important;
        }
        .bc-celestial-console [class*="backdrop-blur"] {
          backdrop-filter:none !important;
        }
        .bc-celestial-console table,
        .bc-celestial-console [role="table"] {
          border-collapse:collapse !important;
        }
        .bc-celestial-console ::-webkit-scrollbar { width:8px; height:8px; }
        .bc-celestial-console ::-webkit-scrollbar-track { background:#04080c; }
        .bc-celestial-console ::-webkit-scrollbar-thumb { background:#263442; }
      `;
      document.head.appendChild(style);
    }

    return () => {
      main.classList.remove("bc-celestial-console");
    };
  }, [pathname]);

  return null;
}
