"use client";

import { useLayoutEffect } from "react";

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.href);
  return {
    url,
    path: url.pathname,
    method: String(init?.method || request?.method || "GET").toUpperCase(),
  };
}

export default function CrewRouteWeatherBridge() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, path, method } = requestDetails(input, init);
      if (path !== "/api/wx" || method !== "GET") return nativeFetch(input, init);

      try {
        const [routeResponse, planResponse] = await Promise.all([
          nativeFetch("/api/route-state", { cache: "no-store" }),
          nativeFetch("/api/weather-plan-state", { cache: "no-store" }),
        ]);
        if (!routeResponse.ok) return nativeFetch(input, init);
        const route = await routeResponse.json();
        if (!route?.hasRoute || !Array.isArray(route?.waypoints) || route.waypoints.length < 2) {
          return nativeFetch(input, init);
        }

        const plan = planResponse.ok ? await planResponse.json() : null;
        const shipLat = Number(url.searchParams.get("lat"));
        const shipLon = Number(url.searchParams.get("lon"));

        const weatherResponse = await nativeFetch("/api/crew-route-weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            waypoints: route.waypoints,
            shipLat: Number.isFinite(shipLat) ? shipLat : null,
            shipLon: Number.isFinite(shipLon) ? shipLon : null,
            departure: plan?.departure ?? null,
            speedKt: plan?.speedKt ?? null,
          }),
        });

        if (weatherResponse.ok) return weatherResponse;
      } catch {
        // Fall through to the legacy point-weather source if shared route weather is unavailable.
      }

      return nativeFetch(input, init);
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
