"use client";

import { useEffect, useRef } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import type { AmiRouteForecast } from "../lib/amiRouteForecast";

const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const SHARED_STATE_URL = "/api/ami-route-forecast/state";
const REFRESH_MS = 60_000;
const LOCAL_REQUEST_TIMEOUT_MS = 900;

type SharedStateResponse = {
  ok: boolean;
  initialized?: boolean;
  forecast?: AmiRouteForecast | null;
  updatedAt?: string | null;
  error?: string;
};

type LocalStateReply = {
  type: "shared-state-result";
  requestId: string;
  key: string;
  found: boolean;
  value?: unknown;
  updatedAt?: string | null;
  expiresAt?: string | null;
};

type CacheSpec = {
  key: string;
  ttlMs: number | null;
  persistent: boolean;
};

function validForecast(value: unknown): value is AmiRouteForecast {
  const forecast = value as AmiRouteForecast | null;
  return Boolean(forecast && forecast.version === 1 && Array.isArray(forecast.forecastPoints));
}

function readLocalForecast(): AmiRouteForecast | null {
  try {
    const raw = window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validForecast(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalizeUrl(url: URL) {
  const copy = new URL(url.toString());
  if (copy.searchParams.has("lat")) {
    const lat = Number(copy.searchParams.get("lat"));
    if (Number.isFinite(lat)) copy.searchParams.set("lat", lat.toFixed(2));
  }
  if (copy.searchParams.has("lon")) {
    const lon = Number(copy.searchParams.get("lon"));
    if (Number.isFinite(lon)) copy.searchParams.set("lon", lon.toFixed(2));
  }
  const sorted = new URLSearchParams();
  Array.from(copy.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => sorted.append(k, v));
  return `${copy.pathname}${sorted.size ? `?${sorted.toString()}` : ""}`;
}

function cacheSpecFor(input: RequestInfo | URL): CacheSpec | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;

    if (url.pathname === "/api/route-state") return { key: "route-state", ttlMs: null, persistent: true };
    if (url.pathname === "/api/ami-route-forecast/state") return { key: "ami-route-forecast", ttlMs: null, persistent: true };
    if (url.pathname === "/api/wx") return { key: `cache:${canonicalizeUrl(url)}`, ttlMs: 10 * 60_000, persistent: false };
    if (url.pathname === "/api/tides") return { key: `cache:${canonicalizeUrl(url)}`, ttlMs: 15 * 60_000, persistent: false };
    if (url.pathname === "/api/nav-brief-tides") return { key: `cache:${canonicalizeUrl(url)}`, ttlMs: 15 * 60_000, persistent: false };
    if (url.pathname === "/api/msi/nga") return { key: `cache:${canonicalizeUrl(url)}`, ttlMs: 10 * 60_000, persistent: false };
    return null;
  } catch {
    return null;
  }
}

function responseFromValue(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-NavDash-Source": "wheelhouse" },
  });
}

function makeRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SharedAmiForecastSync() {
  const applyingRemoteRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(new Map<string, (reply: LocalStateReply | null) => void>());
  const reconnectTimerRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;
    const originalFetch = window.fetch.bind(window);

    const finishPending = (requestId: string, reply: LocalStateReply | null) => {
      const resolve = pendingRef.current.get(requestId);
      if (!resolve) return;
      pendingRef.current.delete(requestId);
      resolve(reply);
    };

    const connect = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket(getAisWebSocketUrl());
        socketRef.current = ws;
        ws.onmessage = (event) => {
          let message: any = event.data;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message?.type === "shared-state-result" && typeof message.requestId === "string") {
            finishPending(message.requestId, message as LocalStateReply);
          }
        };
        ws.onclose = () => {
          if (socketRef.current === ws) socketRef.current = null;
          if (!cancelled) reconnectTimerRef.current = window.setTimeout(connect, 1500);
        };
        ws.onerror = () => {};
      } catch {
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      }
    };

    const requestWheelhouse = (key: string) => new Promise<LocalStateReply | null>((resolve) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) { resolve(null); return; }
      const requestId = makeRequestId();
      let settled = false;
      const done = (reply: LocalStateReply | null) => {
        if (settled) return;
        settled = true;
        pendingRef.current.delete(requestId);
        resolve(reply);
      };
      pendingRef.current.set(requestId, done);
      try { ws.send(JSON.stringify({ type: "shared-state-get", key, requestId })); }
      catch { done(null); return; }
      window.setTimeout(() => done(null), LOCAL_REQUEST_TIMEOUT_MS);
    });

    const writeWheelhouse = (key: string, value: unknown, ttlMs: number | null) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(JSON.stringify({ type: "shared-state-put", key, value, ttlMs, updatedAt: new Date().toISOString() }));
        return true;
      } catch {
        return false;
      }
    };

    const wrapPersistentMutation = async (spec: CacheSpec, method: string, input: RequestInfo | URL, init?: RequestInit) => {
      let bodyValue: any = null;
      try {
        if (init?.body && typeof init.body === "string") bodyValue = JSON.parse(init.body);
      } catch {}

      let localValue: unknown = bodyValue;
      if (spec.key === "route-state") {
        if (method === "DELETE") localValue = { hasRoute: false, type: "route-state", routeName: "", waypoints: [], activeWaypointIndex: 0, savedAt: new Date().toISOString() };
        else localValue = { hasRoute: true, ...(bodyValue || {}) };
      } else if (spec.key === "ami-route-forecast") {
        const forecast = method === "DELETE" ? null : bodyValue?.forecast ?? null;
        localValue = { ok: true, initialized: true, forecast, updatedAt: new Date().toISOString() };
      }

      const wroteLocal = writeWheelhouse(spec.key, localValue, null);
      try {
        const cloud = await originalFetch(input, init);
        if (cloud.ok) return cloud;
        if (wroteLocal) return responseFromValue(localValue);
        return cloud;
      } catch (error) {
        if (wroteLocal) return responseFromValue(localValue);
        throw error;
      }
    };

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const spec = cacheSpecFor(input);
      if (!spec) return originalFetch(input, init);

      const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
      if (spec.persistent && method !== "GET") return wrapPersistentMutation(spec, method, input, init);
      if (method !== "GET") return originalFetch(input, init);

      const local = await requestWheelhouse(spec.key);
      if (local?.found) return responseFromValue(local.value);

      const cloud = await originalFetch(input, init);
      if (cloud.ok) {
        try {
          const data = await cloud.clone().json();
          writeWheelhouse(spec.key, data, spec.ttlMs);
        } catch {}
      }
      return cloud;
    }) as typeof window.fetch;

    const applyRemote = (forecast: AmiRouteForecast | null) => {
      if (cancelled) return;
      applyingRemoteRef.current = true;
      try {
        if (forecast) window.localStorage.setItem(AMI_OVERLAY_STORAGE_KEY, JSON.stringify(forecast));
        else window.localStorage.removeItem(AMI_OVERLAY_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent("navdash-ami-overlay-updated", { detail: forecast }));
      } finally {
        applyingRemoteRef.current = false;
      }
    };

    const writeShared = async (forecast: AmiRouteForecast | null) => fetch(SHARED_STATE_URL, {
      method: forecast ? "PUT" : "DELETE",
      headers: forecast ? { "Content-Type": "application/json" } : undefined,
      body: forecast ? JSON.stringify({ forecast }) : undefined,
      cache: "no-store",
    });

    const refreshFromShared = async () => {
      try {
        const response = await fetch(SHARED_STATE_URL, { cache: "no-store" });
        const json = (await response.json()) as SharedStateResponse;
        if (!response.ok || !json.ok) return;
        if (!json.initialized) {
          const local = readLocalForecast();
          const seedResponse = await writeShared(local);
          if (seedResponse.ok) applyRemote(local);
          return;
        }
        applyRemote(validForecast(json.forecast) ? json.forecast : null);
      } catch {}
    };

    const persistLocalChange = async (event: Event) => {
      if (applyingRemoteRef.current) return;
      const custom = event as CustomEvent<AmiRouteForecast | null>;
      const forecast = validForecast(custom.detail) ? custom.detail : null;
      try { await writeShared(forecast); } catch {}
    };

    const handleFocus = () => refreshFromShared();
    const handleVisibility = () => { if (!document.hidden) refreshFromShared(); };

    connect();
    window.addEventListener("navdash-ami-overlay-updated", persistLocalChange);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    refreshFromShared();
    intervalId = window.setInterval(refreshFromShared, REFRESH_MS);

    return () => {
      cancelled = true;
      window.fetch = originalFetch;
      window.clearInterval(intervalId);
      window.clearTimeout(reconnectTimerRef.current);
      pendingRef.current.forEach((resolve) => resolve(null));
      pendingRef.current.clear();
      if (socketRef.current) { socketRef.current.onclose = null; socketRef.current.close(); socketRef.current = null; }
      window.removeEventListener("navdash-ami-overlay-updated", persistLocalChange);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
