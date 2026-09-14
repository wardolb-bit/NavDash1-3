"use client";

import { useLayoutEffect } from "react";

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.href);
  return {
    path: url.pathname,
    method: String(init?.method || request?.method || "GET").toUpperCase(),
  };
}

export default function CrewRouteWeatherBridge() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { path, method } = requestDetails(input, init);
      if (path !== "/api/wx" || method !== "GET") return nativeFetch(input, init);

      try {
        const routeResponse = await nativeFetch("/api/route-state", { cache: "no-store" });
        if (!routeResponse.ok) return nativeFetch(input, init);
        const route = await routeResponse.json();
        if (!route?.hasRoute || !Array.isArray(route?.waypoints) || route.waypoints.length < 2) {
          return nativeFetch(input, init);
        }

        const weatherResponse = await nativeFetch("/api/crew-route-weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            waypoints: route.waypoints,
            activeWaypointIndex: route.activeWaypointIndex,
          }),
        });

        if (weatherResponse.ok) return weatherResponse;
      } catch {
        // Fall through to the legacy point-weather source if route weather is unavailable.
      }

      return nativeFetch(input, init);
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
