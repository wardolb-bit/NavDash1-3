"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

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
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [generatedRole, setGeneratedRole] = useState<"bridge" | "crew">("bridge");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const token = useMemo(() => {
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

  return (
    <main className="min-h-screen bg-[#071019] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-[#c9a227]">NavDash Device Access</div>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.08em]">{bridge ? "Bridge Device Manager" : "Pair This Device"}</h1>
          </div>
          <Link href={bridge ? "/navdash" : "/phone"} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-slate-200">
            {bridge ? "Main" : "Crew View"}
          </Link>
        </div>

        {!bridge ? (
          <form onSubmit={pairDevice} className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25">
            <p className="mb-5 text-sm leading-6 text-slate-400">
              This browser is currently in Crew Mode. Enter a bridge-issued pairing code to unlock full NavDash on this device.
            </p>
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Device name</label>
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="Cole iPad"
              minLength={2}
              required
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#0c1721] px-4 py-3 text-base font-bold text-white outline-none focus:border-[#c9a227]"
            />

            <label className="mt-5 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Pairing code</label>
            <input
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="XXXXXXXX"
              autoCapitalize="characters"
              required
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#0c1721] px-4 py-3 font-mono text-xl font-black uppercase tracking-[0.18em] text-white outline-none focus:border-[#c9a227]"
            />

            <button
              type="submit"
              disabled={busy}
              className="mt-6 w-full rounded-xl bg-[#c9a227] px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-950 disabled:opacity-50"
            >
              {busy ? "Pairing…" : "Pair Device"}
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-[#c9a227]/30 bg-[#c9a227]/[0.07] p-5">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-[#c9a227]">This Device</div>
              <div className="mt-2 text-lg font-black">{status?.name || "Bridge Device"}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-400">Full NavDash access</div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Pair another device</div>
                  <div className="mt-2 text-sm text-slate-400">Codes expire after 30 minutes and work once.</div>
                </div>
                <select
                  value={generatedRole}
                  onChange={(event) => setGeneratedRole(event.target.value === "crew" ? "crew" : "bridge")}
                  className="rounded-xl border border-white/15 bg-[#0c1721] px-3 py-2 text-sm font-bold text-white"
                >
                  <option value="bridge">Bridge access</option>
                  <option value="crew">Crew access</option>
                </select>
              </div>
              <button onClick={createCode} disabled={busy} className="mt-4 rounded-xl bg-[#c9a227] px-4 py-3 text-sm font-black uppercase tracking-[0.1em] text-slate-950 disabled:opacity-50">
                Generate Pairing Code
              </button>
              {generatedCode ? (
                <div className="mt-4 rounded-xl border border-[#22d3ee]/35 bg-[#071019] p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Pairing code</div>
                  <div className="mt-1 font-mono text-3xl font-black tracking-[0.18em] text-[#67e8f9]">{generatedCode}</div>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="mb-4 text-xs font-black uppercase tracking-[0.12em] text-slate-400">Approved devices</div>
              <div className="space-y-2">
                {devices.length ? devices.map((device) => (
                  <div key={device.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0c1721] px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{device.name}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{device.role} · seen {ageText(device.last_seen_at)}</div>
                    </div>
                    <button
                      onClick={() => revokeDevice(device.id)}
                      disabled={busy || device.id === status?.id}
                      className="rounded-lg border border-red-400/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-red-300 disabled:opacity-25"
                    >
                      {device.id === status?.id ? "This Device" : "Revoke"}
                    </button>
                  </div>
                )) : <div className="text-sm text-slate-500">No approved devices found.</div>}
              </div>
            </section>
          </div>
        )}

        {message ? <div className="mt-5 rounded-xl border border-red-400/30 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-200">{message}</div> : null}
      </div>
    </main>
  );
}
