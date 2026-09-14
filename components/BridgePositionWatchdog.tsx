"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const CHECK_MS = 5000;
const STALE_MS = 15000;
const RELOAD_COOLDOWN_MS = 120000;
const RELOAD_KEY = "navdash-bridge-position-watchdog-reload";

function ownshipMarkerTransform() {
  const icon = document.querySelector("#navmap-main-isolated-v2 .navmap-main-ownship-icon");
  const marker = icon?.closest(".leaflet-marker-icon") as HTMLElement | null;
  return marker?.style.transform || "";
}

export function BridgePositionWatchdog() {
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let checkTimer = 0;

    let lastShadowSentence = "";
    let lastShadowAdvanceAt = 0;
    let shadowAdvanceCount = 0;

    let lastMarkerTransform = "";
    let lastMarkerMoveAt = Date.now();

    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}

          const aivdo = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => /[!$]AIVDO,/.test(line));

          if (aivdo && aivdo !== lastShadowSentence) {
            lastShadowSentence = aivdo;
            lastShadowAdvanceAt = Date.now();
            shadowAdvanceCount += 1;
          }
        };
        socket.onclose = () => {
          if (!stopped) reconnectTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    const check = () => {
      if (stopped) return;

      const now = Date.now();
      const transform = ownshipMarkerTransform();
      if (transform && transform !== lastMarkerTransform) {
        lastMarkerTransform = transform;
        lastMarkerMoveAt = now;
      }

      const shadowIsLive = shadowAdvanceCount >= 2 && now - lastShadowAdvanceAt < STALE_MS;
      const markerIsStale = Boolean(transform) && now - lastMarkerMoveAt > STALE_MS;

      if (document.visibilityState === "visible" && shadowIsLive && markerIsStale) {
        let lastReload = 0;
        try { lastReload = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0); } catch {}
        if (!Number.isFinite(lastReload)) lastReload = 0;

        if (now - lastReload > RELOAD_COOLDOWN_MS) {
          try { window.sessionStorage.setItem(RELOAD_KEY, String(now)); } catch {}
          window.location.reload();
          return;
        }
      }

      checkTimer = window.setTimeout(check, CHECK_MS);
    };

    connect();
    checkTimer = window.setTimeout(check, CHECK_MS);

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(checkTimer);
      if (socket) {
        socket.onclose = null;
        try { socket.close(); } catch {}
      }
    };
  }, []);

  return null;
}
