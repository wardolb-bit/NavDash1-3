"use client";

import { MutableRefObject, useEffect, useRef, useState } from "react";
import { getAisWebSocketUrl } from "./aisWebSocket";
import { decodePilotAisPosition, pilotVesselIconHtml, type PilotAisVessel } from "./pilotAisTargets";

const TARGET_STALE_MS = 10 * 60 * 1000;

export function usePilotAisTargets(mapRef: MutableRefObject<any>) {
  const targetLayerRef = useRef<any>(null);
  const targetMarkersRef = useRef<Map<number, any>>(new Map());
  const [targets, setTargets] = useState<Map<number, PilotAisVessel>>(new Map());
  const [mapReadyTick, setMapReadyTick] = useState(0);

  useEffect(() => {
    let closed = false;
    let timer = 0;

    const attach = async () => {
      if (closed) return;
      const map = mapRef.current;
      if (!map) {
        timer = window.setTimeout(attach, 100);
        return;
      }

      const L = await import("leaflet");
      if (!map.getPane("pilot-targets")) {
        const targetPane = map.createPane("pilot-targets");
        targetPane.style.zIndex = "710";
      }

      if (!targetLayerRef.current) {
        targetLayerRef.current = L.layerGroup([], { pane: "pilot-targets" } as any).addTo(map);
      } else if (!map.hasLayer(targetLayerRef.current)) {
        targetLayerRef.current.addTo(map);
      }

      setMapReadyTick((value) => value + 1);
    };

    attach();

    return () => {
      closed = true;
      window.clearTimeout(timer);
      const map = mapRef.current;
      if (map && targetLayerRef.current) {
        try {
          map.removeLayer(targetLayerRef.current);
        } catch {}
      }
      targetLayerRef.current = null;
      targetMarkersRef.current.clear();
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
    async function drawTargets() {
      const map = mapRef.current;
      const layer = targetLayerRef.current;
      if (!map || !layer) return;
      const L = await import("leaflet");
      const live = new Set<number>();

      for (const [mmsi, vessel] of targets) {
        live.add(mmsi);
        const pos: [number, number] = [vessel.lat, vessel.lon];
        const icon = L.divIcon({
          className: "pilot-target-icon",
          html: pilotVesselIconHtml(vessel),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const popup = `<div style="font-family:ui-monospace,monospace;min-width:150px"><b>MMSI ${mmsi}</b><br/>COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"}<br/>SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}<br/>HDG ${vessel.heading === null ? "---" : vessel.heading.toFixed(0) + "°"}</div>`;
        const existing = targetMarkersRef.current.get(mmsi);
        if (existing) {
          existing.setLatLng(pos);
          existing.setIcon(icon);
          existing.setPopupContent(popup);
        } else {
          const marker = L.marker(pos, { icon, pane: "pilot-targets" }).bindPopup(popup).addTo(layer);
          targetMarkersRef.current.set(mmsi, marker);
        }
      }

      for (const [mmsi, marker] of targetMarkersRef.current) {
        if (!live.has(mmsi)) {
          layer.removeLayer(marker);
          targetMarkersRef.current.delete(mmsi);
        }
      }
    }

    drawTargets();
  }, [targets, mapReadyTick, mapRef]);

  return targets.size;
}
