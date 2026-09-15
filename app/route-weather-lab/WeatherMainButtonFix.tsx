"use client";

import { useEffect } from "react";

export default function WeatherMainButtonFix() {
  useEffect(() => {
    const fixButton = () => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
      const target = links.find((link) => link.textContent?.trim() === "NAV CONSOLE");
      if (!target) return false;
      target.textContent = "MAIN";
      target.href = "/bridge";
      return true;
    };

    if (fixButton()) return;

    const observer = new MutationObserver(() => {
      if (fixButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
