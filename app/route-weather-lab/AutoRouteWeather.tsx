"use client";

import { useEffect } from "react";

const REFRESH_MS = 15 * 60 * 1000;

function findButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label) || null;
}

export default function AutoRouteWeather() {
  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let running = false;
    let lastRun = 0;

    const waitFor = async (test: () => boolean, timeoutMs = 15000) => {
      const started = Date.now();
      while (!disposed && Date.now() - started < timeoutMs) {
        if (test()) return true;
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      return false;
    };

    const run = async (force = false) => {
      if (disposed || running) return;
      if (!force && Date.now() - lastRun < REFRESH_MS) return;
      running = true;

      try {
        const load = findButton("LOAD CURRENT ROUTE");
        if (!load) return;

        load.click();

        const loaded = await waitFor(() => {
          const analyze = findButton("ANALYZE ROUTE");
          const loading = findButton("LOADING CURRENT ROUTE…");
          return !loading && !!analyze && !analyze.disabled;
        });
        if (!loaded || disposed) return;

        const analyze = findButton("ANALYZE ROUTE");
        if (!analyze || analyze.disabled) return;
        analyze.click();
        lastRun = Date.now();
      } finally {
        running = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") run(false);
    };

    const start = () => {
      run(true);
      timer = window.setInterval(() => run(false), REFRESH_MS);
      document.addEventListener("visibilitychange", onVisible);
    };

    const startupTimer = window.setTimeout(start, 350);

    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
