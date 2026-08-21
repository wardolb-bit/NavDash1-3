"use client";

import { useEffect } from "react";

export function BridgeConsolePreview() {
  useEffect(() => {
    let raf = 0;

    const apply = () => {
      const shell = document.querySelector<HTMLElement>(".navdash-v12-day, .navdash-v12-night");
      if (!shell) {
        raf = window.requestAnimationFrame(apply);
        return;
      }

      shell.classList.add("bridge-console-shell");

      const children = Array.from(shell.children) as HTMLElement[];
      const header = children.find((el) => el.tagName === "HEADER");
      if (header) header.classList.add("bridge-console-header");

      const navStrip = header?.nextElementSibling as HTMLElement | null;
      if (navStrip) navStrip.classList.add("bridge-console-navstrip");

      const mainGrid = navStrip?.nextElementSibling as HTMLElement | null;
      if (mainGrid) mainGrid.classList.add("bridge-console-main");

      const chart = document.getElementById("v12-section-chart");
      chart?.classList.add("bridge-console-chart");

      const map = document.getElementById("v12-map") as HTMLElement | null;
      if (map) {
        map.classList.add("bridge-console-map");
        map.style.height = "calc(100vh - 12.5rem)";
        map.style.minHeight = "520px";
      }

      const route = document.getElementById("v12-section-route");
      const rail = route?.parentElement as HTMLElement | null;
      rail?.classList.add("bridge-console-rail");
      route?.classList.add("bridge-console-route");

      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 150);
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 600);
    };

    apply();
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return null;
}
