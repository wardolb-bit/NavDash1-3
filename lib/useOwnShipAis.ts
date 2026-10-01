"use client";

import { useEffect, useState } from "react";
import { getAisWebSocketUrl } from "./aisWebSocket";

export type LiveOwnShipPosition = {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number | null;
  receivedAtMs: number;
};

const AIS_STALE_MS = 30000;

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

function decodeOwnShip(line: string): Omit<LiveOwnShipPosition, "receivedAtMs"> | null {
  try {
    if (!line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;

    const sog = unsigned(bits, 50, 10) / 10;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cog = unsigned(bits, 116, 12) / 10;
    const headingRaw = unsigned(bits, 128, 9);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      lat,
      lon,
      sog: Number.isFinite(sog) ? sog : 0,
      cog: Number.isFinite(cog) ? cog : 0,
      heading: headingRaw === 511 ? null : headingRaw,
    };
  } catch {
    return null;
  }
}

function messageText(data: unknown) {
  let raw = String(data ?? "");
  try {
    const parsed = JSON.parse(raw);
    raw = typeof parsed === "string"
      ? parsed
      : parsed?.sentence || parsed?.nmea || parsed?.raw || parsed?.line || raw;
  } catch {}
  return raw;
}

export function useOwnShipAis() {
  const [ownShip, setOwnShip] = useState<LiveOwnShipPosition | null>(null);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let staleTimer = 0;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          for (const line of messageText(event.data).split(/\r?\n/)) {
            const decoded = decodeOwnShip(line.trim());
            if (decoded) setOwnShip({ ...decoded, receivedAtMs: Date.now() });
          }
        };
        socket.onclose = () => {
          setOwnShip(null);
          if (!closed) retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        setOwnShip(null);
        retryTimer = window.setTimeout(connect, 2000);
      }
    };

    staleTimer = window.setInterval(() => {
      setOwnShip((current) => (
        current && Date.now() - current.receivedAtMs > AIS_STALE_MS ? null : current
      ));
    }, 5000);

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(staleTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return ownShip;
}
