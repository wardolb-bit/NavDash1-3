"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function BridgeQuickAccess() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dayMode, setDayMode] = useState(false);

  useEffect(() => {
    if (pathname !== "/") {
      setTarget(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let themeObserver: MutationObserver | null = null;

    const findTarget = () => {
      if (cancelled) return;
      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      const header = shell ? (Array.from(shell.children).find((el) => el.tagName === "HEADER") as HTMLElement | undefined) : undefined;
      const row = header?.firstElementChild as HTMLElement | null;
      const controls = row?.lastElementChild as HTMLElement | null;

      if (shell && controls) {
        const syncTheme = () => setDayMode(shell.classList.contains("navdash-v12-day"));
        syncTheme();
        setTarget(controls);
        themeObserver?.disconnect();
        themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(shell, { attributes: true, attributeFilter: ["class"] });
        return;
      }

      timer = window.setTimeout(findTarget, 100);
    };

    findTarget();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      themeObserver?.disconnect();
    };
  }, [pathname]);

  if (pathname !== "/" || !target) return null;

  const buttonClass = dayMode
    ? "bc-header-nav inline-flex flex-none items-center justify-center whitespace-nowrap border border-slate-400 bg-white font-black text-slate-950 shadow-sm hover:bg-slate-50"
    : "bc-header-nav inline-flex flex-none items-center justify-center whitespace-nowrap border border-white/10 bg-white/10 font-black text-slate-100 hover:bg-white/15";

  return createPortal(
    <>
      <Link href="/celestial" className={buttonClass}>Star Finder</Link>
      <Link href="/wx" className={buttonClass}>Weather</Link>
      <Link href="/wx-routing" className={buttonClass}>WX Routing</Link>
      <Link href="/position-report" className={buttonClass}>Position Report</Link>
      <Link href="/official-weather" className={buttonClass}>Official WX</Link>
      <Link href="/ecr" className={buttonClass}>ECR</Link>
    </>,
    target,
  );
}
