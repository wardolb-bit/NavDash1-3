"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

const TOKEN_KEY = "navdash-device-token-v1";

function isPublicPath(pathname: string) {
  return pathname === "/" || pathname.startsWith("/tides");
}

export function DeviceAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<"checking" | "bridge" | "crew" | "public">("checking");

  useEffect(() => {
    let cancelled = false;

    if (isPublicPath(pathname)) {
      setMode("public");
      return;
    }

    if (pathname.startsWith("/device-access")) {
      setMode("crew");
      return;
    }

    const check = async () => {
      const token = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
      if (!token) {
        if (pathname.startsWith("/phone")) {
          if (!cancelled) setMode("crew");
        } else {
          if (!cancelled) setMode("crew");
          router.replace("/phone?restricted=1");
        }
        return;
      }

      try {
        const response = await fetch("/api/device-access", {
          cache: "no-store",
          headers: { "x-navdash-device-token": token },
        });
        const result = await response.json();
        if (cancelled) return;

        if (response.ok && result?.ok && result?.role === "bridge") {
          setMode("bridge");
          return;
        }

        window.localStorage.removeItem(TOKEN_KEY);
        setMode("crew");
        if (!pathname.startsWith("/phone")) router.replace("/phone?restricted=1");
      } catch {
        if (cancelled) return;
        setMode("crew");
        if (!pathname.startsWith("/phone")) router.replace("/phone?restricted=1");
      }
    };

    setMode("checking");
    void check();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (mode === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071019] px-6 text-slate-200">
        <div className="text-center">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-[#c9a227]">NavDash</div>
          <div className="mt-3 text-sm font-bold uppercase tracking-[0.14em] text-slate-400">Checking device access…</div>
        </div>
      </main>
    );
  }

  if (mode === "public" || mode === "bridge") return <>{children}</>;

  if (pathname.startsWith("/device-access")) return <>{children}</>;

  if (pathname.startsWith("/phone")) {
    return (
      <>
        {children}
        <div className="fixed bottom-4 right-4 z-[2000] flex items-center gap-2 rounded-2xl border border-[#c9a227]/45 bg-[#071019]/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <span className="px-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Crew Mode</span>
          <Link href="/device-access" className="rounded-xl bg-[#c9a227] px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-950">
            Pair Device
          </Link>
        </div>
      </>
    );
  }

  return null;
}
