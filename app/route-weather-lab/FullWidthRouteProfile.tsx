"use client";

import { useEffect } from "react";

export default function FullWidthRouteProfile() {
  useEffect(() => {
    let movedPanel: HTMLElement | null = null;
    let originalParent: HTMLElement | null = null;
    let originalNextSibling: ChildNode | null = null;

    const moveProfile = () => {
      const main = document.querySelector("main");
      if (!(main instanceof HTMLElement)) return;

      const workspace = Array.from(main.children).find((child) =>
        child instanceof HTMLElement &&
        child.classList.contains("grid") &&
        child.querySelector("#route-weather-lab-map")
      );
      if (!(workspace instanceof HTMLElement)) return;

      const profileSvg = workspace.querySelector<SVGSVGElement>('svg[viewBox="0 0 1000 160"]');
      if (!profileSvg) return;

      const panel = profileSvg.closest("div.mt-2.border");
      if (!(panel instanceof HTMLElement)) return;

      if (!originalParent) {
        originalParent = panel.parentElement;
        originalNextSibling = panel.nextSibling;
      }

      movedPanel = panel;
      panel.dataset.navdashFullWidthProfile = "true";
      panel.style.setProperty("width", "calc(100vw - 16px)", "important");
      panel.style.setProperty("max-width", "calc(100vw - 16px)", "important");
      panel.style.setProperty("box-sizing", "border-box", "important");
      panel.style.setProperty("margin-left", "0", "important");
      panel.style.setProperty("margin-right", "0", "important");
      panel.style.setProperty("justify-self", "stretch", "important");

      if (panel.parentElement !== main) {
        workspace.insertAdjacentElement("afterend", panel);
      }
    };

    moveProfile();
    const observer = new MutationObserver(moveProfile);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", moveProfile);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", moveProfile);
      if (!movedPanel || !originalParent) return;
      delete movedPanel.dataset.navdashFullWidthProfile;
      ["width", "max-width", "box-sizing", "margin-left", "margin-right", "justify-self"].forEach((property) => movedPanel?.style.removeProperty(property));
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(movedPanel, originalNextSibling);
      } else {
        originalParent.appendChild(movedPanel);
      }
    };
  }, []);

  return null;
}
