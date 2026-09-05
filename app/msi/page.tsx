"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEgcWebSocketUrl } from "../../lib/aisWebSocket";

type WarningItem = {
  id: string;
  area: string;
  number: string;
  body: string;
  issueDate?: string;
  authority?: string;
  subregion?: string;
};

type FeedResponse = {
  ok: boolean;
  source?: string;
  area?: string;
  fetchedAt?: string;
  warnings?: WarningItem[];
  error?: string;
};

type EgcMessage = {
  id: string;
  filename: string;
  type: string;
  sequence: string;
  les: string;
  priority: string;
  size: string;
  receiveText: string;
  receivedAt: string | null;
  navarea: string;
  warningNumber: string;
  cancelledNavarea: string;
  cancelledWarningNumber: string;
  isCancellation: boolean;
  body: string;
  modifiedAt: string;
};

type EgcSnapshot = {
  type: "egc-snapshot";
  connected: boolean;
  directory: string;
  scannedAt: string | null;
  lastError: string | null;
  messages: EgcMessage[];
};

const NGA_URL = "https://msi.nga.mil/NavWarnings";
const IHO_URL = "https://iho.int/en/navigation-warnings-on-the-web";
const MNZ_URL = "https://www.maritimenz.govt.nz/navigational-warnings/";
const AREAS = ["XII", "HYDROPAC", "IV", "HYDROLANT"] as const;
type Area = (typeof AREAS)[number];
type SourceMode = "FELCOM" | "NGA";

