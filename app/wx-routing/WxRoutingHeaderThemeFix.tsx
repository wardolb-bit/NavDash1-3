"use client";

import { useEffect } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

export default function WxRoutingHeaderThemeFix() {
  const { nightMode } = useBridgeTheme();

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    const apply = () => {
      if (cancelled) return;

      const main = document.querySelector<HTMLElement>("main");
      const shell = main?.firstElementChild as HTMLElement | null;
      const header = shell?.querySelector<HTMLElement>(":scope > header") || null;

      if (!header) {
        retryTimer = window.setTimeout(apply, 100);
        return;
      }

      header.style.setProperty("background", nightMode ? "#071019" : "#ffffff", "important");
      header.style.setProperty("color", nightMode ? "#dbe5ee" : "#0f172a", "important");
      header.style.setProperty(
        "border-color",
        nightMode ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.45)",
        "important",
      );

      const heading = header.querySelector<HTMLElement>("h1");
      if (heading) heading.style.setProperty("color", nightMode ? "#edf4fa" : "#0f172a", "important");

      const kicker = header.querySelector<HTMLElement>("div > div");
      if (kicker) kicker.style.setProperty("color", nightMode ? "#c9a227" : "#8a6d0a", "important");

      const intro = header.querySelector<HTMLElement>("p");
      if (intro) intro.style.setProperty("color", nightMode ? "#8294a5" : "#64748b", "important");
    };

    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [nightMode]);

  return null;
}
