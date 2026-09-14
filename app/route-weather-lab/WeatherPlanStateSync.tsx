"use client";

import { useEffect } from "react";

export default function WeatherPlanStateSync() {
  useEffect(() => {
    let timer: number | null = null;

    const findInputs = () => {
      const aside = document.querySelector("main aside");
      if (!(aside instanceof HTMLElement)) return null;
      const departure = aside.querySelector<HTMLInputElement>('input[type="datetime-local"]');
      const speed = aside.querySelector<HTMLInputElement>('input[type="number"]');
      if (!departure || !speed) return null;
      return { departure, speed };
    };

    const publish = async () => {
      const inputs = findInputs();
      if (!inputs || !inputs.departure.value) return;
      const speedKt = Number(inputs.speed.value);
      const departureDate = new Date(inputs.departure.value);
      if (!Number.isFinite(speedKt) || speedKt <= 0 || !Number.isFinite(departureDate.getTime())) return;
      try {
        await fetch("/api/weather-plan-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ departure: departureDate.toISOString(), speedKt }),
        });
      } catch {}
    };

    const schedulePublish = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void publish(), 250);
    };

    const bind = () => {
      const inputs = findInputs();
      if (!inputs) return false;
      inputs.departure.addEventListener("input", schedulePublish);
      inputs.departure.addEventListener("change", schedulePublish);
      inputs.speed.addEventListener("input", schedulePublish);
      inputs.speed.addEventListener("change", schedulePublish);
      schedulePublish();
      return true;
    };

    if (bind()) {
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        const inputs = findInputs();
        inputs?.departure.removeEventListener("input", schedulePublish);
        inputs?.departure.removeEventListener("change", schedulePublish);
        inputs?.speed.removeEventListener("input", schedulePublish);
        inputs?.speed.removeEventListener("change", schedulePublish);
      };
    }

    const observer = new MutationObserver(() => {
      if (bind()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
      const inputs = findInputs();
      inputs?.departure.removeEventListener("input", schedulePublish);
      inputs?.departure.removeEventListener("change", schedulePublish);
      inputs?.speed.removeEventListener("input", schedulePublish);
      inputs?.speed.removeEventListener("change", schedulePublish);
    };
  }, []);

  return null;
}
