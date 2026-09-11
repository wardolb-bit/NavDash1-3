"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

export function OfficialWeatherConsoleSkin() {
  const pathname = usePathname();
  const [actions, setActions] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/official-weather") return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const mount = () => {
      if (cancelled) return;
      const main = document.querySelector<HTMLElement>("main");
      const shell = main?.firstElementChild as HTMLElement | null;
      const header = shell?.querySelector<HTMLElement>(":scope > header") || null;
      const themeButton = header
        ? Array.from(header.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
            /day mode|bridge night|night mode/i.test((button.textContent || "").trim()),
          )
        : null;
      const actionRow = themeButton?.parentElement as HTMLElement | null;

      if (!main || !header || !actionRow) {
        attempts += 1;
        if (attempts < 20) timer = window.setTimeout(mount, 100);
        return;
      }

      main.classList.add("official-weather-console");
      setActions(actionRow);
    };

    mount();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setActions(null);
      document.querySelector<HTMLElement>("main.official-weather-console")?.classList.remove("official-weather-console");
    };
  }, [pathname]);

  if (pathname !== "/official-weather") return null;

  return (
    <>
      {actions && createPortal(
        <a id="official-weather-main" href="/bridge" aria-label="Return to NavDash bridge console">
          MAIN
        </a>,
        actions,
      )}

      <style jsx global>{`
        main.official-weather-console {
          min-height:100vh !important;
          background:#04080c !important;
          color:#dbe5ee !important;
          font-family:system-ui,sans-serif !important;
        }
        main.official-weather-console > div {
          max-width:none !important;
          padding:6px !important;
        }
        main.official-weather-console > div > header {
          margin-bottom:5px !important;
          padding:10px 12px !important;
          border-radius:0 !important;
          border:1px solid rgba(201,162,39,.30) !important;
          background:#071019 !important;
          box-shadow:none !important;
          backdrop-filter:none !important;
        }
        main.official-weather-console > div > header > div {
          gap:8px !important;
        }
        main.official-weather-console > div > header .h-16.w-16 {
          width:30px !important;
          height:30px !important;
          border-radius:0 !important;
          background:#101820 !important;
          border-color:rgba(201,162,39,.65) !important;
          font-size:15px !important;
        }
        main.official-weather-console > div > header h1 {
          font-size:22px !important;
          line-height:1.05 !important;
          color:#edf4fa !important;
          text-transform:uppercase !important;
        }
        main.official-weather-console > div > header h1 + div {
          margin-top:4px !important;
          font-size:10px !important;
          color:#8294a5 !important;
        }
        main.official-weather-console > div > header button,
        main.official-weather-console #official-weather-main {
          display:inline-flex !important;
          align-items:center !important;
          justify-content:center !important;
          height:30px !important;
          min-height:30px !important;
          min-width:112px !important;
          padding:0 10px !important;
          border-radius:2px !important;
          border:1px solid rgba(201,162,39,.42) !important;
          background:#071019 !important;
          color:#d6bd58 !important;
          box-shadow:none !important;
          font:900 9px/1 system-ui,sans-serif !important;
          letter-spacing:.06em !important;
          text-decoration:none !important;
          white-space:nowrap !important;
          text-transform:uppercase !important;
        }
        main.official-weather-console > div > header button {
          text-transform:uppercase !important;
        }

        main.official-weather-console section {
          gap:5px !important;
          margin-bottom:5px !important;
        }
        main.official-weather-console section > div,
        main.official-weather-console article {
          border-radius:0 !important;
          border-color:rgba(148,163,184,.16) !important;
          background:#071019 !important;
          box-shadow:none !important;
          backdrop-filter:none !important;
          padding:10px !important;
        }
        main.official-weather-console [class*="rounded-3xl"],
        main.official-weather-console [class*="rounded-2xl"],
        main.official-weather-console [class*="rounded-xl"] {
          border-radius:2px !important;
          box-shadow:none !important;
        }
        main.official-weather-console input {
          border-radius:2px !important;
          border-color:rgba(148,163,184,.24) !important;
          background:#050a0f !important;
          color:#edf4fa !important;
          box-shadow:none !important;
        }
        main.official-weather-console section button,
        main.official-weather-console section a {
          border-radius:2px !important;
          box-shadow:none !important;
          text-transform:uppercase !important;
        }
        main.official-weather-console footer {
          margin-top:5px !important;
          border-radius:2px !important;
          background:#071019 !important;
          border-color:rgba(148,163,184,.16) !important;
          color:#8294a5 !important;
        }

        html[data-navdash-theme="day"] main.official-weather-console {
          background:#eef2f5 !important;
          color:#17212b !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console > div > header,
        html[data-navdash-theme="day"] main.official-weather-console section > div,
        html[data-navdash-theme="day"] main.official-weather-console article,
        html[data-navdash-theme="day"] main.official-weather-console footer {
          background:#ffffff !important;
          color:#17212b !important;
          border-color:rgba(15,23,42,.22) !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console > div > header h1 {
          color:#000000 !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console > div > header h1 + div {
          color:#586773 !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console > div > header button,
        html[data-navdash-theme="day"] main.official-weather-console #official-weather-main {
          background:#ffffff !important;
          color:#000000 !important;
          border-color:rgba(15,23,42,.28) !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console input {
          background:#ffffff !important;
          color:#17212b !important;
          border-color:rgba(15,23,42,.24) !important;
        }
        html[data-navdash-theme="day"] main.official-weather-console [class*="bg-black/25"],
        html[data-navdash-theme="day"] main.official-weather-console [class*="bg-slate-50"] {
          background:#f4f7f9 !important;
          color:#17212b !important;
          border-color:rgba(15,23,42,.18) !important;
        }
      `}</style>
    </>
  );
}
