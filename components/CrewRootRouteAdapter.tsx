"use client";

import { useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

function hasUsableRoute(value: any) {
  return Array.isArray(value?.waypoints) && value.waypoints.length >= 2;
}

function routeResponse(route: any) {
  return new Response(JSON.stringify(route), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function CrewRootRouteAdapter({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let socket: WebSocket | null = null;
    let latestRoute: any = null;
    const waiters = new Set<(route: any) => void>();

    const publishRoute = (route: any) => {
      if (!hasUsableRoute(route)) return;
      latestRoute = route;
      try { window.sessionStorage.setItem("navconsole-saved-route", JSON.stringify(route)); } catch {}
      for (const resolve of waiters) resolve(route);
      waiters.clear();
    };

    const waitForWheelhouseRoute = (timeoutMs: number) => new Promise<any>((resolve) => {
      if (latestRoute) {
        resolve(latestRoute);
        return;
      }
      let settled = false;
      const finish = (route: any) => {
        if (settled) return;
        settled = true;
        waiters.delete(finish);
        resolve(route);
      };
      waiters.add(finish);
      window.setTimeout(() => finish(latestRoute), timeoutMs);
    });

    try {
      socket = new WebSocket(getAisWebSocketUrl());
      socket.onmessage = (event) => {
        let message: any = event.data;
        try { message = JSON.parse(event.data); } catch {}
        if (message?.type === "route-state") publishRoute(message);
      };
    } catch {}

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
      if (method !== "GET" || !url.includes("/api/route-state")) return originalFetch(input, init);

      if (latestRoute) return routeResponse(latestRoute);

      const wheelhouseRoute = await waitForWheelhouseRoute(1500);
      if (wheelhouseRoute) return routeResponse(wheelhouseRoute);

      try {
        const cloudResponse = await originalFetch(input, init);
        if (cloudResponse.ok) {
          try {
            const data = await cloudResponse.clone().json();
            if (hasUsableRoute(data)) {
              publishRoute(data);
              return cloudResponse;
            }
          } catch {}
        }
      } catch {}

      const lateWheelhouseRoute = await waitForWheelhouseRoute(2500);
      if (lateWheelhouseRoute) return routeResponse(lateWheelhouseRoute);

      return new Response("{}", {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
      waiters.clear();
      if (socket) {
        socket.onmessage = null;
        socket.close();
      }
    };
  }, []);

  return <>{children}</>;
}
