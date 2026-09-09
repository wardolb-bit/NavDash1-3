"use client";

import { useEffect } from "react";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";

type SavedWaypoint = { id?: string };

function readWaypoints(): SavedWaypoint[] {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
  } catch {
    return [];
  }
}

function sequenceLabelFromIds(text: string, waypoints: SavedWaypoint[]) {
  const match = text.match(/^\s*(.+?)\s*[→-]\s*(.+?)\s*$/);
  if (!match || waypoints.length < 2) return null;

  const fromId = match[1].trim();
  const toId = match[2].trim();

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    if (String(waypoints[i]?.id ?? "") === fromId && String(waypoints[i + 1]?.id ?? "") === toId) {
      return `${i + 1} → ${i + 2}`;
    }
  }

  return null;
}

export function BridgeLegSequenceDisplay() {
  useEffect(() => {
    let timer = 0;

    const sync = () => {
      const routeSection = document.getElementById("v12-section-route");
      const activeLegSource = routeSection?.nextElementSibling as HTMLElement | null;
      const sourceText = activeLegSource?.querySelector<HTMLElement>(".text-wardGold")?.textContent?.trim() || "";
      const sequenceLabel = sequenceLabelFromIds(sourceText, readWaypoints());
      if (!sequenceLabel) return;

      const railLeg = document.getElementById("bc2-leg");
      if (railLeg && railLeg.textContent !== sequenceLabel) railLeg.textContent = sequenceLabel;

      const topLeg = document.getElementById("bc2-top-leg");
      const topLabel = `LEG ${sequenceLabel}`;
      if (topLeg && topLeg.textContent !== topLabel) topLeg.textContent = topLabel;
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 20);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("storage", schedule);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("storage", schedule);
    };
  }, []);

  return null;
}
