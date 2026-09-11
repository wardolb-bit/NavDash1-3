"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ToolsMainButton() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const findTarget = () => {
      if (cancelled) return;
      const header = document.querySelector<HTMLElement>(".navdash-tools-current main header");
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
  }, []);

  if (!target) return null;

  return createPortal(
    <Link href="/bridge" className="tools-main-button border px-4 py-3 text-xl font-bold">
      Main
    </Link>,
    target,
  );
}
