"use client";

import { useEffect } from "react";

const BUTTON_ID = "navdash-route-lab-button";

export function BridgeRouteLabButton() {
  useEffect(() => {
    let timer = 0;
    let cancelled = false;

    const install = () => {
      if (cancelled) return;
      if (document.getElementById(BUTTON_ID)) return;

      const loadRtz = Array.from(document.querySelectorAll("label")).find(
        (element) => (element.textContent || "").trim().toUpperCase().startsWith("LOAD RTZ"),
      );

      if (!(loadRtz instanceof HTMLElement) || !loadRtz.parentElement) {
        timer = window.setTimeout(install, 250);
        return;
      }

      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "ROUTE LAB";
      button.className = "h-[30px] min-w-[108px] border border-cyan-400/60 bg-cyan-950/20 px-2 text-[10px] font-black text-cyan-300";
      button.addEventListener("click", () => { window.location.href = "/route-lab"; });
      loadRtz.insertAdjacentElement("afterend", button);
    };

    install();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.getElementById(BUTTON_ID)?.remove();
    };
  }, []);

  return null;
}
