"use client";

import { useEffect, useMemo, useState } from "react";

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

const NGA_URL = "https://msi.nga.mil/NavWarnings";
const IHO_URL = "https://iho.int/en/navigation-warnings-on-the-web";
const MNZ_URL = "https://www.maritimenz.govt.nz/navigational-warnings/";
const AREAS = ["XII", "HYDROPAC", "IV", "HYDROLANT"] as const;
type Area = (typeof AREAS)[number];

function formatUtc(value?: string) {
  if (!value) return "NOT YET UPDATED";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "UNKNOWN";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

export default function MsiPage() {
  const [area, setArea] = useState<Area>("XII");
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WarningItem | null>(null);

  async function refresh(targetArea: Area = area) {
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

  useEffect(() => {
    void refresh(area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  const warnings = useMemo(() => {
    const source = feed?.warnings ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((warning) =>
      `${warning.number} ${warning.area} ${warning.subregion ?? ""} ${warning.body}`.toLowerCase().includes(needle)
    );
  }, [feed?.warnings, query]);

  return (
    <main className="min-h-screen bg-[#071019] px-4 py-5 text-slate-100 md:px-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-[#c9a227]">GMDSS SUPPORT</div>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-tight md:text-3xl">EGC / Maritime Safety Information</h1>
              <p className="mt-2 max-w-4xl text-sm font-semibold text-slate-400">
                Live supplemental navigational warnings from the U.S. National Geospatial-Intelligence Agency, plus direct links to official WWNWS sources.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void refresh()} className="rounded-xl border border-[#c9a227]/50 bg-[#c9a227]/15 px-4 py-2.5 text-sm font-black text-[#f6d66d] transition hover:bg-[#c9a227]/25">
                {loading ? "REFRESHING..." : "REFRESH"}
              </button>
              <a href={IHO_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10">IHO NAVAREA INDEX</a>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex flex-wrap items-center gap-2">
            {AREAS.map((item) => (
              <button key={item} type="button" onClick={() => setArea(item)} className={`rounded-xl border px-4 py-2 text-sm font-black transition ${area === item ? "border-[#c9a227] bg-[#c9a227] text-slate-950" : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10"}`}>
                {item === "XII" || item === "IV" ? `NAVAREA ${item}` : item}
              </button>
            ))}
            <a href={MNZ_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-slate-300 transition hover:bg-white/10">NAVAREA XIV ↗</a>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">SOURCE STATUS</div>
              <a href={NGA_URL} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/10 p-3 transition hover:bg-[#22d3ee]/15">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black">NGA MSI</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${feed?.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                </div>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">Official active broadcast-warning feed. Currently displaying {area === "XII" || area === "IV" ? `NAVAREA ${area}` : area}.</p>
              </a>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500" htmlFor="msi-search">Search warnings</label>
              <input id="msi-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="warning no., light, cable, debris..." className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#c9a227]/60" />
              <div className="mt-3 space-y-1 text-xs font-black uppercase tracking-wider text-slate-500">
                <div className="flex items-center justify-between"><span>Warnings</span><span>{warnings.length}</span></div>
                <div className="flex items-center justify-between"><span>Updated</span><span>{formatUtc(feed?.fetchedAt)}</span></div>
              </div>
            </div>
          </div>

          <div className="grid min-h-[620px] gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="mb-3 px-1">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-[#c9a227]">{area === "XII" || area === "IV" ? `NAVAREA ${area}` : area}</div>
                <div className="text-sm font-black text-slate-200">ACTIVE NGA WARNINGS</div>
              </div>
              <div className="max-h-[570px] space-y-2 overflow-y-auto pr-1">
                {loading && <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">Retrieving official warnings...</div>}
                {!loading && !feed?.ok && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm font-bold text-rose-200">Feed unavailable: {feed?.error ?? "Unknown error"}</div>}
                {!loading && feed?.ok && warnings.length === 0 && <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm font-bold text-slate-400">No active warnings matched this area/filter.</div>}
                {warnings.map((warning) => {
                  const active = selected?.id === warning.id;
                  const preview = warning.body.replace(/\s+/g, " ").slice(0, 190);
                  return (
                    <button key={warning.id} type="button" onClick={() => setSelected(warning)} className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-[#c9a227] bg-[#c9a227]/15" : "border-white/10 bg-black/15 hover:bg-white/[0.06]"}`}>
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
                    <div><div className="text-xs font-black uppercase tracking-[0.16em] text-[#c9a227]">{selected.area} WARNING</div><h2 className="mt-1 text-2xl font-black">{selected.number}</h2>{selected.issueDate && <div className="mt-1 text-xs font-bold text-slate-500">ISSUED {selected.issueDate}</div>}</div>
                    <span className="w-fit rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-300">Active on NGA source</span>
                  </div>
                  <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-[13px] font-semibold leading-6 text-slate-200">{selected.body}</pre>
                </>
              ) : (
                <div className="grid h-full min-h-[420px] place-items-center text-center"><div><div className="text-3xl">◫</div><div className="mt-3 text-sm font-black uppercase tracking-[0.14em] text-slate-400">Select a warning</div><p className="mt-2 text-sm font-semibold text-slate-600">The original warning text will appear here.</p></div></div>
              )}
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-xs font-bold leading-5 text-amber-100/80">
          SUPPLEMENTAL MSI DISPLAY • NOT A REPLACEMENT FOR APPROVED GMDSS EQUIPMENT • VERIFY SAFETY-CRITICAL INFORMATION USING REQUIRED SHIPBOARD GMDSS RECEIVERS AND OFFICIAL BROADCAST SERVICES
        </section>
      </div>
    </main>
  );
}
