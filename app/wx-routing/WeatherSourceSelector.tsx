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
    [/^Load a route and import GRIB after the route is loaded to build a storm watch from route-matched forecast legs\.$/i,
      "Load a route to build a storm watch from NOAA route-matched forecast legs."],
    [/^Use this as GRIB model guidance only\./i, "Use this as NOAA forecast guidance."],
    [/^Load a route and route-sampled GRIB to test alternate speed or departure delay\.$/i,
      "Load a route with NOAA weather to test alternate speed or departure delay."],
    [/^Load a route and route-sampled GRIB, then set a WHAT IF speed or delay to compare against the current plan\.$/i,
      "Load a route with NOAA weather, then set a WHAT IF speed or delay to compare against the current plan."],
    [/^Compare uses the same route-matched GRIB points as Route Exposure\./i,
      "Compare uses the same route-matched NOAA forecast points as Route Exposure."],
    [/^This GRIB is loaded on the map as sample data\./i,
      "NOAA weather is loaded on the map as route forecast data."],
    [/^Load a route before importing GRIB to color route legs by forecast exposure\.$/i,
      "Load a route to color route legs by NOAA forecast exposure."],
    [/^Using .*\. Import GRIB after loading a route for projected-route weather\.$/i,
      "Using NOAA route weather when available."],
    [/^Load a route, load a GRIB timeline, and set planning speed to show the projected vessel\.$/i,
      "Load a route and set planning speed to show the projected vessel."],
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

  document.querySelectorAll<HTMLElement>("button,label").forEach((element) => {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (/^GRIB$/i.test(text) || /^Import GRIB$/i.test(text) || /^Clear GRIB$/i.test(text)) {
      element.style.setProperty("display", "none", "important");
    }
  });
}

export default function WeatherSourceSelector() {
  useEffect(() => {
    try { window.localStorage.setItem(SOURCE_KEY, "noaa"); } catch {}
    relabelWeatherUi();
    const observer = new MutationObserver(relabelWeatherUi);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
