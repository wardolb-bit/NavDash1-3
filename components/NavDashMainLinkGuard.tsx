"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const MAIN_LABEL = /^(main|main page|main console|nav console|nav dash|console)$/i;
const STORM_MAP_LABEL = /^storm map$/i;
const BRIDGE_MAIN_ROUTE = "/bridge";

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isMainControl(element: Element) {
  return MAIN_LABEL.test(cleanText(element.textContent));
}

function isStormMapControl(element: Element) {
  return STORM_MAP_LABEL.test(cleanText(element.textContent));
}

function internalRouteFromAnchor(anchor: HTMLAnchorElement) {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;

  const rawHref = anchor.getAttribute("href") || "";
  if (!rawHref.startsWith("/")) return null;

  try {
    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin) return null;
    if (url.pathname.startsWith("/api/")) return null;

    const sameDocumentHash =
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      Boolean(url.hash);
    if (sameDocumentHash) return null;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function NavDashMainLinkGuard() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();

    let cancelled = false;
    let syncing = false;

    const sync = () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        if (pathname !== BRIDGE_MAIN_ROUTE && pathname !== "/navdash" && pathname !== "/phone") {
          document.querySelectorAll<HTMLAnchorElement>('a[href="/navdash"], a[href="/"]').forEach((link) => {
            if (isMainControl(link) || link.getAttribute("href") === "/navdash") link.setAttribute("href", BRIDGE_MAIN_ROUTE);
          });
        }

        // Floating MAIN fallback intentionally disabled. Existing page MAIN controls
        // are preserved and still routed to the bridge console above.
        document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();
      } finally {
        syncing = false;
      }
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const button = target.closest("button");
      if (button) {
        if (isMainControl(button)) {
          const pageMain = button.closest("main") || button.id === "navdash-navbrief-main";
          if (!pageMain) return;

          event.preventDefault();
          event.stopImmediatePropagation();
          router.push(BRIDGE_MAIN_ROUTE);
          return;
        }

        // The main bridge console currently uses a button with window.location.href
        // for Storm Map. Intercept it before that hard navigation so fullscreen and
        // the shared theme survive the route change.
        if (isStormMapControl(button)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          router.push("/storm-map");
          return;
        }
      }

      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const route = internalRouteFromAnchor(anchor);
      if (!route) return;

      // Keep all NavDash page-to-page navigation inside the existing Next.js
      // document. A hard reload exits the browser Fullscreen API; router.push does not.
      event.preventDefault();
      event.stopImmediatePropagation();
      router.push(route);
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
  }, [pathname, router]);

  return null;
}
