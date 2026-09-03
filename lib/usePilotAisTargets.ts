"use client";

import { MutableRefObject, useEffect, useRef, useState } from "react";
import { getAisWebSocketUrl } from "./aisWebSocket";
import { decodePilotAisPosition, pilotVesselIconHtml, type PilotAisVessel } from "./pilotAisTargets";

const TARGET_STALE_MS = 10 * 60 * 1000;
const OVERLAY_ID = "navdash-main-ais-html-overlay";

function popupHtml(vessel: PilotAisVessel) {
  return `<div style="font-family:ui-monospace,monospace;min-width:150px"><b>MMSI ${vessel.mmsi}</b><br/>COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"}<br/>SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}<br/>HDG ${vessel.heading === null ? "---" : vessel.heading.toFixed(0) + "°"}</div>`;
}

export function usePilotAisTargets(mapRef: MutableRefObject<any>) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const targetElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const popupRef = useRef<HTMLDivElement | null>(null);
  const targetsRef = useRef<Map<number, PilotAisVessel>>(new Map());
  const [targets, setTargets] = useState<Map<number, PilotAisVessel>>(new Map());
  const [mapReadyTick, setMapReadyTick] = useState(0);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    let closed = false;
    let timer = 0;
    let attachedMap: any = null;
    let redrawFrame = 0;

    const redraw = () => {
      if (redrawFrame) window.cancelAnimationFrame(redrawFrame);
      redrawFrame = window.requestAnimationFrame(() => {
        const map = mapRef.current;
        const overlay = overlayRef.current;
        if (!map || !overlay) return;

        const size = map.getSize();
        const live = new Set<number>();

        for (const [mmsi, vessel] of targetsRef.current) {
          live.add(mmsi);
          const point = map.latLngToContainerPoint([vessel.lat, vessel.lon]);
          let element = targetElementsRef.current.get(mmsi);

          if (!element) {
            element = document.createElement("div");
            element.dataset.mmsi = String(mmsi);
            element.style.cssText = [
              "position:absolute",
              "width:22px",
              "height:22px",
              "transform:translate(-50%,-50%)",
              "transform-origin:center center",
              "pointer-events:auto",
              "cursor:pointer",
              "z-index:2",
            ].join(";");
            element.addEventListener("click", (event) => {
              event.stopPropagation();
              const current = targetsRef.current.get(mmsi);
              const currentOverlay = overlayRef.current;
              if (!current || !currentOverlay) return;

              let popup = popupRef.current;
              if (!popup) {
                popup = document.createElement("div");
                popup.style.cssText = [
                  "position:absolute",
                  "z-index:20",
                  "pointer-events:auto",
                  "padding:10px 12px",
                  "border:1px solid rgba(56,189,248,.8)",
                  "border-radius:8px",
                  "background:rgba(7,16,25,.96)",
                  "color:#e5f4ff",
                  "box-shadow:0 8px 24px rgba(0,0,0,.45)",
                ].join(";");
                popup.addEventListener("click", (popupEvent) => popupEvent.stopPropagation());
                currentOverlay.appendChild(popup);
                popupRef.current = popup;
              }

              popup.innerHTML = popupHtml(current);
              const targetPoint = map.latLngToContainerPoint([current.lat, current.lon]);
              const left = Math.max(8, Math.min(size.x - 190, targetPoint.x + 16));
              const top = Math.max(8, Math.min(size.y - 115, targetPoint.y + 16));
              popup.style.left = `${left}px`;
              popup.style.top = `${top}px`;
              popup.style.display = "block";
            });
            overlay.appendChild(element);
            targetElementsRef.current.set(mmsi, element);
          }

          element.innerHTML = pilotVesselIconHtml(vessel);
          element.title = `MMSI ${mmsi} · COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"} · SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}`;
          element.style.left = `${point.x}px`;
          element.style.top = `${point.y}px`;
          element.style.display = point.x >= -30 && point.y >= -30 && point.x <= size.x + 30 && point.y <= size.y + 30 ? "block" : "none";
        }

        for (const [mmsi, element] of targetElementsRef.current) {
          if (!live.has(mmsi)) {
            element.remove();
            targetElementsRef.current.delete(mmsi);
          }
        }
      });
    };

    const closePopup = () => {
      if (popupRef.current) popupRef.current.style.display = "none";
    };

    const attach = () => {
      if (closed) return;
      const map = mapRef.current;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      const container = map.getContainer() as HTMLElement;
      container.style.position = container.style.position || "relative";

      let overlay = container.querySelector(`#${OVERLAY_ID}`) as HTMLDivElement | null;
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = [
          "position:absolute",
          "inset:0",
          "z-index:900",
          "pointer-events:none",
          "overflow:hidden",
        ].join(";");
        container.appendChild(overlay);
      }

      overlayRef.current = overlay;
      attachedMap = map;
      map.on("move zoom moveend zoomend resize viewreset zoomanim", redraw);
      map.on("click", closePopup);
      window.addEventListener("resize", redraw);
      setMapReadyTick((value) => value + 1);
      redraw();
    };

    attach();

    return () => {
      closed = true;
      window.clearTimeout(timer);
      if (redrawFrame) window.cancelAnimationFrame(redrawFrame);
      window.removeEventListener("resize", redraw);
      if (attachedMap) {
        attachedMap.off("move zoom moveend zoomend resize viewreset zoomanim", redraw);
        attachedMap.off("click", closePopup);
      }
      popupRef.current = null;
      targetElementsRef.current.clear();
      overlayRef.current?.remove();
      overlayRef.current = null;
    };
  }, [mapRef]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}

          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            if (!line.startsWith("!AIVDM")) continue;
            const decoded = decodePilotAisPosition(line);
            if (!decoded) continue;
            setTargets((current) => {
              const next = new Map(current);
              next.set(decoded.mmsi, decoded);
              return next;
            });
          }
        };
        socket.onclose = () => {
          if (!closed) retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        retryTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - TARGET_STALE_MS;
      setTargets((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [mmsi, vessel] of next) {
          if (vessel.updatedAt < cutoff) {
            next.delete(mmsi);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;

    const size = map.getSize();
    const live = new Set<number>();

    for (const [mmsi, vessel] of targets) {
      live.add(mmsi);
      const point = map.latLngToContainerPoint([vessel.lat, vessel.lon]);
      let element = targetElementsRef.current.get(mmsi);

      if (!element) {
        element = document.createElement("div");
        element.dataset.mmsi = String(mmsi);
        element.style.cssText = "position:absolute;width:22px;height:22px;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;z-index:2";
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = targetsRef.current.get(mmsi);
          const currentOverlay = overlayRef.current;
          if (!current || !currentOverlay) return;

          let popup = popupRef.current;
          if (!popup) {
            popup = document.createElement("div");
            popup.style.cssText = "position:absolute;z-index:20;pointer-events:auto;padding:10px 12px;border:1px solid rgba(56,189,248,.8);border-radius:8px;background:rgba(7,16,25,.96);color:#e5f4ff;box-shadow:0 8px 24px rgba(0,0,0,.45)";
            currentOverlay.appendChild(popup);
            popupRef.current = popup;
          }
          popup.innerHTML = popupHtml(current);
          const targetPoint = map.latLngToContainerPoint([current.lat, current.lon]);
          popup.style.left = `${Math.max(8, Math.min(size.x - 190, targetPoint.x + 16))}px`;
          popup.style.top = `${Math.max(8, Math.min(size.y - 115, targetPoint.y + 16))}px`;
          popup.style.display = "block";
        });
        overlay.appendChild(element);
        targetElementsRef.current.set(mmsi, element);
      }

      element.innerHTML = pilotVesselIconHtml(vessel);
      element.title = `MMSI ${mmsi}`;
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
      element.style.display = point.x >= -30 && point.y >= -30 && point.x <= size.x + 30 && point.y <= size.y + 30 ? "block" : "none";
    }

    for (const [mmsi, element] of targetElementsRef.current) {
      if (!live.has(mmsi)) {
        element.remove();
        targetElementsRef.current.delete(mmsi);
      }
    }
  }, [targets, mapReadyTick, mapRef]);

  return targets.size;
}