function formatUtc(value?: string | null) {
  if (!value) return "NOT YET UPDATED";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "UNKNOWN";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

function priorityClasses(priority: string) {
  const normalized = priority.toUpperCase();
  if (normalized.includes("DISTRESS")) return "border-rose-400/40 bg-rose-400/15 text-rose-200";
  if (normalized.includes("URGENCY")) return "border-orange-400/40 bg-orange-400/15 text-orange-200";
  if (normalized.includes("SAFETY")) return "border-amber-400/40 bg-amber-400/15 text-amber-200";
  return "border-slate-400/30 bg-slate-400/10 text-slate-300";
}

export default function MsiPage() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("FELCOM");
  const [area, setArea] = useState<Area>("XII");
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WarningItem | null>(null);

  const [egcSnapshot, setEgcSnapshot] = useState<EgcSnapshot | null>(null);
  const [egcSelected, setEgcSelected] = useState<EgcMessage | null>(null);
  const [egcSocketStatus, setEgcSocketStatus] = useState("CONNECTING");
  const egcWsRef = useRef<WebSocket | null>(null);

  async function refreshNga(targetArea: Area = area) {
    setLoading(true);
    try {
      const response = await fetch(`/api/msi/nga?area=${encodeURIComponent(targetArea)}`, { cache: "no-store" });
      const data = (await response.json()) as FeedResponse;
      setFeed(data);
      setSelected(data.ok && data.warnings?.length ? data.warnings[0] : null);
    } catch (error) {
      setFeed({ ok: false, error: error instanceof Error ? error.message : "Unable to load feed" });
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  function refreshEgc() {
    const ws = egcWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "egc-refresh" }));
    }
  }

  useEffect(() => {
    if (sourceMode === "NGA") void refreshNga(area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, sourceMode]);

  useEffect(() => {
    let closedByPage = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setEgcSocketStatus("CONNECTING");
      const ws = new WebSocket(getEgcWebSocketUrl());
      egcWsRef.current = ws;

      ws.onopen = () => setEgcSocketStatus("LIVE");
      ws.onerror = () => setEgcSocketStatus("ERROR");
      ws.onclose = () => {
        setEgcSocketStatus("OFFLINE");
        if (!closedByPage) retryTimer = setTimeout(connect, 5000);
      };
      ws.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as EgcSnapshot;
          if (payload?.type !== "egc-snapshot") return;
          setEgcSnapshot(payload);
          setEgcSelected(current => {
            if (current) {
              const updated = payload.messages.find(item => item.id === current.id);
              if (updated) return updated;
            }
            return payload.messages[0] ?? null;
          });
        } catch {
          // Ignore unrelated or malformed local feed messages.
        }
      };
    };

    connect();

    return () => {
      closedByPage = true;
      if (retryTimer) clearTimeout(retryTimer);
      egcWsRef.current?.close();
    };
  }, []);

  const warnings = useMemo(() => {
    const source = feed?.warnings ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(warning =>
      `${warning.number} ${warning.area} ${warning.subregion ?? ""} ${warning.body}`.toLowerCase().includes(needle)
    );
  }, [feed?.warnings, query]);

  const egcMessages = useMemo(() => {
    const source = egcSnapshot?.messages ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(message =>
      `${message.filename} ${message.type} ${message.sequence} ${message.priority} ${message.navarea} ${message.warningNumber} ${message.body}`
        .toLowerCase()
        .includes(needle)
    );
  }, [egcSnapshot?.messages, query]);

  const isFelcom = sourceMode === "FELCOM";
  const displayedCount = isFelcom ? egcMessages.length : warnings.length;
  const updatedAt = isFelcom ? egcSnapshot?.scannedAt : feed?.fetchedAt;

  return (
    <main className="min-h-screen bg-[#06111f] px-4 py-5 text-slate-100 md:px-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[#f2b84b]">GMDSS SUPPORT</div>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-tight md:text-3xl">EGC / Maritime Safety Information</h1>
              <p className="mt-2 max-w-4xl text-sm font-semibold text-slate-400">
                Live shipboard FELCOM 19 EGC messages with supplemental official NGA navigational warnings.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/" className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10">
                MAIN PAGE
              </Link>
              <button
                type="button"
                onClick={() => (isFelcom ? refreshEgc() : void refreshNga())}
                className="rounded-xl border border-[#f2b84b]/50 bg-[#f2b84b]/15 px-4 py-2.5 text-sm font-black text-[#f0c46a] transition hover:bg-[#f2b84b]/25"
              >
                {loading && !isFelcom ? "REFRESHING..." : "REFRESH"}
              </button>
              <a href={IHO_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10">
                IHO NAVAREA INDEX
              </a>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSourceMode("FELCOM")}
              className={`rounded-xl border px-4 py-2 text-sm font-black transition ${
                isFelcom ? "border-[#22d3ee] bg-[#22d3ee] text-slate-950" : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10"
              }`}
            >
              FELCOM 19 EGC
            </button>
            {AREAS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSourceMode("NGA");
                  setArea(item);
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-black transition ${
                  !isFelcom && area === item
                    ? "border-[#f2b84b] bg-[#f2b84b] text-slate-950"
                    : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10"
                }`}
              >
                {item === "XII" || item === "IV" ? `NAVAREA ${item}` : item}
              </button>
            ))}
            <a href={MNZ_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-slate-300 transition hover:bg-white/10">
              NAVAREA XIV ↗
            </a>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">SOURCE STATUS</div>

              {isFelcom ? (
                <div className="mt-3 rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-black">FELCOM 19 EGC</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${egcSocketStatus === "LIVE" && !egcSnapshot?.lastError ? "bg-emerald-400" : "bg-rose-400"}`} />
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                    Wheelhouse file feed · {egcSocketStatus}
                  </p>
                  {egcSnapshot?.lastError && (
                    <p className="mt-2 break-words text-xs font-bold leading-5 text-rose-200">{egcSnapshot.lastError}</p>
                  )}
                </div>
              ) : (
                <a href={NGA_URL} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/10 p-3 transition hover:bg-[#22d3ee]/15">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-black">NGA MSI</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${feed?.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                    Official active broadcast-warning feed. Currently displaying {area === "XII" || area === "IV" ? `NAVAREA ${area}` : area}.
                  </p>
                </a>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500" htmlFor="msi-search">
                Search messages
              </label>
              <input
                id="msi-search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="warning no., NAVAREA, cable, debris..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#f2b84b]/60"
              />
              <div className="mt-3 space-y-1 text-xs font-black uppercase tracking-wider text-slate-500">
                <div className="flex items-center justify-between"><span>Messages</span><span>{displayedCount}</span></div>
                <div className="flex items-center justify-between"><span>Updated</span><span>{formatUtc(updatedAt)}</span></div>
              </div>
            </div>
          </div>

          {isFelcom ? (
            <div className="grid min-h-[620px] gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                <div className="mb-3 px-1">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-[#22d3ee]">SHIPBOARD RECEIVER</div>
                  <div className="text-sm font-black text-slate-200">FELCOM 19 EGC INBOX</div>
                </div>
                <div className="max-h-[570px] space-y-2 overflow-y-auto pr-1">
                  {egcSocketStatus !== "LIVE" && !egcSnapshot && (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">Connecting to wheelhouse EGC feed...</div>
                  )}
                  {egcSnapshot && egcMessages.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">No saved FELCOM EGC messages matched this filter.</div>
                  )}
                  {egcMessages.map(message => {
                    const active = egcSelected?.id === message.id;
                    const preview = message.body.replace(/\s+/g, " ").slice(0, 180);
                    const title = message.navarea && message.warningNumber ? `NAVAREA ${message.navarea} ${message.warningNumber}` : message.type;
                    return (
                      <button
                        key={message.id}
                        type="button"
                        onClick={() => setEgcSelected(message)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active ? "border-[#22d3ee] bg-[#22d3ee]/10" : "border-white/10 bg-black/15 hover:bg-white/[0.06]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-black text-slate-100">{title}</span>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${priorityClasses(message.priority)}`}>
                            {message.priority || "EGC"}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                          {formatUtc(message.receivedAt)} · SEQ {message.sequence || "--"}
                        </div>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                          {preview}{message.body.length > 180 ? "…" : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                {egcSelected ? (
                  <>
                    <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-[#22d3ee]">{egcSelected.type}</div>
                        <h2 className="mt-1 text-2xl font-black">
                          {egcSelected.navarea && egcSelected.warningNumber
                            ? `NAVAREA ${egcSelected.navarea} ${egcSelected.warningNumber}`
                            : `EGC SEQ ${egcSelected.sequence || "--"}`}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
                          <span>RECEIVED {formatUtc(egcSelected.receivedAt)}</span>
                          <span>LES {egcSelected.les || "--"}</span>
                          <span>FILE {egcSelected.filename}</span>
                        </div>
                      </div>
                      <span className={`w-fit rounded-lg border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${priorityClasses(egcSelected.priority)}`}>
                        {egcSelected.priority || "EGC"}
                      </span>
                    </div>

                    {egcSelected.isCancellation && (
                      <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-amber-200">
                        Cancellation message · cancels NAVAREA {egcSelected.cancelledNavarea} {egcSelected.cancelledWarningNumber}
                      </div>
                    )}

                    <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-[13px] font-semibold leading-6 text-slate-200">
                      {egcSelected.body}
                    </pre>
                  </>
                ) : (
                  <div className="grid h-full min-h-[420px] place-items-center text-center">
                    <div>
                      <div className="text-3xl">◫</div>
                      <div className="mt-3 text-sm font-black uppercase tracking-[0.14em] text-slate-400">No EGC selected</div>
                      <p className="mt-2 text-sm font-semibold text-slate-600">Saved FELCOM messages will appear here automatically.</p>
                    </div>
                  </div>
                )}
              </article>
            </div>
          ) : (
            <div className="grid min-h-[620px] gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                <div className="mb-3 px-1">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-[#f2b84b]">{area === "XII" || area === "IV" ? `NAVAREA ${area}` : area}</div>
                  <div className="text-sm font-black text-slate-200">ACTIVE NGA WARNINGS</div>
                </div>
                <div className="max-h-[570px] space-y-2 overflow-y-auto pr-1">
                  {loading && <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">Retrieving official warnings...</div>}
                  {!loading && !feed?.ok && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm font-bold text-rose-200">Feed unavailable: {feed?.error ?? "Unknown error"}</div>}
                  {!loading && feed?.ok && warnings.length === 0 && <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">No active warnings matched this area/filter.</div>}
                  {warnings.map(warning => {
                    const active = selected?.id === warning.id;
                    const preview = warning.body.replace(/\s+/g, " ").slice(0, 190);
                    return (
                      <button key={warning.id} type="button" onClick={() => setSelected(warning)} className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-[#f2b84b] bg-[#f2b84b]/15" : "border-white/10 bg-black/15 hover:bg-white/[0.06]"}`}>
                        <div className="flex items-center justify-between gap-3"><span className="font-black text-slate-100">{warning.area} {warning.number}</span><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">ACTIVE</span></div>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">{preview}{warning.body.length > 190 ? "…" : ""}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                {selected ? (
                  <>
                    <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div><div className="text-xs font-black uppercase tracking-[0.16em] text-[#f2b84b]">{selected.area} WARNING</div><h2 className="mt-1 text-2xl font-black">{selected.number}</h2>{selected.issueDate && <div className="mt-1 text-xs font-bold text-slate-500">ISSUED {selected.issueDate}</div>}</div>
                      <span className="w-fit rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-300">Active on NGA source</span>
                    </div>
                    <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-[13px] font-semibold leading-6 text-slate-200">{selected.body}</pre>
                  </>
                ) : (
                  <div className="grid h-full min-h-[420px] place-items-center text-center"><div><div className="text-3xl">◫</div><div className="mt-3 text-sm font-black uppercase tracking-[0.14em] text-slate-400">Select a warning</div><p className="mt-2 text-sm font-semibold text-slate-600">The original warning text will appear here.</p></div></div>
                )}
              </article>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-xs font-bold leading-5 text-amber-100/80">
          SUPPLEMENTAL MSI DISPLAY • NOT A REPLACEMENT FOR APPROVED GMDSS EQUIPMENT • VERIFY SAFETY-CRITICAL INFORMATION USING REQUIRED SHIPBOARD GMDSS RECEIVERS AND OFFICIAL BROADCAST SERVICES
        </section>
      </div>
    </main>
  );
}
