"use client";

import { useEffect, useRef } from "react";

const TARGET_VECTOR_MINUTES = 6;
const VECTOR_PANE = "navmap-main-ais-vector-v1";

function destinationPoint(lat: number, lon: number, bearing: number, distanceNm: number) {
  const radiusNm = 3440.065;
  const distanceRad = distanceNm / radiusNm;
  const bearingRad = bearing * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceRad) + Math.cos(lat1) * Math.sin(distanceRad) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(distanceRad) * Math.cos(lat1),
    Math.cos(distanceRad) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    lat: lat2 * 180 / Math.PI,
    lon: ((((lon2 * 180 / Math.PI) + 540) % 360) - 180),
  };
}

function controlButton(prefix: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("#bc-chart-tools button"))
    .find((button) => (button.textContent || "").trim().toUpperCase().startsWith(prefix));
}

function tooltipText(layer: any) {
  try {
    const content = layer?.getTooltip?.()?.getContent?.();
    if (typeof content === "string") {
      const container = document.createElement("div");
      container.innerHTML = content;
      return container.textContent || "";
    }
    if (content instanceof HTMLElement) return content.textContent || "";
  } catch {}
  return "";
}

function targetMotion(layer: any) {
  const text = tooltipText(layer);
  const sogMatch = text.match(/SOG\s+([0-9]+(?:\.[0-9]+)?)\s*kt/i);
  const cogMatch = text.match(/COG\s+([0-9]+(?:\.[0-9]+)?)\s*°/i);
  const sog = sogMatch ? Number(sogMatch[1]) : NaN;
  const cog = cogMatch ? Number(cogMatch[1]) : NaN;
  if (!Number.isFinite(sog) || !Number.isFinite(cog) || sog <= 0.2) return null;
  return { sog, cog };
}

export function MainMapDisplayControls() {
  const selectedTargetRef = useRef<any>(null);
  const vectorLayerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    let bindTimer = 0;

    const mapElement = () => document.getElementById("navmap-main-isolated-v2") as any;

    const readStates = () => {
      const vectorButton = controlButton("VECTOR");
      const aisButton = controlButton("AIS");
      const vectorOn = !vectorButton || /\bON\b/i.test(vectorButton.textContent || "");
      const aisOn = !aisButton || /\bON\b/i.test(aisButton.textContent || "");
      return { vectorOn, aisOn };
    };

    const applyVisibility = () => {
      const element = mapElement();
      if (!element) return;
      const { vectorOn, aisOn } = readStates();
      element.classList.toggle("navdash-vector-off", !vectorOn);
      element.classList.toggle("navdash-ais-off", !aisOn);
    };

    const ensureVectorLayer = async (map: any) => {
      if (vectorLayerRef.current && mapRef.current === map) return vectorLayerRef.current;
      const L = await import("leaflet");
      if (disposed) return null;
      if (vectorLayerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(vectorLayerRef.current); } catch {}
      }
      if (!map.getPane(VECTOR_PANE)) {
        const pane = map.createPane(VECTOR_PANE);
        pane.style.zIndex = "716";
      }
      mapRef.current = map;
      vectorLayerRef.current = L.layerGroup([], { pane: VECTOR_PANE } as any).addTo(map);
      return vectorLayerRef.current;
    };

    const redrawTargetVector = async () => {
      const element = mapElement();
      const map = element?.__navdashLeafletMap;
      if (!map || disposed) return;
      const layer = await ensureVectorLayer(map);
      if (!layer || disposed) return;
      layer.clearLayers();

      const { vectorOn, aisOn } = readStates();
      if (!vectorOn || !aisOn || !selectedTargetRef.current) return;

      const marker = selectedTargetRef.current;
      const motion = targetMotion(marker);
      const position = marker?.getLatLng?.();
      if (!motion || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;

      const distanceNm = motion.sog * (TARGET_VECTOR_MINUTES / 60);
      const end = destinationPoint(position.lat, position.lng, motion.cog, distanceNm);
      const L = await import("leaflet");
      if (disposed) return;
      L.polyline(
        [[position.lat, position.lng], [end.lat, end.lon]],
        { pane: VECTOR_PANE, color: "#38bdf8", weight: 2.5, opacity: 0.95, dashArray: "8 6", interactive: false },
      ).addTo(layer);
    };

    const bindTargets = async () => {
      if (disposed) return;
      const element = mapElement();
      const map = element?.__navdashLeafletMap;
      if (map) {
        await ensureVectorLayer(map);
        map.eachLayer((layer: any) => {
          const markerElement = layer?.getElement?.() as HTMLElement | null;
          const isAisTarget = Boolean(
            markerElement && (
              markerElement.matches?.(".navmap-main-ais-target-icon") ||
              markerElement.querySelector?.(".navmap-main-ais-target-icon")
            )
          );
          if (!isAisTarget) return;
          if ((layer as any).__navdashVectorClickBound) return;
          (layer as any).__navdashVectorClickBound = true;
          layer.on("click", () => {
            if (selectedTargetRef.current === layer) selectedTargetRef.current = null;
            else selectedTargetRef.current = layer;
            void redrawTargetVector();
          });
        });
        applyVisibility();
        await redrawTargetVector();
      }
      bindTimer = window.setTimeout(bindTargets, 700);
    };

    const onToolbarClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target || !target.closest("#bc-chart-tools")) return;
      const text = (target.textContent || "").trim().toUpperCase();
      if (!text.startsWith("VECTOR") && !text.startsWith("AIS")) return;
      window.setTimeout(() => {
        applyVisibility();
        void redrawTargetVector();
      }, 0);
    };

    document.addEventListener("click", onToolbarClick);
    void bindTargets();

    return () => {
      disposed = true;
      window.clearTimeout(bindTimer);
      document.removeEventListener("click", onToolbarClick);
      if (vectorLayerRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(vectorLayerRef.current); } catch {}
      }
      vectorLayerRef.current = null;
      mapRef.current = null;
      selectedTargetRef.current = null;
      const element = mapElement();
      element?.classList.remove("navdash-vector-off", "navdash-ais-off");
    };
  }, []);

  return (
    <style jsx global>{`
      #navmap-main-isolated-v2.navdash-vector-off .leaflet-navmap-main-ownship-v2-pane .leaflet-interactive,
      #navmap-main-isolated-v2.navdash-vector-off .leaflet-${VECTOR_PANE}-pane {
        display: none !important;
      }
      #navmap-main-isolated-v2.navdash-ais-off .leaflet-navmap-main-ais-targets-v1-pane,
      #navmap-main-isolated-v2.navdash-ais-off .leaflet-${VECTOR_PANE}-pane {
        display: none !important;
      }
    `}</style>
  );
}
