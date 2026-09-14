"use client";

import { useEffect } from "react";

export default function FullWidthRouteProfile() {
  useEffect(() => {
    let movedPanel: HTMLElement | null = null;
    let originalParent: HTMLElement | null = null;
    let originalNextSibling: ChildNode | null = null;

    const moveProfile = () => {
      if (movedPanel?.isConnected && movedPanel.parentElement?.tagName === "MAIN") return;

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

      workspace.insertAdjacentElement("afterend", panel);
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
      ["width", "max-width", "box-sizing", "margin-left", "margin-right"].forEach((property) => movedPanel?.style.removeProperty(property));
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(movedPanel, originalNextSibling);
      } else {
        originalParent.appendChild(movedPanel);
      }
    };
  }, []);

  return null;
}
