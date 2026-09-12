"use client";

import { ReactNode, useEffect } from "react";

function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(isLat ? 2 : 3, "0")}° ${min.toFixed(3)}' ${hemi}`;
}

function formatWeatherPositions() {
  const tables = Array.from(document.querySelectorAll(".print-panel table"));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll("thead th")).map(cell => (cell.textContent || "").trim().toUpperCase());
    const positionIndex = headers.indexOf("POSITION");
    if (positionIndex < 0 || !headers.includes("WIND") || !headers.includes("SEAS")) continue;

    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      const cell = cells[positionIndex];
      if (!cell) continue;
      const match = (cell.textContent || "").trim().match(/^(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?$/);
      if (!match) continue;
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      cell.textContent = `${formatCoord(lat, true)} / ${formatCoord(lon, false)}`;
    }
  }
}

export default function NavBriefTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    formatWeatherPositions();
    const observer = new MutationObserver(formatWeatherPositions);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <>{children}</>;
}
