"use client";

import { useEffect } from "react";

const MAP_ELEMENT_ID = "navmap-main-isolated-v2";

type IdentifyResult = {
  layerId?: number;
  layerName?: string;
  value?: string;
  displayFieldName?: string;
  attributes?: Record<string, unknown>;
};

type IdentifyResponse = {
  source?: string;
  results?: IdentifyResult[];
  error?: string;
};

type SummaryRow = { label: string; value: string; emphasis?: boolean };

const COLOUR: Record<number, string> = {
  1: "White", 2: "Black", 3: "Red", 4: "Green", 5: "Blue", 6: "Yellow",
  7: "Grey", 8: "Brown", 9: "Amber", 10: "Violet", 11: "Orange", 12: "Magenta", 13: "Pink",
};

const LIGHT_CHARACTER: Record<number, string> = {
  1: "F", 2: "Fl", 3: "LFl", 4: "Q", 5: "VQ", 6: "UQ", 7: "Iso", 8: "Oc",
  9: "IQ", 10: "IVQ", 11: "IUQ", 12: "Mo", 13: "F+Fl", 14: "F+LFl", 15: "Oc+Fl",
  16: "Oc+LFl", 17: "Al.Oc", 18: "Al.LFl", 19: "Al.Fl", 20: "Al.Gr", 21: "Q+LFl",
  22: "VQ+LFl", 23: "UQ+LFl", 24: "Al", 25: "F.Al", 26: "Fl+LFl", 27: "Oc.Al", 28: "Al",
};

const CATLIT: Record<number, string> = {
  1: "Directional", 2: "Leading", 3: "Aero", 4: "Air obstruction", 5: "Fog detector",
  6: "Floodlight", 7: "Strip light", 8: "Subsidiary", 9: "Spotlight", 10: "Front",
  11: "Rear", 12: "Lower", 13: "Upper", 14: "Moire effect", 15: "Emergency", 16: "Bearing light", 17: "Horizontally disposed", 18: "Vertically disposed",
};

const BUOY_SHAPE: Record<number, string> = {
  1: "Conical (nun)", 2: "Can", 3: "Spherical", 4: "Pillar", 5: "Spar", 6: "Barrel",
  7: "Super-buoy", 8: "Ice buoy",
};

const BEACON_SHAPE: Record<number, string> = {
  1: "Stake/pole", 2: "Withy", 3: "Tower", 4: "Lattice tower", 5: "Pile", 6: "Cairn",
  7: "Buoyant beacon",
};

const TOPMARK_SHAPE: Record<number, string> = {
  1: "Cone up", 2: "Cone down", 3: "Sphere", 4: "Two spheres", 5: "Cylinder",
  6: "Board", 7: "X topmark", 8: "Upright cross", 9: "Cube point up", 10: "Two cones point-to-point",
  11: "Two cones base-to-base", 12: "Rhombus", 13: "Two cones up", 14: "Two cones down",
  15: "Sphere over rhombus", 16: "Other",
};

const STATUS: Record<number, string> = {
  1: "Permanent", 2: "Occasional", 3: "Recommended", 4: "Not in use", 5: "Periodic/intermittent",
  6: "Reserved", 7: "Temporary", 8: "Private", 9: "Mandatory", 11: "Extinguished", 12: "Illuminated", 13: "Historic", 14: "Public",
};

const CATFOG: Record<number, string> = {
  1: "Explosive", 2: "Diaphone", 3: "Siren", 4: "Nautophone", 5: "Reed", 6: "Tyfon",
  7: "Bell", 8: "Whistle", 9: "Gong", 10: "Horn", 11: "Other",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function usefulValue(value: unknown) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return Boolean(text) && text !== "Null" && text !== "null" && text !== "<Null>" && text !== "0";
}

function numericCodes(value: unknown) {
  return String(value ?? "")
    .replace(/[()]/g, "")
    .split(/[;,\s]+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part !== 0);
}

function decodeCodes(value: unknown, dictionary: Record<number, string>) {
  const codes = numericCodes(value);
  if (!codes.length) return usefulValue(value) ? String(value) : "";
  return codes.map((code) => dictionary[code] || String(code)).join(" / ");
}

function combinedAttributes(results: IdentifyResult[]) {
  const combined: Record<string, unknown[]> = {};
  for (const result of results) {
    for (const [key, value] of Object.entries(result.attributes || {})) {
      if (!usefulValue(value)) continue;
      if (!combined[key]) combined[key] = [];
      const text = String(value);
      if (!combined[key].some((current) => String(current) === text)) combined[key].push(value);
    }
  }
  return combined;
}

function firstValue(attributes: Record<string, unknown[]>, ...keys: string[]) {
  for (const key of keys) {
    const value = attributes[key]?.[0];
    if (usefulValue(value)) return value;
  }
  return undefined;
}

