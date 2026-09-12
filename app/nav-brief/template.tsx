"use client";

import { ReactNode, useEffect } from "react";

function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(isLat ? 2 : 3, "0")}° ${min.toFixed(3)}' ${hemi}`;
}

function formatEta(date: Date) {
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function printTables() {
  return Array.from(document.querySelectorAll<HTMLTableElement>(".print-panel table"));
}

function tableHeaders(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("thead th")).map(cell => (cell.textContent || "").trim().toUpperCase());
}

function formatWeatherPositions() {
  for (const table of printTables()) {
    const headers = tableHeaders(table);
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
      const formatted = `${formatCoord(lat, true)} / ${formatCoord(lon, false)}`;
      if (cell.textContent !== formatted) cell.textContent = formatted;
    }
  }
}

function clarifyWeatherGusts() {
  for (const table of printTables()) {
    const headers = tableHeaders(table);
    const windIndex = headers.indexOf("WIND");
    if (windIndex < 0 || !headers.includes("SEAS") || !headers.includes("POSITION")) continue;

    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      const cell = cells[windIndex];
      if (!cell) continue;
      const current = (cell.textContent || "").trim();
      const clarified = current.replace(/\sG\s+(\d+(?:\.\d+)?)/i, " Gusts $1");
      if (clarified !== current) cell.textContent = clarified;
    }
  }
}

function simplifyAmiIssuedLine() {
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".print-sub"));
  for (const panel of panels) {
    const heading = Array.from(panel.querySelectorAll("div")).find(div => (div.textContent || "").trim().toUpperCase() === "WEATHER INFORMATION");
    if (!heading) continue;
    const detail = heading.nextElementSibling;
    if (!(detail instanceof HTMLElement)) continue;
    const firstNode = detail.firstChild;
    if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) continue;
    const text = firstNode.nodeValue || "";
    const match = text.match(/ISSUED\s+(.+)$/i);
    if (!match) continue;
    const simplified = `AMI Weather Issued: ${match[1].trim()}`;
    if (firstNode.nodeValue !== simplified) firstNode.nodeValue = simplified;
  }
}

function addWaypointEtas() {
  const page = document.querySelector(".navdash-navbrief-console");
  if (!page) return;

  const departureInput = page.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
  const speedInput = page.querySelector('input[type="number"]') as HTMLInputElement | null;
  const departure = departureInput?.value ? new Date(departureInput.value) : null;
  const speed = Number(speedInput?.value);
  const hasTiming = Boolean(departure && Number.isFinite(departure.getTime()) && Number.isFinite(speed) && speed > 0);

  for (const table of printTables()) {
    let headers = tableHeaders(table);
    if (!headers.includes("LEG") || !headers.includes("FROM") || !headers.includes("TO") || !headers.includes("DIST")) continue;

    const headRow = table.querySelector("thead tr");
    if (!headRow) continue;

    let etaIndex = headers.indexOf("ETA @ TO");
    if (etaIndex < 0) {
      const referenceHeader = headRow.querySelector("th:last-child");
      const etaHeader = document.createElement("th");
      etaHeader.textContent = "ETA @ TO";
      etaHeader.dataset.navbriefEta = "header";
      etaHeader.className = referenceHeader?.className || "border border-white/10 px-2 py-2 text-left";
      headRow.appendChild(etaHeader);
      headers = tableHeaders(table);
      etaIndex = headers.indexOf("ETA @ TO");
    }

    const distIndex = headers.indexOf("DIST");
    let cumulativeNm = 0;

    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td"));
      const distanceText = cells[distIndex]?.textContent || "";
      const distance = Number(distanceText.match(/-?\d+(?:\.\d+)?/)?.[0]);
      if (Number.isFinite(distance)) cumulativeNm += distance;

      let etaCell = row.querySelector<HTMLTableCellElement>('td[data-navbrief-eta="cell"]');
      if (!etaCell) {
        const referenceCell = cells[cells.length - 1];
        etaCell = document.createElement("td");
        etaCell.dataset.navbriefEta = "cell";
        etaCell.className = referenceCell?.className || "border border-white/10 px-2 py-2";
        etaCell.classList.remove("text-right");
        etaCell.classList.add("text-left", "font-mono");
        row.appendChild(etaCell);
      }

      const text = hasTiming && departure
        ? formatEta(new Date(departure.getTime() + cumulativeNm / speed * 3600000))
        : "--";
      if (etaCell.textContent !== text) etaCell.textContent = text;
    }
  }
}

function enhancePrintTables() {
  formatWeatherPositions();
  clarifyWeatherGusts();
  simplifyAmiIssuedLine();
  addWaypointEtas();
}

export default function NavBriefTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    enhancePrintTables();
    const observer = new MutationObserver(enhancePrintTables);
    observer.observe(document.body, { childList: true, subtree: true });

    const refresh = () => enhancePrintTables();
    document.addEventListener("input", refresh, true);
    document.addEventListener("change", refresh, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", refresh, true);
      document.removeEventListener("change", refresh, true);
    };
  }, []);

  return <>{children}</>;
}
