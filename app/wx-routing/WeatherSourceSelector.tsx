"use client";

import { useEffect } from "react";

const SOURCE_KEY = "navdash-wx-routing-source";

function relabelWeatherUi() {
  const replacements: Array<[RegExp, string]> = [
    [/^GRIB Sample Points$/i, "Weather Points"],
    [/^GRIB Forecast File$/i, "NOAA Forecast"],
    [/^Imported GRIB weather is displayed as route exposure, projected forecast values, flowing wind, and pressure isobars when data is available\.$/i,
      "NOAA route weather is displayed as route exposure, forecast points, and flowing wind where the selected NOAA product provides data."],
    [/^Load a route and GRIB file to show leg-by-leg weather\.$/i, "Load a route to show leg-by-leg NOAA weather."],
  ];

  document.querySelectorAll<HTMLElement>("div,span,p").forEach((element) => {
    const text = (element.textContent || "").trim();
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(text) && element.children.length === 0 && element.textContent !== replacement) {
        element.textContent = replacement;
        break;
      }
    }
  });
}

export default function WeatherSourceSelector() {
  useEffect(() => {
    try { window.localStorage.setItem(SOURCE_KEY, "noaa"); } catch {}
    relabelWeatherUi();
    const observer = new MutationObserver(relabelWeatherUi);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
