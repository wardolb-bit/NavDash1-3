"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function BridgeQuickAccess() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/") {
      setTarget(null);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const findTarget = () => {
      if (cancelled) return;
      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      const header = shell ? Array.from(shell.children).find((el) => el.tagName === "HEADER") as HTMLElement | undefined : undefined;
      const row = header?.firstElementChild as HTMLElement | null;
      const controls = row?.lastElementChild as HTMLElement | null;

      if (controls) {
        setTarget(controls);
        return;
      }

      timer = window.setTimeout(findTarget, 100);
    };

    findTarget();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  if (pathname !== "/" || !target) return null;

  return createPortal(
    <>
      <Link href="/wx" className="bc-quick-link">Weather</Link>
      <Link href="/wx-routing" className="bc-quick-link">WX Routing</Link>
      <Link href="/position-report" className="bc-quick-link">Position Report</Link>
      <Link href="/official-weather" className="bc-quick-link">Official WX</Link>
      <Link href="/ecr" className="bc-quick-link">ECR</Link>
    </>,
    target,
  );
}
