"use client";

import { useEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import type { AmiRouteForecast } from "../lib/amiRouteForecast";

const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const CLOUD_STATE_URL = "/api/ami-route-forecast/state";
const CLOUD_FALLBACK_DELAY_MS = 1200;
const CLOUD_REFRESH_MS = 60_000;

type CloudStateResponse = {
  ok: boolean;
  initialized?: boolean;
  forecast?: AmiRouteForecast | null;
};

type WheelhouseAmiState = {
  type: "ami-state";
  initialized?: boolean;
  forecast?: AmiRouteForecast | null;
  savedAt?: string;
};

function validForecast(value: unknown): value is AmiRouteForecast {
  const forecast = value as AmiRouteForecast | null;
  return Boolean(forecast && forecast.version === 1 && Array.isArray(forecast.forecastPoints));
}

export function SharedAmiForecastSync() {
  const applyingRef = useRef(false);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let fallbackTimer = 0;
    let refreshTimer = 0;
    let wheelhouseConnected = false;
    let wheelhouseAnswered = false;

    const applyForecast = (forecast: AmiRouteForecast | null) => {
      if (closed) return;
      applyingRef.current = true;
      try {
        if (forecast) window.localStorage.setItem(AMI_OVERLAY_STORAGE_KEY, JSON.stringify(forecast));
        else window.localStorage.removeItem(AMI_OVERLAY_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent("navdash-ami-overlay-updated", { detail: forecast }));
      } finally {
        applyingRef.current = false;
      }
    };

    const mirrorCloud = (forecast: AmiRouteForecast | null) => {
      fetch(CLOUD_STATE_URL, {
        method: forecast ? "PUT" : "DELETE",
        headers: forecast ? { "Content-Type": "application/json" } : undefined,
        body: forecast ? JSON.stringify({ forecast }) : undefined,
        cache: "no-store",
      }).catch(() => {});
    };

    const sendWheelhouse = (forecast: AmiRouteForecast | null) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      try {
        socket.send(JSON.stringify({
          type: "ami-state",
          initialized: true,
          forecast,
          savedAt: new Date().toISOString(),
        }));
        return true;
      } catch {
        return false;
      }
    };

    const loadCloudFallback = async () => {
      if (closed || (wheelhouseConnected && wheelhouseAnswered)) return;
      try {
        const response = await fetch(CLOUD_STATE_URL, { cache: "no-store" });
        const data = (await response.json()) as CloudStateResponse;
        if (!response.ok || !data.ok || !data.initialized || closed) return;
        const forecast = validForecast(data.forecast) ? data.forecast : null;
        applyForecast(forecast);
        sendWheelhouse(forecast);
      } catch {}
    };

    const scheduleFallback = () => {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(loadCloudFallback, CLOUD_FALLBACK_DELAY_MS);
    };

    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(getAisWebSocketUrl());
        socket = ws;
        ws.onopen = () => {
          wheelhouseConnected = true;
          wheelhouseAnswered = false;
          try { ws.send(JSON.stringify({ type: "ami-state-request" })); } catch {}
          scheduleFallback();
        };
        ws.onmessage = (event) => {
          let message: unknown = event.data;
          try { message = JSON.parse(event.data); } catch { return; }
          const state = message as WheelhouseAmiState;
          if (state?.type !== "ami-state") return;

          wheelhouseAnswered = true;
          window.clearTimeout(fallbackTimer);

          if (!state.initialized) {
            void loadCloudFallback();
            return;
          }

          applyForecast(validForecast(state.forecast) ? state.forecast : null);
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          if (socket === ws) socket = null;
          wheelhouseConnected = false;
          wheelhouseAnswered = false;
          scheduleFallback();
          if (!closed) reconnectTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        wheelhouseConnected = false;
        scheduleFallback();
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    const onLocalChange = (event: Event) => {
      if (applyingRef.current) return;
      const custom = event as CustomEvent<AmiRouteForecast | null>;
      const forecast = validForecast(custom.detail) ? custom.detail : null;
      sendWheelhouse(forecast);
      mirrorCloud(forecast);
    };

    const refreshCloudIfNeeded = () => {
      if (!wheelhouseConnected) void loadCloudFallback();
    };

    connect();
    scheduleFallback();
    window.addEventListener("navdash-ami-overlay-updated", onLocalChange);
    window.addEventListener("focus", refreshCloudIfNeeded);
    refreshTimer = window.setInterval(refreshCloudIfNeeded, CLOUD_REFRESH_MS);

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(fallbackTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener("navdash-ami-overlay-updated", onLocalChange);
      window.removeEventListener("focus", refreshCloudIfNeeded);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return null;
}
