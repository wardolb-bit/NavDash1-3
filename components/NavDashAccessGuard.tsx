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

    const check = async () => {
      const token = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";

      try {
        const response = await fetch("/api/device-access", {
          cache: "no-store",
          headers: token ? { "x-navdash-device-token": token } : undefined,
        });
        const result = await response.json();
        if (cancelled) return;

        if (response.ok && result?.ok && result?.role === "bridge") return;
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
