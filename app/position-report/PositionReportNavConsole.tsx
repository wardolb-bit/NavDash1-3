"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PositionReportNavConsole() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const findTarget = () => {
      if (cancelled) return;
      const header = document.querySelector<HTMLElement>("main > div.relative.z-10.min-h-screen > header");
      const row = header?.querySelector<HTMLElement>(":scope > div > div:last-child");
      if (row) {
        setTarget(row);
        return;
      }
      timer = window.setTimeout(findTarget, 100);
    };

    findTarget();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!target) return null;

  return createPortal(
    <Link href="/" aria-label="Return to Nav Console" className="position-report-nav-console">
      NAV CONSOLE
    </Link>,
    target,
  );
}
