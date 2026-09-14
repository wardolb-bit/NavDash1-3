"use client";

import { useEffect } from "react";

export default function RouteProfileDistanceUnitFix() {
  useEffect(() => {
    let raf = 0;

    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document
          .querySelectorAll<SVGTextElement>('svg[viewBox="0 0 1000 160"] g.route-profile-selection-overlay text')
          .forEach((text) => {
            const value = text.textContent?.trim() || "";
            if (!/^\d+(?:\.\d+)?\s*•/.test(value)) return;
            text.textContent = value.replace(/^(\d+(?:\.\d+)?)\s*•/, "$1 NM along route •");
          });
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return null;
}
