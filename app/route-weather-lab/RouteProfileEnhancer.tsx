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

function addLabel(group: SVGGElement, x: number, y: number, text: string, color: string, strong = false) {
  const width = Math.max(58, text.length * 6.3 + 18);
  const height = strong ? 25 : 22;
  const rectX = Math.max(4, Math.min(996 - width, x - width / 2));
  const rectY = y - (strong ? 17 : 15);
  group.append(svgEl("rect", {
    x: rectX,
    y: rectY,
    width,
    height,
    rx: 4,
    fill: strong ? "#03070b" : "#071019",
    "fill-opacity": strong ? .96 : .9,
    stroke: color,
    "stroke-opacity": strong ? .9 : .65,
    "stroke-width": strong ? 1.5 : 1,
  }));
  const label = svgEl("text", {
    x: rectX + width / 2,
    y,
    "text-anchor": "middle",
    fill: color,
    "font-size": strong ? 13 : 12,
    "font-weight": 900,
  });
  label.textContent = text;
  group.append(label);
}

function addBandTitle(group: SVGGElement, x: number, y: number, text: string, color: string) {
  const label = svgEl("text", {
    x,
    y,
    fill: color,
    "font-size": 9,
    "font-weight": 900,
    "letter-spacing": 1.8,
    opacity: .75,
  });
  label.textContent = text;
  group.append(label);
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
    svgEl("stop", { offset: "0%", "stop-color": "#f1d56b", "stop-opacity": .48 }),
    svgEl("stop", { offset: "70%", "stop-color": "#f1d56b", "stop-opacity": .14 }),
    svgEl("stop", { offset: "100%", "stop-color": "#f1d56b", "stop-opacity": .025 })
  );
  const windGradient = svgEl("linearGradient", { id: "routeWindFill", x1: 0, y1: 0, x2: 0, y2: 1 });
  windGradient.append(
    svgEl("stop", { offset: "0%", "stop-color": "#67e8f9", "stop-opacity": .34 }),
    svgEl("stop", { offset: "72%", "stop-color": "#67e8f9", "stop-opacity": .1 }),
    svgEl("stop", { offset: "100%", "stop-color": "#67e8f9", "stop-opacity": .02 })
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

  addBandTitle(enhancement, 8, 16, "SEA HEIGHT", "#f1d56b");
  addBandTitle(enhancement, 8, 78, "WIND", "#67e8f9");

  const tableRows = Array.from(document.querySelectorAll<HTMLTableRowElement>("table tbody tr"));
  const encounterMode = Array.from(document.querySelectorAll("div")).some((el) => el.textContent?.trim() === "ROUTE ENCOUNTER");

  if (encounterMode && tableRows.length >= samples.length) {
    const every = samples.length <= 5 ? 1 : samples.length <= 9 ? 2 : 3;

    samples.forEach((point, index) => {
      if (index % every !== 0 && index !== samples.length - 1) return;
      const cells = tableRows[index]?.querySelectorAll<HTMLTableCellElement>("td");
      if (!cells || cells.length < 8) return;

      const windDir = parseDirection(cells[3]?.textContent || "");
      if (windDir !== null) {
        const arrow = svgEl("g", { transform: `translate(${point.x} ${Math.min(104, point.windY + 13)}) rotate(${windDir + 180})` });
        arrow.append(
          svgEl("line", { x1: -9, y1: 0, x2: 9, y2: 0, stroke: "#67e8f9", "stroke-width": 2.2, "stroke-linecap": "round" }),
          svgEl("path", { d: "M 9 0 L 3 -4.5 M 9 0 L 3 4.5", fill: "none", stroke: "#67e8f9", "stroke-width": 2.2, "stroke-linecap": "round" })
        );
        enhancement.append(arrow);
      }

      const waveDir = parseDirection(cells[7]?.textContent || "");
      if (waveDir !== null) {
        const arrow = svgEl("g", { transform: `translate(${point.x} ${Math.max(21, point.seaY - 10)}) rotate(${waveDir + 180})`, opacity: .95 });
        arrow.append(
          svgEl("line", { x1: -7, y1: 0, x2: 7, y2: 0, stroke: "#f1d56b", "stroke-width": 1.8, "stroke-linecap": "round" }),
          svgEl("path", { d: "M 7 0 L 2 -3.5 M 7 0 L 2 3.5", fill: "none", stroke: "#f1d56b", "stroke-width": 1.8, "stroke-linecap": "round" })
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
      enhancement.append(svgEl("line", { x1: p.x, y1: p.seaY, x2: p.x, y2: Math.max(20, p.seaY - 14), stroke: "#f1d56b", "stroke-width": 1, opacity: .8 }));
      addLabel(enhancement, p.x, Math.max(17, p.seaY - 18), `${seaValues[maxSeaIndex].toFixed(1)} ft`, "#f1d56b", true);
    }

    if (maxWindIndex >= 0 && Number.isFinite(windValues[maxWindIndex])) {
      const p = samples[maxWindIndex];
      const windText = tableRows[maxWindIndex].querySelectorAll("td")[3]?.textContent?.trim() || `${windValues[maxWindIndex]} kt`;
      enhancement.append(svgEl("line", { x1: p.x, y1: p.windY, x2: p.x, y2: Math.min(107, p.windY + 18), stroke: "#67e8f9", "stroke-width": 1, opacity: .8 }));
      addLabel(enhancement, p.x, Math.min(109, p.windY + 32), windText, "#67e8f9", true);
    }
  }

  const vesselLine = Array.from(svg.querySelectorAll<SVGLineElement>('line[stroke="#22d3ee"]'))
    .find((line) => Number(line.getAttribute("y2")) > 100);
  if (vesselLine) {
    const x = Number(vesselLine.getAttribute("x1"));
    if (Number.isFinite(x)) {
      enhancement.append(svgEl("rect", { x: x - 2, y: 4, width: 4, height: 120, rx: 2, fill: "#22d3ee", opacity: .24 }));
      enhancement.append(svgEl("circle", { cx: x, cy: 8, r: 5, fill: "#22d3ee", stroke: "#f8fafc", "stroke-width": 1.5 }));

      let nearestIndex = 0;
      let nearestDx = Infinity;
      samples.forEach((p, i) => {
        const dx = Math.abs(p.x - x);
        if (dx < nearestDx) {
          nearestDx = dx;
          nearestIndex = i;
        }
      });

      const approximateNm = samples.length > 1
        ? (x / 1000) * (parseNumber(tableRows[tableRows.length - 1]?.querySelectorAll("td")[0]?.textContent || "") || 0)
        : 0;
      const cells = tableRows[nearestIndex]?.querySelectorAll<HTMLTableCellElement>("td");
      const seaText = cells?.[5]?.textContent?.trim() || "--";
      const windText = cells?.[3]?.textContent?.trim() || "--";
      const readout = `${Math.round(approximateNm)} NM  •  ${seaText}  •  ${windText}`;
      const width = Math.max(180, readout.length * 6.1 + 22);
      const bx = Math.max(6, Math.min(994 - width, x - width / 2));
      enhancement.append(svgEl("rect", {
        x: bx,
        y: 18,
        width,
        height: 25,
        rx: 5,
        fill: "#03070b",
        "fill-opacity": .97,
        stroke: "#22d3ee",
        "stroke-opacity": .9,
        "stroke-width": 1.4,
      }));
      const text = svgEl("text", {
        x: bx + width / 2,
        y: 35,
        "text-anchor": "middle",
        fill: "#dffaff",
        "font-size": 12,
        "font-weight": 900,
      });
      text.textContent = readout;
      enhancement.append(text);
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
