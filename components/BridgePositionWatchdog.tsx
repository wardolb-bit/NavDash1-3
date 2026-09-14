"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const CHECK_MS = 3000;
const LIVE_MAX_AGE_MS = 12000;
const MISMATCH_HOLD_MS = 9000;
const MISMATCH_NM = 0.01;
const RELOAD_COOLDOWN_MS = 30000;
const RELOAD_KEY = "navdash-bridge-position-watchdog-reload-v2";

type Position = { lat: number; lon: number };

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload.split("").map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}

function decodeOwnShip(line: string): Position | null {
  try {
    if (!line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

function displayedOwnshipPosition(): Position | null {
  const element = document.getElementById("navmap-main-isolated-v2") as any;
  const map = element?.__navdashLeafletMap;
  if (!map) return null;

  let found: Position | null = null;
  try {
    map.eachLayer((layer: any) => {
      if (found) return;
      const markerElement = layer?.getElement?.() as HTMLElement | null;
      const isOwnship = Boolean(
        markerElement && (
          markerElement.matches?.(".navmap-main-ownship-icon") ||
          markerElement.querySelector?.(".navmap-main-ownship-icon")
        )
      );
      if (!isOwnship) return;
      const latlng = layer?.getLatLng?.();
      if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
      found = { lat: Number(latlng.lat), lon: Number(latlng.lng) };
    });
  } catch {}
  return found;
}

function distanceNm(a: Position, b: Position) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function BridgePositionWatchdog() {
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let checkTimer = 0;
    let shadowPosition: Position | null = null;
    let shadowUpdatedAt = 0;
    let mismatchSince = 0;

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

          for (const line of raw.split(/\r?\n/)) {
            const decoded = decodeOwnShip(line.trim());
            if (!decoded) continue;
            shadowPosition = decoded;
            shadowUpdatedAt = Date.now();
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
      const displayed = displayedOwnshipPosition();
      const shadowIsFresh = Boolean(shadowPosition) && now - shadowUpdatedAt <= LIVE_MAX_AGE_MS;

      if (document.visibilityState === "visible" && shadowIsFresh && shadowPosition && displayed) {
        const mismatch = distanceNm(shadowPosition, displayed);
        if (mismatch >= MISMATCH_NM) {
          if (!mismatchSince) mismatchSince = now;
        } else {
          mismatchSince = 0;
        }

        if (mismatchSince && now - mismatchSince >= MISMATCH_HOLD_MS) {
          let lastReload = 0;
          try { lastReload = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0); } catch {}
          if (!Number.isFinite(lastReload)) lastReload = 0;

          if (now - lastReload > RELOAD_COOLDOWN_MS) {
            try { window.sessionStorage.setItem(RELOAD_KEY, String(now)); } catch {}
            window.location.reload();
            return;
          }
        }
      } else {
        mismatchSince = 0;
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