function allValues(attributes: Record<string, unknown[]>, key: string) {
  return attributes[key] || [];
}

function formatLatLon(lat: number, lon: number) {
  const one = (value: number, positive: string, negative: string) => {
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = (abs - degrees) * 60;
    return `${degrees}° ${minutes.toFixed(3)}′ ${value >= 0 ? positive : negative}`;
  };
  return `${one(lat, "N", "S")}  /  ${one(lon, "E", "W")}`;
}

function lightCharacteristic(attributes: Record<string, unknown[]>) {
  const rawChar = firstValue(attributes, "LITCHR");
  if (!usefulValue(rawChar)) return "";
  const char = decodeCodes(rawChar, LIGHT_CHARACTER);
  const groupRaw = firstValue(attributes, "SIGGRP");
  const group = usefulValue(groupRaw) ? String(groupRaw).replace(/^\((.*)\)$/, "$1") : "";
  const colours = allValues(attributes, "COLOUR").flatMap((value) => numericCodes(value)).map((code) => COLOUR[code]).filter(Boolean);
  const colourAbbr = [...new Set(colours)].map((colour) => ({ White: "W", Red: "R", Green: "G", Yellow: "Y", Blue: "Bu", Amber: "Am", Orange: "Or", Violet: "Vi" }[colour] || colour)).join("/");
  const periodRaw = firstValue(attributes, "SIGPER");
  const period = usefulValue(periodRaw) ? `${Number(periodRaw)}s` : "";
  return [char + (group ? `(${group})` : ""), colourAbbr, period].filter(Boolean).join(" ");
}

function objectKind(results: IdentifyResult[]) {
  const names = results.map((result) => `${result.layerName || ""} ${result.value || ""}`).join(" ").toUpperCase();
  if (names.includes("LIGHT")) return "LIGHT / AID TO NAVIGATION";
  if (names.includes("BUOY")) return "BUOY / AID TO NAVIGATION";
  if (names.includes("BEACON")) return "BEACON / AID TO NAVIGATION";
  if (names.includes("WRECK")) return "WRECK";
  if (names.includes("OBSTRUCTION")) return "OBSTRUCTION";
  if (names.includes("DEPTH") || names.includes("SOUNDING")) return "DEPTH / BATHYMETRY";
  if (names.includes("RESTRICT") || names.includes("CAUTION") || names.includes("ANCHOR")) return "CHARTED AREA";
  return "NOAA ENC FEATURE";
}

function featureTitle(results: IdentifyResult[], attributes: Record<string, unknown[]>) {
  const name = firstValue(attributes, "OBJNAM", "NOBJNM");
  if (usefulValue(name)) return String(name);
  const usefulResult = results.find((result) => usefulValue(result.value));
  return usefulResult?.value || objectKind(results);
}

function buildSummary(results: IdentifyResult[], lat: number, lon: number) {
  const attributes = combinedAttributes(results);
  const rows: SummaryRow[] = [];
  const characteristic = lightCharacteristic(attributes);
  if (characteristic) rows.push({ label: "Characteristic", value: characteristic, emphasis: true });

  const colours = allValues(attributes, "COLOUR").flatMap((value) => numericCodes(value)).map((code) => COLOUR[code]).filter(Boolean);
  if (colours.length) rows.push({ label: "Colour", value: [...new Set(colours)].join(" / ") });

  const buoyShape = firstValue(attributes, "BOYSHP");
  if (usefulValue(buoyShape)) rows.push({ label: "Buoy shape", value: decodeCodes(buoyShape, BUOY_SHAPE) });
  const beaconShape = firstValue(attributes, "BCNSHP");
  if (usefulValue(beaconShape)) rows.push({ label: "Beacon", value: decodeCodes(beaconShape, BEACON_SHAPE) });
  const topmark = firstValue(attributes, "TOPSHP");
  if (usefulValue(topmark)) rows.push({ label: "Topmark", value: decodeCodes(topmark, TOPMARK_SHAPE) });

  const catlit = firstValue(attributes, "CATLIT");
  if (usefulValue(catlit)) rows.push({ label: "Light type", value: decodeCodes(catlit, CATLIT) });

  const height = firstValue(attributes, "HEIGHT");
  if (usefulValue(height) && Number.isFinite(Number(height))) {
    const metres = Number(height);
    rows.push({ label: "Height", value: `${metres.toFixed(1)} m / ${(metres * 3.28084).toFixed(0)} ft` });
  }

  const range = firstValue(attributes, "VALNMR");
  if (usefulValue(range)) rows.push({ label: "Nominal range", value: `${Number(range)} NM` });

  const sector1 = firstValue(attributes, "SECTR1");
  const sector2 = firstValue(attributes, "SECTR2");
  if (usefulValue(sector1) || usefulValue(sector2)) {
    rows.push({ label: "Sector", value: `${usefulValue(sector1) ? Number(sector1).toFixed(1) : "?"}° – ${usefulValue(sector2) ? Number(sector2).toFixed(1) : "?"}°` });
  }

  const fog = firstValue(attributes, "CATFOG");
  if (usefulValue(fog)) rows.push({ label: "Fog signal", value: decodeCodes(fog, CATFOG) });

  const status = firstValue(attributes, "STATUS");
  if (usefulValue(status)) rows.push({ label: "Status", value: decodeCodes(status, STATUS) });

  const info = firstValue(attributes, "INFORM", "NINFOM");
  if (usefulValue(info)) rows.push({ label: "Chart note", value: String(info) });

  rows.push({ label: "Position", value: formatLatLon(lat, lon) });
  return { attributes, rows };
}

