"use client";

import { useEffect } from "react";

export default function RouteProfileDistanceUnitFix() {
  useEffect(() => {
    const apply = () => {
      document
        .querySelectorAll<SVGTextElement>('svg[viewBox="0 0 1000 160"] g.route-profile-selection-overlay text')
        .forEach((text) => {
          const value = text.textContent?.trim() || "";
          if (/^\d+(?:\.\d+)?\s+NM\s+along\s+route\s*•/i.test(value)) return;
          if (!/^\d+(?:\.\d+)?\s*•/.test(value)) return;
          text.textContent = value.replace(/^(\d+(?:\.\d+)?)\s*•/, "$1 NM along route •");
        });
    };

    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // RouteProfileEnhancer redraws the SVG after selections change. Keep this
    // display-only label authoritative after those redraws finish.
    const interval = window.setInterval(apply, 150);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
