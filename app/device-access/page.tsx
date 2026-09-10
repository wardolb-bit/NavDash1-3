"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

const TOKEN_KEY = "navdash-device-token-v1";

type Device = {
  id: string;
  name: string;
  role: "bridge" | "crew";
  created_at: string;
  last_seen_at: string;
};

type Status = {
  ok: boolean;
  id?: string;
  name?: string;
  role?: "bridge" | "crew";
};

function makeToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ageText(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "--";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function DeviceAccessPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const dayMode = !nightMode;
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [generatedRole, setGeneratedRole] = useState<"bridge" | "crew">("bridge");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
  }, []);

  const load = async () => {
    const stored = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
    if (!stored) {
      setStatus({ ok: false, role: "crew" });
      setDevices([]);
      return;
    }

    try {
      const response = await fetch("/api/device-access", {
        cache: "no-store",
        headers: { "x-navdash-device-token": stored },
      });
      const result = await response.json();
      setStatus(result);

      if (response.ok && result?.ok && result?.role === "bridge") {
        const listResponse = await fetch("/api/device-access?action=list", {
          cache: "no-store",
          headers: { "x-navdash-device-token": stored },
        });
        const listResult = await listResponse.json();
        setDevices(Array.isArray(listResult?.devices) ? listResult.devices : []);
      } else {
        setDevices([]);
      }
    } catch {
      setStatus({ ok: false, role: "crew" });
      setDevices([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function pairDevice(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const newToken = makeToken();
      const response = await fetch("/api/device-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pair",
          code: pairingCode.trim(),
          name: deviceName.trim(),
          token: newToken,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Pairing failed.");

      window.localStorage.setItem(TOKEN_KEY, newToken);
      window.location.href = "/navdash";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createCode() {
    const stored = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
    setBusy(true);
    setMessage("");
    setGeneratedCode("");

    try {
      const response = await fetch("/api/device-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-navdash-device-token": stored,
        },
        body: JSON.stringify({
          action: "create-code",
          role: generatedRole,
          maxUses: 1,
          minutes: 30,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Could not create pairing code.");
      setGeneratedCode(result.code || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    const stored = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
    if (!stored || !window.confirm("Revoke this device?")) return;
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/device-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-navdash-device-token": stored,
        },
        body: JSON.stringify({ action: "revoke", deviceId }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Could not revoke device.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke device.");
    } finally {
      setBusy(false);
    }
  }

  const bridge = status?.ok && status.role === "bridge";
  const shell = dayMode ? "bg-[#eef2f5] text-[#17212b]" : "bg-[#05090e] text-[#dbe5ee]";
  const panel = dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-[#08111a]";
  const sub = dayMode ? "border-slate-300 bg-[#f5f7f9]" : "border-white/10 bg-[#050a0f]";
  const muted = dayMode ? "text-slate-600" : "text-[#8294a5]";
  const control = dayMode ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-100" : "border-white/15 bg-[#101820] text-[#dbe5ee] hover:bg-[#182631]";

  return (
    <main className={`navdash-device-access-console min-h-screen ${shell}`}>
      <style jsx global>{`
        body:has(.navdash-device-access-console) .navdash-global-nav{display:none!important}
        .navdash-device-access-console *{border-radius:0!important}
        .navdash-device-access-console button,.navdash-device-access-console a,.navdash-device-access-console input,.navdash-device-access-console select{box-shadow:none!important}
      `}</style>

      <header className={`border-b px-4 py-3 ${panel}`}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#c9a227]">M/V MB480 · NAVDASH 1.3</div>
            <div className="mt-1 text-xl font-black uppercase tracking-[.08em]">{bridge ? "DEVICE ACCESS MANAGER" : "DEVICE ACCESS"}</div>
            <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.12em] ${muted}`}>{bridge ? "BRIDGE AUTHORIZATION / DEVICE CONTROL" : "CREW MODE / BRIDGE PAIRING"}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={toggleTheme} className={`border px-3 py-2 text-[10px] font-black uppercase tracking-[.1em] ${control}`}>{dayMode ? "Night" : "Day"}</button>
            <Link href={bridge ? "/navdash" : "/phone"} className={`border px-3 py-2 text-[10px] font-black uppercase tracking-[.1em] ${control}`}>{bridge ? "Main" : "Crew View"}</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl p-4">
        {!bridge ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <form onSubmit={pairDevice} className={`border p-5 ${panel}`}>
              <div className="border-b border-[#c9a227]/40 pb-3">
                <div className="text-[10px] font-black uppercase tracking-[.15em] text-[#c9a227]">PAIR THIS DEVICE</div>
                <div className={`mt-2 text-sm leading-6 ${muted}`}>This browser is currently restricted to Crew Mode. Enter a bridge-issued pairing code to authorize full NavDash access.</div>
              </div>

              <label className={`mt-5 block text-[10px] font-black uppercase tracking-[.12em] ${muted}`}>Device name</label>
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Cole iPad" minLength={2} required className={`mt-2 w-full border px-3 py-3 text-base font-bold outline-none focus:border-[#c9a227] ${control}`} />

              <label className={`mt-5 block text-[10px] font-black uppercase tracking-[.12em] ${muted}`}>Pairing code</label>
              <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" autoCapitalize="characters" required className={`mt-2 w-full border px-3 py-3 font-mono text-xl font-black uppercase tracking-[.18em] outline-none focus:border-[#c9a227] ${control}`} />

              <button type="submit" disabled={busy} className="mt-5 w-full border border-[#c9a227] bg-[#c9a227] px-4 py-3 text-xs font-black uppercase tracking-[.12em] text-[#111820] disabled:opacity-50">{busy ? "PAIRING..." : "PAIR DEVICE"}</button>
            </form>

            <section className={`border p-5 ${sub}`}>
              <div className="text-[10px] font-black uppercase tracking-[.15em] text-[#42d3c8]">ACCESS STATE</div>
              <div className="mt-5 grid gap-3">
                <div className={`border p-4 ${panel}`}>
                  <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Current Role</div>
                  <div className="mt-1 text-2xl font-black uppercase">CREW</div>
                </div>
                <div className={`border p-4 ${panel}`}>
                  <div className={`text-[9px] font-black uppercase tracking-[.12em] ${muted}`}>Full Console</div>
                  <div className="mt-1 text-sm font-black uppercase text-[#c9a227]">PAIRING REQUIRED</div>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
            <div className="space-y-4">
              <section className={`border p-5 ${panel}`}>
                <div className="text-[10px] font-black uppercase tracking-[.15em] text-[#c9a227]">THIS DEVICE</div>
                <div className="mt-3 text-xl font-black uppercase tracking-[.04em]">{status?.name || "BRIDGE DEVICE"}</div>
                <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.1em] ${muted}`}>FULL NAVDASH ACCESS</div>
              </section>

              <section className={`border p-5 ${panel}`}>
                <div className="text-[10px] font-black uppercase tracking-[.15em] text-[#42d3c8]">PAIR ANOTHER DEVICE</div>
                <div className={`mt-2 text-sm ${muted}`}>Codes expire after 30 minutes and work once.</div>
                <select value={generatedRole} onChange={(event) => setGeneratedRole(event.target.value === "crew" ? "crew" : "bridge")} className={`mt-4 w-full border px-3 py-3 text-sm font-bold ${control}`}>
                  <option value="bridge">Bridge access</option>
                  <option value="crew">Crew access</option>
                </select>
                <button onClick={createCode} disabled={busy} className="mt-3 w-full border border-[#c9a227] bg-[#c9a227] px-4 py-3 text-xs font-black uppercase tracking-[.1em] text-[#111820] disabled:opacity-50">GENERATE PAIRING CODE</button>
                {generatedCode ? (
                  <div className={`mt-4 border border-[#42d3c8]/50 p-4 ${sub}`}>
                    <div className={`text-[9px] font-black uppercase tracking-[.16em] ${muted}`}>Pairing Code</div>
                    <div className="mt-1 font-mono text-3xl font-black tracking-[.18em] text-[#42d3c8]">{generatedCode}</div>
                  </div>
                ) : null}
              </section>
            </div>

            <section className={`border p-5 ${panel}`}>
              <div className="mb-4 flex items-end justify-between gap-4 border-b border-[#c9a227]/30 pb-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[.15em] text-[#c9a227]">APPROVED DEVICES</div>
                  <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.1em] ${muted}`}>BRIDGE DEVICE REGISTRY</div>
                </div>
                <div className="font-mono text-lg font-black text-[#42d3c8]">{devices.length}</div>
              </div>
              <div className="space-y-2">
                {devices.length ? devices.map((device) => (
                  <div key={device.id} className={`flex items-center justify-between gap-4 border px-4 py-3 ${sub}`}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black uppercase">{device.name}</div>
                      <div className={`mt-1 text-[9px] font-bold uppercase tracking-[.1em] ${muted}`}>{device.role} · SEEN {ageText(device.last_seen_at)}</div>
                    </div>
                    <button onClick={() => revokeDevice(device.id)} disabled={busy || device.id === status?.id} className="border border-red-400/40 px-3 py-2 text-[9px] font-black uppercase tracking-[.08em] text-red-400 disabled:opacity-25">{device.id === status?.id ? "THIS DEVICE" : "REVOKE"}</button>
                  </div>
                )) : <div className={`border p-4 text-sm ${sub} ${muted}`}>No approved devices found.</div>}
              </div>
            </section>
          </div>
        )}

        {message ? <div className="mt-4 border border-red-400/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">{message}</div> : null}
      </div>
    </main>
  );
}
