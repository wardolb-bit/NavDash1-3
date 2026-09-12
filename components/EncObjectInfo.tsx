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

const PRIORITY_FIELDS = [
  "OBJNAM",
  "NOBJNM",
  "LITCHR",
  "CATLIT",
  "COLOUR",
  "SIGGRP",
  "SIGPER",
  "HEIGHT",
  "VALNMR",
  "STATUS",
  "INFORM",
  "NINFOM",
  "CATFOG",
  "CATLAM",
  "CATCAM",
  "BOYSHP",
  "BCNSHP",
  "TOPSHP",
  "VERDAT",
  "SCAMIN",
];

const FIELD_LABELS: Record<string, string> = {
  OBJNAM: "Name",
  NOBJNM: "National name",
  LITCHR: "Light characteristic",
  CATLIT: "Light category",
  COLOUR: "Colour",
  SIGGRP: "Signal group",
  SIGPER: "Period",
  HEIGHT: "Height",
  VALNMR: "Nominal range",
  STATUS: "Status",
  INFORM: "Information",
  NINFOM: "National information",
  CATFOG: "Fog signal",
  CATLAM: "Landmark category",
  CATCAM: "Cardinal mark category",
  BOYSHP: "Buoy shape",
  BCNSHP: "Beacon shape",
  TOPSHP: "Topmark shape",
  VERDAT: "Vertical datum",
  SCAMIN: "Minimum display scale",
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

function featureName(result: IdentifyResult) {
  const attributes = result.attributes || {};
  for (const key of ["OBJNAM", "NOBJNM", "LNAM", "RCID"]) {
    if (usefulValue(attributes[key])) return String(attributes[key]);
  }
  if (usefulValue(result.value)) return String(result.value);
  return result.layerName || "ENC feature";
}

function renderFeature(result: IdentifyResult, index: number) {
  const attributes = result.attributes || {};
  const used = new Set<string>();
  const rows: string[] = [];

  for (const key of PRIORITY_FIELDS) {
    const value = attributes[key];
    if (!usefulValue(value)) continue;
    used.add(key);
    const suffix = key === "SIGPER" ? " s" : key === "HEIGHT" ? " m" : key === "VALNMR" ? " NM" : "";
    rows.push(`<div class="navdash-enc-row"><span>${escapeHtml(FIELD_LABELS[key] || key)}</span><strong>${escapeHtml(value)}${suffix}</strong></div>`);
  }

  if (rows.length < 8) {
    for (const [key, value] of Object.entries(attributes)) {
      if (rows.length >= 8 || used.has(key) || !usefulValue(value)) continue;
      if (/^(OBJECTID|Shape|SHAPE|RCID|LNAM_REFS|AGEN|FID)$/i.test(key)) continue;
      rows.push(`<div class="navdash-enc-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`);
    }
  }

  return `
    <section class="navdash-enc-feature">
      <div class="navdash-enc-feature-head">
        <span>${escapeHtml(result.layerName || `ENC feature ${index + 1}`)}</span>
        <strong>${escapeHtml(featureName(result))}</strong>
      </div>
      ${rows.length ? rows.join("") : '<div class="navdash-enc-empty">No additional encoded attributes returned.</div>'}
    </section>
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
        .navdash-enc-control{display:block;border:1px solid rgba(105,215,235,.55);background:rgba(7,16,25,.92);color:#d9fbff;border-radius:4px;padding:7px 9px;font:800 11px/1 system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28)}
        .navdash-enc-control[data-active="true"]{border-color:#f1d56b;color:#f1d56b;background:rgba(29,25,10,.96)}
        .navdash-enc-popup .leaflet-popup-content-wrapper{background:#071019;color:#dbe8ef;border:1px solid rgba(105,215,235,.42);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.42)}
        .navdash-enc-popup .leaflet-popup-tip{background:#071019}
        .navdash-enc-popup .leaflet-popup-content{margin:12px 14px;min-width:250px;max-width:360px}
        .navdash-enc-title{font:900 12px/1.2 system-ui,sans-serif;letter-spacing:.08em;color:#f1d56b;margin-bottom:8px}
        .navdash-enc-source{font:600 10px/1.3 system-ui,sans-serif;color:#8ba5b3;margin:0 0 9px}
        .navdash-enc-feature{border-top:1px solid rgba(255,255,255,.12);padding:8px 0 4px}
        .navdash-enc-feature:first-of-type{border-top:0}
        .navdash-enc-feature-head span{display:block;font:700 9px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:#69d7eb}
        .navdash-enc-feature-head strong{display:block;font:800 12px/1.3 system-ui,sans-serif;color:#fff;margin:2px 0 6px}
        .navdash-enc-row{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(120px,1.2fr);gap:8px;padding:2px 0;font:600 10px/1.25 system-ui,sans-serif}
        .navdash-enc-row span{color:#8ba5b3}.navdash-enc-row strong{color:#e7f0f5;text-align:right;overflow-wrap:anywhere}
        .navdash-enc-empty,.navdash-enc-error,.navdash-enc-loading{font:600 11px/1.35 system-ui,sans-serif;color:#a9bbc5;padding:4px 0}
        html[data-navdash-theme="day"] .navdash-enc-control{background:rgba(255,255,255,.96);color:#16323f;border-color:rgba(25,99,120,.45)}
        html[data-navdash-theme="day"] .navdash-enc-control[data-active="true"]{background:#fff8d8;color:#765e00;border-color:#b89000}
        html[data-navdash-theme="day"] .navdash-enc-popup .leaflet-popup-content-wrapper,html[data-navdash-theme="day"] .navdash-enc-popup .leaflet-popup-tip{background:#fff;color:#15222a}
        html[data-navdash-theme="day"] .navdash-enc-feature-head strong,html[data-navdash-theme="day"] .navdash-enc-row strong{color:#15222a}
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

      const popup = L.popup({ className: "navdash-enc-popup", maxWidth: 390, closeButton: true })
        .setLatLng(event.latlng)
        .setContent('<div class="navdash-enc-title">NOAA ENC OBJECT INFO</div><div class="navdash-enc-loading">Querying chart features…</div>')
        .openOn(map);

      try {
        const response = await fetch(`/api/noaa-enc-identify?${params.toString()}`, { cache: "no-store", signal: pendingController.signal });
        const payload = (await response.json()) as IdentifyResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);

        const results = Array.isArray(payload.results) ? payload.results : [];
        if (!results.length) {
          popup.setContent('<div class="navdash-enc-title">NOAA ENC OBJECT INFO</div><div class="navdash-enc-empty">No encoded ENC feature found at that point. Try tapping directly on a chart symbol or label.</div>');
          return;
        }

        const unique = results.filter((result, index, all) => {
          const signature = `${result.layerId}|${featureName(result)}|${JSON.stringify(result.attributes || {})}`;
          return all.findIndex((candidate) => `${candidate.layerId}|${featureName(candidate)}|${JSON.stringify(candidate.attributes || {})}` === signature) === index;
        }).slice(0, 6);

        popup.setContent(`
          <div class="navdash-enc-title">NOAA ENC OBJECT INFO</div>
          <div class="navdash-enc-source">Live NOAA Office of Coast Survey ENC Online · informational chart interrogation</div>
          ${unique.map(renderFeature).join("")}
        `);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        popup.setContent(`<div class="navdash-enc-title">NOAA ENC OBJECT INFO</div><div class="navdash-enc-error">${escapeHtml(error instanceof Error ? error.message : "ENC query failed.")}</div>`);
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
