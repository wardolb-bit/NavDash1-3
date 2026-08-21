"use client";

import { useEffect } from "react";

function splitPosition(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const parts = normalized.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { lat: parts[0], lon: parts[1] };

  const match = normalized.match(/(.+?[NS])\s+(.+?[EW])$/i);
  if (match) return { lat: match[1].trim(), lon: match[2].trim() };
  return null;
}

function cyan(el: Element) {
  return ((el.getAttribute("stroke") || "").toLowerCase() === "#22d3ee");
}

export function BridgeOwnShipUpgrade() {
  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const sync = () => {
      if (stopped) return;

      const map = document.getElementById("v12-map");
      const latOut = document.getElementById("bc2-lat");
      const lonOut = document.getElementById("bc2-lon");

      // The original NavDash voyage snapshot already renders the complete
      // formatted position. Mirror both halves into the bridge-console rail.
      if (latOut && lonOut) {
        const snapshot = document.getElementById("v12-section-route");
        if (snapshot) {
          const candidates = Array.from(snapshot.querySelectorAll<HTMLElement>("div"));
          const positionLabel = candidates.find((el) => el.textContent?.trim() === "Own Ship Position");
          const card = positionLabel?.parentElement;
          const positionValue = card
            ? Array.from(card.querySelectorAll<HTMLElement>("div")).find((el) => {
                const text = el.textContent?.trim() || "";
                return /[NS]/i.test(text) && /[EW]/i.test(text) && text !== "Own Ship Position";
              })
            : null;
          const parsed = positionValue ? splitPosition(positionValue.textContent || "") : null;
          if (parsed) {
            latOut.textContent = parsed.lat;
            lonOut.textContent = parsed.lon;
          }
        }
      }

      if (map) {
        const svg = map.querySelector<SVGSVGElement>("svg.leaflet-zoom-animated");
        const circles = Array.from(map.querySelectorAll<SVGCircleElement>("circle")).filter(cyan);
        const vector = Array.from(map.querySelectorAll<SVGPathElement>("path")).find(
          (path) => cyan(path) && !!(path.getAttribute("stroke-dasharray") || "").trim(),
        );

        const ownCircle = circles.find((circle) => Number(circle.getAttribute("r") || 0) >= 7);
        if (svg && ownCircle) {
          let symbol = svg.querySelector<SVGPolygonElement>("#navdash-ownship-arrow");
          if (!symbol) {
            symbol = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            symbol.id = "navdash-ownship-arrow";
            symbol.setAttribute("fill", "#22d3ee");
            symbol.setAttribute("stroke", "#d9fbff");
            symbol.setAttribute("stroke-width", "1.5");
            symbol.setAttribute("vector-effect", "non-scaling-stroke");
            symbol.style.pointerEvents = "none";
            svg.appendChild(symbol);
          }

          const cx = Number(ownCircle.getAttribute("cx") || 0);
          const cy = Number(ownCircle.getAttribute("cy") || 0);
          let angle = 0;

          if (vector) {
            const d = vector.getAttribute("d") || "";
            const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
            if (nums.length >= 4) {
              const x1 = nums[0];
              const y1 = nums[1];
              const x2 = nums[nums.length - 2];
              const y2 = nums[nums.length - 1];
              angle = Math.atan2(x2 - x1, -(y2 - y1)) * 180 / Math.PI;
            }
          }

          // Bow-forward vessel pointer. The polygon itself lives in Leaflet's
          // SVG layer, so pan/zoom keeps it locked to the AIS geographic fix.
          symbol.setAttribute("points", `${cx},${cy - 14} ${cx - 8},${cy + 9} ${cx},${cy + 5} ${cx + 8},${cy + 9}`);
          symbol.setAttribute("transform", `rotate(${angle} ${cx} ${cy})`);
          symbol.style.display = ownCircle.style.display === "none" ? "none" : "";
          ownCircle.setAttribute("r", "2.5");
          ownCircle.setAttribute("fill-opacity", "1");
        }
      }

      timer = window.setTimeout(sync, 200);
    };

    sync();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.getElementById("navdash-ownship-arrow")?.remove();
    };
  }, []);

  return null;
}
