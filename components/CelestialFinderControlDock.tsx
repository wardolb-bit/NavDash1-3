"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function CelestialFinderControlDock() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/celestial")) return;

    const dockControls = () => {
      const main = document.querySelector("main");
      if (!main) return;

      const buttons = Array.from(main.querySelectorAll("button"));
      const portButton = buttons.find((button) => button.textContent?.trim() === "PORT") as HTMLButtonElement | undefined;
      const constellationsButton = buttons.find((button) => button.textContent?.trim() === "CONSTELLATIONS") as HTMLButtonElement | undefined;
      const starFieldButton = buttons.find((button) => button.textContent?.trim() === "STAR FIELD") as HTMLButtonElement | undefined;
      const view360Button = buttons.find((button) => button.textContent?.trim() === "360°") as HTMLButtonElement | undefined;

      const viewRow = portButton?.parentElement as HTMLElement | null;
      const strip = constellationsButton?.parentElement as HTMLElement | null;
      if (!viewRow || !strip || !portButton || !constellationsButton || !starFieldButton || starFieldButton.parentElement !== strip) return;

      // Keep the React portal controls in their original DOM container so React's
      // delegated click events continue to work. Position the strip over the view
      // control row instead of re-parenting it into that row.
      const reference = portButton.getBoundingClientRect();
      const anchor = (view360Button?.parentElement === viewRow ? view360Button : null)?.getBoundingClientRect() ?? reference;

      strip.style.position = "fixed";
      strip.style.left = `${Math.round(anchor.right + 4)}px`;
      strip.style.right = "auto";
      strip.style.top = `${Math.round(reference.top)}px`;
      strip.style.zIndex = "50";
      strip.style.padding = "0";
      strip.style.border = "0";
      strip.style.background = "transparent";
      strip.style.boxShadow = "none";
      strip.style.margin = "0";
      strip.style.display = "flex";
      strip.style.gap = "4px";
      strip.style.alignItems = "center";

      for (const button of [constellationsButton, starFieldButton]) {
        button.style.width = "auto";
        button.style.minWidth = "0";
        button.style.maxWidth = "none";
        button.style.height = `${reference.height}px`;
        button.style.minHeight = `${reference.height}px`;
        button.style.padding = "0 9px";
        button.style.fontSize = "9px";
        button.style.letterSpacing = ".08em";
        button.style.whiteSpace = "nowrap";
      }
    };

    dockControls();
    const timer = window.setInterval(dockControls, 250);
    window.addEventListener("resize", dockControls);
    window.addEventListener("scroll", dockControls, true);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", dockControls);
      window.removeEventListener("scroll", dockControls, true);
    };
  }, [pathname]);

  return null;
}
