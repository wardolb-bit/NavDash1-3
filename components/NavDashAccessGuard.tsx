"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const TOKEN_KEY = "navdash-device-token-v1";

export function NavDashAccessGuard() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    // These routes intentionally remain reachable without Bridge role.
    if (pathname.startsWith("/tides") || pathname.startsWith("/device-access")) return;

    const checkBridge = async (token?: string) => {
      const response = await fetch("/api/device-access", {
        cache: "no-store",
        headers: token ? { "x-navdash-device-token": token } : undefined,
      });
      const result = await response.json();
      return response.ok && result?.ok && result?.role === "bridge";
    };

    const check = async () => {
      const token = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";

      try {
        // Prefer the secure session cookie. A stale localStorage token must not
        // override a valid Bridge cookie on refresh.
        if (await checkBridge()) return;
        if (cancelled) return;

        // Preserve compatibility with devices that were paired before the
        // HttpOnly cookie existed by falling back to their local token.
        if (token && await checkBridge(token)) return;
        if (cancelled) return;

        if (!pathname.startsWith("/phone")) window.location.replace("/phone?restricted=1");
      } catch {
        if (!cancelled && !pathname.startsWith("/phone")) window.location.replace("/phone?restricted=1");
      }
    };

    void check();
    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
