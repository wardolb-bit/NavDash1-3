"use client";

import { useEffect } from "react";

export default function WeatherMainButtonFix() {
  useEffect(() => {
    const fixButton = () => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
      const targets = links.filter((link) => {
        const label = link.textContent?.trim();
        return label === "NAV CONSOLE" || label === "MAIN";
      });

      targets.forEach((target) => {
        target.textContent = "MAIN";
        if (target.getAttribute("href") !== "/bridge") target.setAttribute("href", "/bridge");
      });
    };

    fixButton();

    const observer = new MutationObserver(() => fixButton());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
