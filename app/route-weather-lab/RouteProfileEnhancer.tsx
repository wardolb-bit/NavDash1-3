"use client";

import { useEffect } from "react";

const NS = "http://www.w3.org/2000/svg";

const compassDeg: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function parseDirection(text: string) {
  const match = text.trim().match(/^([A-Z]{1,3})\b/);
  return match ? compassDeg[match[1]] ?? null : null;
}

function parseNumber(text: string) {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function addLabel(group: SVGGElement, x: number, y: number, text: string, color: string, anchor: "start" | "middle" | "end" = "middle") {
  const width = Math.max(54, text.length * 6.2 + 16);
  const height = 22;
  let rectX = x - width / 2;
  if (anchor === "start") rectX = x;
  if (anchor === "end") rectX = x - width;
  rectX = Math.max(4, Math.min(996 - width, rectX));

  const rect = svgEl("rect", {
    x: rectX,
    y: y - 15,
    width,
    height,
    rx: 4,
    fill: "#071019",
    stroke: color,
    "stroke-opacity": .65,
    "stroke-width": 1,
  });
  const label = svgEl("text", {
    x: rectX + width / 2,
    y,
    "text-anchor": "middle",
    fill: color,
    "font-size": 12,
    "font-weight": 800,
  });
  label.textContent = text;
  group.append(rect, label);
}

function enhance() {
  const svg = document.querySelector<SVGSVGElement>('svg[viewBox="0 0 1000 160"]');
  if (!svg) return;

  svg.querySelector("g.route-profile-enhancements")?.remove();

  const sampleGroups = Array.from(svg.querySelectorAll<SVGGElement>('g[style*="cursor"]'))
    .filter((g) => g.querySelectorAll("circle").length >= 2);
  if (sampleGroups.length < 2) return;

  const samples = sampleGroups.map((g) => {
    const circles = g.querySelectorAll<SVGCircleElement>("circle");
    return {
      x: Number(circles[0].getAttribute("cx")),
      seaY: Number(circles[0].getAttribute("cy")),
      windY: Number(circles[1].getAttribute("cy")),
    };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.seaY) && Number.isFinite(p.windY));
  if (samples.length < 2) return;

  const enhancement = svgEl("g", { class: "route-profile-enhancements", "pointer-events": "none" }) as SVGGElement;

  const defs = svgEl("defs");
  const seaGradient = svgEl("linearGradient", { id: "routeSeaFill", x1: 0, y1: 0, x2: 0, y2: 1 });
  seaGradient.append(
    Object.assign(svgEl("stop", { offset: "0%", "stop-color": "#f1d56b", "stop-opacity": .42 })),
    Object.assign(svgEl("stop", { offset: "100%", "stop-color": "#f1d56b", "stop-opacity": .05 }))
  );
  const windGradient = svgEl("linearGradient", { id: "routeWindFill", x1: 0, y1: 0, x2: 0, y2: 1 });
  windGradient.append(
    Object.assign(svgEl("stop", { offset: "0%", "stop-color": "#67e8f9", "stop-opacity": .25 })),
    Object.assign(svgEl("stop", { offset: "100%", "stop-color": "#67e8f9", "stop-opacity": .03 }))
  );
  defs.append(seaGradient, windGradient);
  enhancement.append(defs);

  const seaPath = [
    `M ${samples[0].x} 62`,
    ...samples.map((p) => `L ${p.x} ${p.seaY}`),
    `L ${samples[samples.length - 1].x} 62 Z`,
  ].join(" ");
  enhancement.append(svgEl("path", { d: seaPath, fill: "url(#routeSeaFill)", stroke: "none" }));

  const windPath = [
    `M ${samples[0].x} 112`,
    ...samples.map((p) => `L ${p.x} ${p.windY}`),
    `L ${samples[samples.length - 1].x} 112 Z`,
  ].join(" ");
  enhancement.append(svgEl("path", { d: windPath, fill: "url(#routeWindFill)", stroke: "none" }));

  const tableRows = Array.from(document.querySelectorAll<HTMLTableRowElement>("table tbody tr"));
  const encounterMode = Array.from(document.querySelectorAll("div")).some((el) => el.textContent?.trim() === "ROUTE ENCOUNTER");

  if (encounterMode && tableRows.length >= samples.length) {
    const every = samples.length <= 5 ? 1 : 2;
    samples.forEach((point, index) => {
      if (index % every !== 0 && index !== samples.length - 1) return;
      const cells = tableRows[index]?.querySelectorAll<HTMLTableCellElement>("td");
      if (!cells || cells.length < 8) return;

      const windDir = parseDirection(cells[3]?.textContent || "");
      if (windDir !== null) {
        const arrow = svgEl("g", { transform: `translate(${point.x} ${Math.min(102, point.windY + 12)}) rotate(${windDir + 180})` });
        arrow.append(
          svgEl("line", { x1: -8, y1: 0, x2: 8, y2: 0, stroke: "#67e8f9", "stroke-width": 2, "stroke-linecap": "round" }),
          svgEl("path", { d: "M 8 0 L 3 -4 M 8 0 L 3 4", fill: "none", stroke: "#67e8f9", "stroke-width": 2, "stroke-linecap": "round" })
        );
        enhancement.append(arrow);
      }

      const waveDir = parseDirection(cells[7]?.textContent || "");
      if (waveDir !== null) {
        const arrow = svgEl("g", { transform: `translate(${point.x} ${Math.max(20, point.seaY - 10)}) rotate(${waveDir + 180})`, opacity: .88 });
        arrow.append(
          svgEl("line", { x1: -6, y1: 0, x2: 6, y2: 0, stroke: "#f1d56b", "stroke-width": 1.6, "stroke-linecap": "round" }),
          svgEl("path", { d: "M 6 0 L 2 -3 M 6 0 L 2 3", fill: "none", stroke: "#f1d56b", "stroke-width": 1.6, "stroke-linecap": "round" })
        );
        enhancement.append(arrow);
      }
    });

    const seaValues = tableRows.slice(0, samples.length).map((row) => parseNumber(row.querySelectorAll("td")[5]?.textContent || "") ?? -Infinity);
    const windValues = tableRows.slice(0, samples.length).map((row) => parseNumber(row.querySelectorAll("td")[3]?.textContent || "") ?? -Infinity);
    const maxSeaIndex = seaValues.indexOf(Math.max(...seaValues));
    const maxWindIndex = windValues.indexOf(Math.max(...windValues));

    if (maxSeaIndex >= 0 && Number.isFinite(seaValues[maxSeaIndex])) {
      const p = samples[maxSeaIndex];
      addLabel(enhancement, p.x, Math.max(18, p.seaY - 18), `${seaValues[maxSeaIndex].toFixed(1)} ft`, "#f1d56b");
    }
    if (maxWindIndex >= 0 && Number.isFinite(windValues[maxWindIndex])) {
      const p = samples[maxWindIndex];
      const windText = tableRows[maxWindIndex].querySelectorAll("td")[3]?.textContent?.trim() || `${windValues[maxWindIndex]} kt`;
      addLabel(enhancement, p.x, Math.min(106, p.windY + 30), windText, "#67e8f9");
    }
  }

  const firstPolyline = svg.querySelector("polyline");
  if (firstPolyline) svg.insertBefore(enhancement, firstPolyline);
  else svg.prepend(enhancement);
}

export default function RouteProfileEnhancer() {
  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(enhance);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
