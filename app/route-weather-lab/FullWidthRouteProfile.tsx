"use client";

import { useEffect } from "react";

export default function FullWidthRouteProfile() {
  useEffect(() => {
    let movedPanel: HTMLElement | null = null;
    let originalParent: HTMLElement | null = null;
    let originalNextSibling: ChildNode | null = null;

    const moveProfile = () => {
      if (movedPanel?.isConnected) return;

      const main = document.querySelector("main");
      if (!(main instanceof HTMLElement)) return;

      const workspace = Array.from(main.children).find((child) =>
        child instanceof HTMLElement &&
        child.classList.contains("grid") &&
        child.querySelector("#route-weather-lab-map")
      );
      if (!(workspace instanceof HTMLElement)) return;

      const profileLabel = Array.from(workspace.querySelectorAll("div")).find(
        (node) => (node.textContent || "").trim() === "ROUTE PROFILE",
      );
      if (!(profileLabel instanceof HTMLElement)) return;

      const panel = profileLabel.closest("div.mt-2.border");
      if (!(panel instanceof HTMLElement)) return;

      originalParent = panel.parentElement;
      originalNextSibling = panel.nextSibling;
      movedPanel = panel;

      panel.dataset.navdashFullWidthProfile = "true";
      panel.style.width = "100%";
      panel.style.maxWidth = "none";
      panel.style.gridColumn = "1 / -1";
      workspace.insertAdjacentElement("afterend", panel);
    };

    moveProfile();
    const observer = new MutationObserver(moveProfile);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (!movedPanel || !originalParent) return;
      delete movedPanel.dataset.navdashFullWidthProfile;
      movedPanel.style.removeProperty("width");
      movedPanel.style.removeProperty("max-width");
      movedPanel.style.removeProperty("grid-column");
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(movedPanel, originalNextSibling);
      } else {
        originalParent.appendChild(movedPanel);
      }
    };
  }, []);

  return null;
}