function renderRaw(results: IdentifyResult[]) {
  const blocks = results.slice(0, 8).map((result) => {
    const attrs = Object.entries(result.attributes || {})
      .filter(([, value]) => usefulValue(value))
      .filter(([key]) => !/^(OBJECTID|Shape|SHAPE|RCID|LNAM_REFS|AGEN|FID)$/i.test(key))
      .slice(0, 20)
      .map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`)
      .join("");
    return `<section><strong>${escapeHtml(result.layerName || result.value || "ENC feature")}</strong>${attrs}</section>`;
  }).join("");
  return `<details class="navdash-enc-raw"><summary>ENC DETAILS</summary>${blocks}</details>`;
}

function renderBridgeCard(results: IdentifyResult[], lat: number, lon: number) {
  const { attributes, rows } = buildSummary(results, lat, lon);
  const kind = objectKind(results);
  const title = featureTitle(results, attributes);
  const rowsHtml = rows.map((row) => `
    <div class="navdash-enc-row${row.emphasis ? " is-emphasis" : ""}">
      <span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong>
    </div>
  `).join("");
  return `
    <div class="navdash-enc-kicker">${escapeHtml(kind)}</div>
    <div class="navdash-enc-name">${escapeHtml(title)}</div>
    <div class="navdash-enc-summary">${rowsHtml}</div>
    <div class="navdash-enc-source">LIVE NOAA ENC · INFORMATIVE DISPLAY, NOT A SUBSTITUTE FOR ECDIS</div>
    ${renderRaw(results)}
  `;
}

export function EncObjectInfo() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let map: any = null;
    let L: any = null;
    let control: any = null;
    let active = false;
    let pendingController: AbortController | null = null;

    const ensureStyles = () => {
      if (document.getElementById("navdash-enc-info-style")) return;
      const style = document.createElement("style");
      style.id = "navdash-enc-info-style";
      style.textContent = `
        .leaflet-pane.navdash-enc-popup-pane{z-index:2000!important;pointer-events:none}
        .leaflet-pane.navdash-enc-popup-pane .leaflet-popup{pointer-events:auto}
        .navdash-enc-control{display:block;border:1px solid rgba(105,215,235,.55);background:rgba(7,16,25,.92);color:#d9fbff;border-radius:4px;padding:7px 9px;font:800 11px/1 system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28)}
        .navdash-enc-control[data-active="true"]{border-color:#f1d56b;color:#f1d56b;background:rgba(29,25,10,.96)}
        .navdash-enc-popup .leaflet-popup-content-wrapper{background:#071019;color:#dbe8ef;border:1px solid rgba(105,215,235,.42);border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.42)}
        .navdash-enc-popup .leaflet-popup-tip{background:#071019}
        .navdash-enc-popup .leaflet-popup-content{margin:13px 15px;min-width:280px;max-width:390px}
        .navdash-enc-kicker{font:800 9px/1.2 system-ui,sans-serif;letter-spacing:.12em;color:#69d7eb;text-transform:uppercase}
        .navdash-enc-name{font:900 15px/1.25 system-ui,sans-serif;color:#fff;margin:3px 0 10px}
        .navdash-enc-summary{border-top:1px solid rgba(255,255,255,.12);border-bottom:1px solid rgba(255,255,255,.12);padding:6px 0}
        .navdash-enc-row{display:grid;grid-template-columns:minmax(105px,.78fr) minmax(140px,1.22fr);gap:8px;padding:3px 0;font:650 10.5px/1.3 system-ui,sans-serif}
        .navdash-enc-row span{color:#8ba5b3}.navdash-enc-row strong{color:#e7f0f5;text-align:right;overflow-wrap:anywhere}.navdash-enc-row.is-emphasis strong{color:#f1d56b;font-size:12px}
        .navdash-enc-source{font:700 8px/1.35 system-ui,sans-serif;letter-spacing:.06em;color:#6f8794;margin:8px 0 0}
        .navdash-enc-raw{margin-top:7px}.navdash-enc-raw summary{cursor:pointer;color:#7e9cab;font:800 9px/1.2 system-ui,sans-serif;letter-spacing:.08em}.navdash-enc-raw section{border-top:1px solid rgba(255,255,255,.09);padding:6px 0}.navdash-enc-raw section>strong{display:block;color:#69d7eb;font:800 9px/1.2 system-ui,sans-serif;margin-bottom:4px}.navdash-enc-raw section>div{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:1px 0;font:600 9px/1.25 system-ui,sans-serif}.navdash-enc-raw span{color:#748b97}.navdash-enc-raw b{color:#cfdbe1;text-align:right;overflow-wrap:anywhere}
        .navdash-enc-empty,.navdash-enc-error,.navdash-enc-loading{font:600 11px/1.35 system-ui,sans-serif;color:#a9bbc5;padding:4px 0}
        html[data-navdash-theme="day"] .navdash-enc-control{background:rgba(255,255,255,.96);color:#16323f;border-color:rgba(25,99,120,.45)}
        html[data-navdash-theme="day"] .navdash-enc-control[data-active="true"]{background:#fff8d8;color:#765e00;border-color:#b89000}
        html[data-navdash-theme="day"] .navdash-enc-popup .leaflet-popup-content-wrapper,html[data-navdash-theme="day"] .navdash-enc-popup .leaflet-popup-tip{background:#fff;color:#15222a}
        html[data-navdash-theme="day"] .navdash-enc-name,html[data-navdash-theme="day"] .navdash-enc-row strong{color:#15222a}
      `;
      document.head.appendChild(style);
    };

    const identify = async (event: any) => {
      if (!active || !map || !L) return;
      const lat = Number(event?.latlng?.lat);
      const lon = Number(event?.latlng?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      pendingController?.abort();
      pendingController = new AbortController();

      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        west: String(bounds.getWest()),
        south: String(bounds.getSouth()),
        east: String(bounds.getEast()),
        north: String(bounds.getNorth()),
        width: String(size.x),
        height: String(size.y),
        tolerance: "10",
      });

      const popup = L.popup({ className: "navdash-enc-popup", maxWidth: 420, closeButton: true, pane: "navdashEncPopupPane" })
        .setLatLng(event.latlng)
        .setContent('<div class="navdash-enc-loading">Querying NOAA ENC…</div>')
        .openOn(map);

      try {
        const response = await fetch(`/api/noaa-enc-identify?${params.toString()}`, { cache: "no-store", signal: pendingController.signal });
        const payload = (await response.json()) as IdentifyResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);

        const results = Array.isArray(payload.results) ? payload.results : [];
        if (!results.length) {
          popup.setContent('<div class="navdash-enc-empty">No encoded ENC feature found at that point. Try tapping directly on a chart symbol or label.</div>');
          return;
        }

        const unique = results.filter((result, index, all) => {
          const signature = `${result.layerId}|${result.layerName}|${result.value}|${JSON.stringify(result.attributes || {})}`;
          return all.findIndex((candidate) => `${candidate.layerId}|${candidate.layerName}|${candidate.value}|${JSON.stringify(candidate.attributes || {})}` === signature) === index;
        }).slice(0, 10);

        popup.setContent(renderBridgeCard(unique, lat, lon));
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        popup.setContent(`<div class="navdash-enc-error">${escapeHtml(error instanceof Error ? error.message : "ENC query failed.")}</div>`);
      }
    };

    const attach = async () => {
      if (cancelled) return;
      const element = document.getElementById(MAP_ELEMENT_ID) as any;
      map = element?.__navdashLeafletMap;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      L = await import("leaflet");
      if (cancelled || !map) return;
      ensureStyles();

      let popupPane = map.getPane("navdashEncPopupPane");
      if (!popupPane) popupPane = map.createPane("navdashEncPopupPane");
      popupPane.classList.add("navdash-enc-popup-pane");
      popupPane.style.zIndex = "2000";

      control = L.control({ position: "topleft" });
      control.onAdd = () => {
        const button = L.DomUtil.create("button", "navdash-enc-control") as HTMLButtonElement;
        button.type = "button";
        button.textContent = "ENC INFO";
        button.title = "Interrogate live NOAA ENC chart objects";
        button.setAttribute("data-active", "false");
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, "click", (event: Event) => {
          L.DomEvent.preventDefault(event);
          active = !active;
          button.setAttribute("data-active", String(active));
          element.style.cursor = active ? "crosshair" : "";
          if (!active) map.closePopup();
        });
        return button;
      };
      control.addTo(map);
      map.on("click", identify);
    };

    void attach();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      pendingController?.abort();
      try { if (map) map.off("click", identify); } catch {}
      try { if (control && map) map.removeControl(control); } catch {}
      const element = document.getElementById(MAP_ELEMENT_ID);
      if (element) element.style.cursor = "";
    };
  }, []);

  return null;
}
