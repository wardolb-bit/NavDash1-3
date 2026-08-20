"use client";

import { useEffect, useMemo, useState } from "react";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type DeckLogEntry = {
  id: string;
  timeUtc: string;
  timeLocal?: string;
  category: string;
  text: string;
  author: string;
  createdAt: string;
};

const DECK_LOG_CATEGORIES = ["Deck", "Cargo", "Mooring", "Gangway", "Bunkers", "Weather", "Security", "Engineering", "Other"];

function formatFallbackTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function deckLogTime(entry: DeckLogEntry) {
  return entry.timeLocal || formatFallbackTime(entry.timeUtc);
}

function csvCell(value: string) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

export default function DeckLogPage() {
  const { nightMode, dayMode, toggleTheme } = useBridgeTheme();
  const [entries, setEntries] = useState<DeckLogEntry[]>([]);
  const [status, setStatus] = useState("Loading deck log");
  const [category, setCategory] = useState("Deck");
  const [author, setAuthor] = useState("Bridge");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const theme = nightMode
    ? {
        page: "min-h-screen bg-[#071019] p-4 text-slate-100 md:p-6",
        panel: "rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-xl shadow-black/25 backdrop-blur-xl",
        card: "rounded-2xl border border-white/10 bg-black/25 p-4",
        button: "rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-slate-100 hover:bg-white/15",
        primary: "rounded-xl border border-amber-700 bg-[#c9a227] px-4 py-3 text-sm font-black text-[#111827] shadow-lg shadow-[#c9a227]/20 hover:brightness-110 disabled:opacity-50",
        input: "rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-slate-100 outline-none focus:border-[#c9a227]",
        label: "text-xs font-bold uppercase tracking-[.18em] text-slate-400",
        muted: "text-slate-400",
        value: "text-white",
        tableHead: "bg-white/10 text-slate-300",
        row: "border-t border-white/10",
      }
    : {
        page: "min-h-screen bg-white p-4 text-slate-950 md:p-6",
        panel: "rounded-2xl border border-slate-300 bg-white p-4 shadow-sm",
        card: "rounded-2xl border border-slate-300 bg-slate-50 p-4",
        button: "rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-black text-slate-900 hover:bg-white",
        primary: "rounded-xl border border-amber-700 bg-[#c9a227] px-4 py-3 text-sm font-black text-[#111827] shadow-sm hover:brightness-105 disabled:opacity-50",
        input: "rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-950 outline-none focus:border-[#c9a227]",
        label: "text-xs font-bold uppercase tracking-[.18em] text-slate-500",
        muted: "text-slate-500",
        value: "text-slate-950",
        tableHead: "bg-slate-100 text-slate-600",
        row: "border-t border-slate-200",
      };

  const entryCountText = useMemo(() => `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`, [entries.length]);

  async function loadDeckLog() {
    try {
      setStatus("Loading deck log");
      const response = await fetch("/api/deck-log", { cache: "no-store" });
      if (!response.ok) throw new Error(`Deck log API returned ${response.status}`);
      const data = await response.json();
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
      setStatus("Deck log loaded");
    } catch {
      setStatus("Deck log unavailable");
    }
  }

  async function addEntry() {
    if (!text.trim()) return;

    const now = new Date().toISOString();
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timeUtc: now,
      category,
      text: text.trim(),
      author: author.trim() || "Bridge",
      createdAt: now,
    };

    try {
      setSaving(true);
      setStatus("Saving entry");
      const response = await fetch("/api/deck-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Deck log API returned ${response.status}`);
      const data = await response.json();
      setEntries(Array.isArray(data?.entries) ? data.entries : [payload, ...entries]);
      setText("");
      setStatus("Entry saved");
    } catch {
      setStatus("Entry save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    try {
      setStatus("Deleting entry");
      const response = await fetch(`/api/deck-log?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Deck log API returned ${response.status}`);
      const data = await response.json();
      setEntries(Array.isArray(data?.entries) ? data.entries : entries.filter((entry) => entry.id !== id));
      setStatus("Entry deleted");
    } catch {
      setStatus("Delete failed");
    }
  }

  function exportCsv() {
    const rows = [
      ["Local Time", "UTC Time", "Category", "Author", "Entry"],
      ...entries.map((entry) => [deckLogTime(entry), entry.timeUtc, entry.category, entry.author, entry.text]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `navdash-deck-log-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    loadDeckLog();
  }, []);

  return (
    <main className={theme.page}>
      <div className="mx-auto max-w-[1500px]">
        <header className={`${theme.panel} mb-4`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.42em] text-[#c9a227]">NavDash Operations</div>
              <h1 className={`text-3xl font-black tracking-tight ${theme.value}`}>Deck Log</h1>
              <div className={`mt-1 text-sm ${theme.muted}`}>Shared operations log saved on the NavDash host.</div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[560px]">
              <div className={theme.card}>
                <div className={theme.label}>Status</div>
                <div className="mt-1 font-mono text-sm font-black">{status}</div>
              </div>
              <div className={theme.card}>
                <div className={theme.label}>Entries</div>
                <div className="mt-1 font-mono text-xl font-black">{entryCountText}</div>
              </div>
              <div className={theme.card}>
                <div className={theme.label}>Clock</div>
                <div className="mt-1 font-mono text-sm font-black">Host Local</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className={theme.button} onClick={loadDeckLog}>Refresh</button>
              <button type="button" className={theme.button} onClick={exportCsv} disabled={!entries.length}>Export CSV</button>
              <button type="button" className={theme.button} onClick={toggleTheme}>
                {dayMode ? "Bridge Night" : "Day Mode"}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[.8fr_1.25fr]">
          <div className={theme.panel}>
            <div className={theme.label}>New Entry</div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-2">
                <span className={theme.label}>Category</span>
                <select className={theme.input} value={category} onChange={(event) => setCategory(event.target.value)}>
                  {DECK_LOG_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className={theme.label}>Initials / Source</span>
                <input className={theme.input} value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="AB / Bridge / Cargo" />
              </label>

              <label className="grid gap-2">
                <span className={theme.label}>Entry</span>
                <textarea
                  className={`${theme.input} min-h-[180px] resize-y`}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Example: 1420 commenced loading stores port side. Weather clear, deck dry."
                />
              </label>

              <button type="button" className={theme.primary} onClick={addEntry} disabled={saving || !text.trim()}>
                {saving ? "Saving" : "Add Entry"}
              </button>
            </div>
          </div>

          <div className={theme.panel}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={theme.label}>Entries</div>
                <h2 className={`mt-1 text-2xl font-black ${theme.value}`}>Running Operations Log</h2>
              </div>
              <button type="button" className={theme.button} onClick={loadDeckLog}>Refresh</button>
            </div>

            <div className="mt-4 max-h-[68vh] overflow-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className={theme.tableHead}>
                  <tr>
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Entry</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr><td colSpan={5} className={`p-6 text-center ${theme.muted}`}>No deck log entries yet.</td></tr>
                  ) : (
                    entries.map((entry) => (
                      <tr key={entry.id} className={theme.row}>
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{deckLogTime(entry)}</td>
                        <td className="px-3 py-3 font-black text-[#c9a227]">{entry.category}</td>
                        <td className="px-3 py-3">{entry.author}</td>
                        <td className="px-3 py-3 leading-6">{entry.text}</td>
                        <td className="px-3 py-3 text-right">
                          <button type="button" className="rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-black text-red-100 hover:bg-red-500/25" onClick={() => deleteEntry(entry.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
