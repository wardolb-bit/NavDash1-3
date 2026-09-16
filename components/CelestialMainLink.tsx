"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function CelestialMainLink() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/celestial")) return;

    const sync = () => {
      const mainLink = document.querySelector<HTMLAnchorElement>('main header a[href="/"]');
      if (mainLink) mainLink.href = "/bridge";
    };

    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, [pathname]);

  return null;
}
