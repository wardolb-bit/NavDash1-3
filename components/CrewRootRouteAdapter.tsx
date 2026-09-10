"use client";

import { useLayoutEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

function hasUsableRoute(value: any) {
  return Array.isArray(value?.waypoints) && value.waypoints.length >= 2;
}

export function CrewRootRouteAdapter({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let socket: WebSocket | null = null;
    let latestRoute: any = null;
    let disposed = false;
    const waiters = new Set<(route: any) => void>();

    const publishRoute = (route: any) => {
      if (!hasUsableRoute(route)) return;
      latestRoute = route;
      for (const resolve of waiters) resolve(route);
      waiters.clear();
    };

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
      if (method !== "GET" || !url.startsWith("/api/route-state")) return originalFetch(input, init);

      if (latestRoute) {
        return new Response(JSON.stringify(latestRoute), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      try {
        const cloudResponse = await originalFetch(input, init);
        if (cloudResponse.ok) {
          const clone = cloudResponse.clone();
          try {
            const data = await clone.json();
            if (hasUsableRoute(data)) return cloudResponse;
          } catch {}
        }
      } catch {}

      const localRoute = await new Promise<any>((resolve) => {
        let settled = false;
        const finish = (route: any) => {
          if (settled) return;
          settled = true;
          waiters.delete(finish);
          resolve(route);
        };
        waiters.add(finish);
        window.setTimeout(() => finish(latestRoute), 3000);
      });

      if (localRoute) {
        return new Response(JSON.stringify(localRoute), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
    }) as typeof window.fetch;

    return () => {
      disposed = true;
      void disposed;
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
