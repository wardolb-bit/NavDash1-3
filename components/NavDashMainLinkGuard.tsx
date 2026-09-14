"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const MAIN_LABEL = /^(main|main page|main console|nav console|nav dash|console)$/i;
const BRIDGE_MAIN_ROUTE = "/bridge";

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isMainControl(element: Element) {
  return MAIN_LABEL.test(cleanText(element.textContent));
}

export function NavDashMainLinkGuard() {
  const pathname = usePathname();

  useEffect(() => {
    document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();

    if (pathname === BRIDGE_MAIN_ROUTE || pathname === "/navdash" || pathname === "/phone") {
      return;
    }

    let cancelled = false;
    let syncing = false;

    const sync = () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        document.querySelectorAll<HTMLAnchorElement>('a[href="/navdash"], a[href="/"]').forEach((link) => {
          if (isMainControl(link) || link.getAttribute("href") === "/navdash") link.setAttribute("href", BRIDGE_MAIN_ROUTE);
        });

        // Floating MAIN fallback intentionally disabled. Existing page MAIN controls
        // are preserved and still routed to the bridge console above.
        document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();
      } finally {
        syncing = false;
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button");
      if (!button || !isMainControl(button)) return;

      const pageMain = button.closest("main") || button.id === "navdash-navbrief-main";
      if (!pageMain) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = BRIDGE_MAIN_ROUTE;
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", sync);

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", sync);
      document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();
    };
  }, [pathname]);

  return null;
}
