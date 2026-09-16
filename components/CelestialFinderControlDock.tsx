"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function CelestialFinderControlDock() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/celestial")) return;

    let dockedStrip: HTMLElement | null = null;
    let originalParent: HTMLElement | null = null;

    const dockControls = () => {
      const main = document.querySelector("main");
      if (!main) return;

      const buttons = Array.from(main.querySelectorAll("button"));
      const portButton = buttons.find((button) => button.textContent?.trim() === "PORT") as HTMLButtonElement | undefined;
      const constellationsButton = buttons.find((button) => button.textContent?.trim() === "CONSTELLATIONS") as HTMLButtonElement | undefined;
      const starFieldButton = buttons.find((button) => button.textContent?.trim() === "STAR FIELD") as HTMLButtonElement | undefined;

      const viewRow = portButton?.parentElement as HTMLElement | null;
      const strip = constellationsButton?.parentElement as HTMLElement | null;
      if (!viewRow || !strip || !portButton || !constellationsButton || !starFieldButton || starFieldButton.parentElement !== strip) return;

      if (!originalParent) originalParent = strip.parentElement as HTMLElement | null;
      if (strip.parentElement !== viewRow) viewRow.appendChild(strip);

      strip.style.position = "static";
      strip.style.right = "auto";
      strip.style.top = "auto";
      strip.style.padding = "0";
      strip.style.border = "0";
      strip.style.background = "transparent";
      strip.style.boxShadow = "none";
      strip.style.margin = "0";
      strip.style.display = "flex";
      strip.style.gap = "4px";
      strip.style.alignItems = "center";

      const reference = portButton.getBoundingClientRect();
      for (const button of [constellationsButton, starFieldButton]) {
        button.style.width = `${reference.width}px`;
        button.style.minWidth = `${reference.width}px`;
        button.style.maxWidth = `${reference.width}px`;
        button.style.height = `${reference.height}px`;
        button.style.minHeight = `${reference.height}px`;
        button.style.padding = "0 4px";
        button.style.fontSize = "7px";
        button.style.letterSpacing = ".03em";
        button.style.whiteSpace = "nowrap";
      }

      dockedStrip = strip;
    };

    dockControls();
    const timer = window.setInterval(dockControls, 500);

    return () => {
      window.clearInterval(timer);
      if (dockedStrip && originalParent && originalParent.isConnected) {
        originalParent.appendChild(dockedStrip);
      }
    };
  }, [pathname]);

  return null;
}
