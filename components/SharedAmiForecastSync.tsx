"use client";

import { useEffect, useRef } from "react";
import type { AmiRouteForecast } from "../lib/amiRouteForecast";

const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const SHARED_STATE_URL = "/api/ami-route-forecast/state";
const REFRESH_MS = 60_000;

type SharedStateResponse = {
  ok: boolean;
  initialized?: boolean;
  forecast?: AmiRouteForecast | null;
  updatedAt?: string | null;
  error?: string;
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

export function SharedAmiForecastSync() {
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;

    const applyRemote = (forecast: AmiRouteForecast | null) => {
      if (cancelled) return;
      applyingRemoteRef.current = true;
      try {
        if (forecast) {
          window.localStorage.setItem(AMI_OVERLAY_STORAGE_KEY, JSON.stringify(forecast));
        } else {
          window.localStorage.removeItem(AMI_OVERLAY_STORAGE_KEY);
        }
        window.dispatchEvent(new CustomEvent("navdash-ami-overlay-updated", { detail: forecast }));
      } finally {
        applyingRemoteRef.current = false;
      }
    };

    const writeShared = async (forecast: AmiRouteForecast | null) => {
      return fetch(SHARED_STATE_URL, {
        method: forecast ? "PUT" : "DELETE",
        headers: forecast ? { "Content-Type": "application/json" } : undefined,
        body: forecast ? JSON.stringify({ forecast }) : undefined,
        cache: "no-store",
      });
    };

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
      } catch {
        // Keep the most recent local overlay if shared state is temporarily unavailable.
      }
    };

    const persistLocalChange = async (event: Event) => {
      if (applyingRemoteRef.current) return;
      const custom = event as CustomEvent<AmiRouteForecast | null>;
      const forecast = validForecast(custom.detail) ? custom.detail : null;
      try {
        const response = await writeShared(forecast);
        if (!response.ok) window.setTimeout(refreshFromShared, 1500);
      } catch {
        window.setTimeout(refreshFromShared, 1500);
      }
    };

    const handleFocus = () => refreshFromShared();
    const handleVisibility = () => {
      if (!document.hidden) refreshFromShared();
    };

    window.addEventListener("navdash-ami-overlay-updated", persistLocalChange);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    refreshFromShared();
    intervalId = window.setInterval(refreshFromShared, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("navdash-ami-overlay-updated", persistLocalChange);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
