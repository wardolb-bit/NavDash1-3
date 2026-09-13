"use client";

import { useEffect } from "react";

export function ArrivalPlannerBridgeButton() {
  useEffect(() => {
    let timer = 0;
    let observer: MutationObserver | null = null;

    function findFullscreenButton() {
      return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
        button.textContent?.includes("FULLSCREEN"),
      );
    }

    function install() {
      const fullscreen = findFullscreenButton();
      if (!fullscreen?.parentElement) return false;

      let button = document.getElementById("navdash-arrival-plan-button") as HTMLButtonElement | null;
      if (!button) {
        button = document.createElement("button");
        button.id = "navdash-arrival-plan-button";
        button.type = "button";
        button.textContent = "ARRIVAL PLAN";
        button.addEventListener("click", () => { window.location.href = "/voyage-planner"; });
        fullscreen.parentElement.insertBefore(button, fullscreen);
      }

      if (button.className !== fullscreen.className) button.className = fullscreen.className;
      return true;
    }

    if (!install()) {
      timer = window.setInterval(() => {
        if (install()) window.clearInterval(timer);
      }, 100);
    }

    const fullscreen = findFullscreenButton();
    if (fullscreen) {
      observer = new MutationObserver(() => { void install(); });
      observer.observe(fullscreen, { attributes: true, attributeFilter: ["class"] });
    }

    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
      document.getElementById("navdash-arrival-plan-button")?.remove();
    };
  }, []);

  return null;
}
