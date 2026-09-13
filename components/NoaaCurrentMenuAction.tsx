"use client";

import { useEffect } from "react";

const TOGGLE_ID = "navdash-current-arrows-toggle";
const ACTION_ID = "navdash-current-arrows-menu-action";

function isWeatherRow(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const button = target.closest("button");
  if (!(button instanceof HTMLButtonElement)) return false;
  return (button.textContent || "").trim().toUpperCase().startsWith("WEATHER");
}

function install() {
  const submenu = document.getElementById("navdash-map-context-submenu");
  const source = document.getElementById(TOGGLE_ID) as HTMLButtonElement | null;
  if (!(submenu instanceof HTMLElement) || !(source instanceof HTMLButtonElement)) return;

  const text = (submenu.textContent || "").toUpperCase();
  if (!text.includes("NOAA ROUTE WX") && !text.includes("AMI WX")) return;

  document.getElementById(ACTION_ID)?.remove();

  const action = document.createElement("button");
  action.id = ACTION_ID;
  action.type = "button";
  const template = submenu.querySelector<HTMLButtonElement>("button");
  if (template) action.style.cssText = template.style.cssText;

  const enabled = source.dataset.currentEnabled === "true";
  action.textContent = `NOAA CURRENTS ${enabled ? "ON" : "OFF"}`;
  const day = document.documentElement.getAttribute("data-navdash-theme") === "day";
  action.style.color = enabled ? (day ? "#006f78" : "#22d3ee") : (day ? "#17212b" : "#e7edf3");

  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    source.click();
    document.getElementById("navdash-map-context-submenu")?.remove();
    document.getElementById("navdash-map-context-menu")?.remove();
  });

  submenu.insertBefore(action, submenu.firstChild);
}

export function NoaaCurrentMenuAction() {
  useEffect(() => {
    const onIntent = (event: Event) => {
      if (!isWeatherRow(event.target)) return;
      window.setTimeout(install, 0);
    };

    document.addEventListener("mouseover", onIntent, true);
    document.addEventListener("click", onIntent, true);
    return () => {
      document.removeEventListener("mouseover", onIntent, true);
      document.removeEventListener("click", onIntent, true);
      document.getElementById(ACTION_ID)?.remove();
    };
  }, []);

  return null;
}
