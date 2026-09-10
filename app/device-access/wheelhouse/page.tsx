"use client";

import { useEffect, useState } from "react";

const TOKEN_KEY = "navdash-device-token-v1";

function makeToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function WheelhouseRecoveryPage() {
  const [message, setMessage] = useState("Restoring wheelhouse access…");

  useEffect(() => {
    let cancelled = false;

    const recover = async () => {
      const params = new URLSearchParams(window.location.search);
      const recoveryKey = params.get("key")?.trim() || "";

      if (!recoveryKey) {
        setMessage("Wheelhouse recovery key is missing.");
        return;
      }

      try {
        const token = makeToken();
        const response = await fetch("/api/device-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "recover-wheelhouse",
            recoveryKey,
            token,
            name: "Wheelhouse PC",
          }),
        });
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error || "Wheelhouse recovery failed.");
        if (cancelled) return;

        window.localStorage.setItem(TOKEN_KEY, token);
        window.history.replaceState(null, "", "/navdash");
        window.location.replace("/navdash");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Wheelhouse recovery failed.");
      }
    };

    void recover();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#071019] px-6 text-slate-200">
      <div className="text-center">
        <div className="text-xs font-black uppercase tracking-[0.28em] text-[#c9a227]">NavDash</div>
        <div className="mt-3 text-sm font-bold uppercase tracking-[0.14em] text-slate-400">{message}</div>
      </div>
    </main>
  );
}
