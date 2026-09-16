"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { requestDesktopBridgeView } from "./MobileBridgeRedirect";

export function CelestialMainLink() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/celestial")) return;

    let currentLink: HTMLAnchorElement | null = null;

    const goBridge = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      requestDesktopBridgeView();
    };

    const sync = () => {
      const mainLink = document.querySelector<HTMLAnchorElement>('main header a');
      if (!mainLink || mainLink.textContent?.trim() !== "MAIN") return;

      if (currentLink !== mainLink) {
        currentLink?.removeEventListener("click", goBridge, true);
        currentLink = mainLink;
        currentLink.addEventListener("click", goBridge, true);
      }

      currentLink.setAttribute("href", "/bridge");
    };

    sync();
    const timer = window.setInterval(sync, 500);

    return () => {
      window.clearInterval(timer);
      currentLink?.removeEventListener("click", goBridge, true);
    };
  }, [pathname]);

  return null;
}
