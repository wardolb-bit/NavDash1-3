"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const MAIN_LABEL = /^(main|main page|main console|nav console|nav dash|console)$/i;

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isMainControl(element: Element) {
  return MAIN_LABEL.test(cleanText(element.textContent));
}

function styleFallback(link: HTMLAnchorElement) {
  const day = document.documentElement.getAttribute("data-navdash-theme") === "day";
  link.style.cssText = [
    "position:fixed",
    "right:14px",
    "bottom:14px",
    "z-index:2147483000",
    "height:34px",
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "padding:0 12px",
    "border-radius:4px",
    `border:1px solid ${day ? "rgba(138,109,10,.55)" : "rgba(201,162,39,.55)"}`,
    `background:${day ? "rgba(255,255,255,.96)" : "rgba(7,16,25,.96)"}`,
    `color:${day ? "#6f5608" : "#e7c95c"}`,
    "font:900 10px system-ui,sans-serif",
    "letter-spacing:.09em",
    "text-decoration:none",
    "box-shadow:0 3px 12px rgba(0,0,0,.18)",
  ].join(";");
}

export function NavDashMainLinkGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/" || pathname === "/navdash") {
      document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();
      return;
    }

    let cancelled = false;
    let syncing = false;

    const sync = () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        document.querySelectorAll<HTMLAnchorElement>('a[href="/navdash"]').forEach((link) => link.setAttribute("href", "/"));

        const dedicatedMain = Array.from(document.querySelectorAll<HTMLElement>("main a, main button, #wxr-v2-topbar a, #wxr-v2-topbar button"))
          .some((element) => isMainControl(element));

        let fallback = document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]");
        if (!dedicatedMain) {
          if (!fallback) {
            fallback = document.createElement("a");
            fallback.href = "/";
            fallback.textContent = "MAIN";
            fallback.setAttribute("data-navdash-main-fallback", "true");
            fallback.setAttribute("aria-label", "Return to NavDash main console");
            document.body.appendChild(fallback);
          }
          styleFallback(fallback);
        } else {
          fallback?.remove();
        }
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
      window.location.href = "/";
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const themeObserver = new MutationObserver(sync);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-navdash-theme"] });
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", sync);

    return () => {
      cancelled = true;
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", sync);
      document.querySelector<HTMLAnchorElement>("[data-navdash-main-fallback]")?.remove();
    };
  }, [pathname]);

  return null;
}
