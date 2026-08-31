"use client";

import { useEffect, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";
import { useBridgeTheme } from "../lib/useBridgeTheme";

type OwnShip = {
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number | null;
};

type BriefResponse = {
  ok: boolean;
  summary?: string;
  model?: string;
  generatedAt?: string;
  sourceName?: string;
  error?: string;
};

function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function getUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function getSigned(bits: string, start: number, length: number) {
  const value = getUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}

function decodeAisPosition(sentence: string): OwnShip | null {
  try {
    const parts = sentence.split(",");
    if (parts.length < 6 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const messageType = getUnsigned(bits, 0, 6);
    if (![1, 2, 3].includes(messageType)) return null;

    const sog = getUnsigned(bits, 50, 10) / 10;
    const lon = getSigned(bits, 61, 28) / 600000;
    const lat = getSigned(bits, 89, 27) / 600000;
    const cog = getUnsigned(bits, 116, 12) / 10;
    const headingRaw = getUnsigned(bits, 128, 9);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return { lat, lon, sog, cog, heading: headingRaw === 511 ? null : headingRaw };
  } catch {
    return null;
  }
}

export default function AiWeatherBrief() {
  const { nightMode } = useBridgeTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [ownShip, setOwnShip] = useState<OwnShip>({});
  const [meta, setMeta] = useState<{ model?: string; generatedAt?: string; sourceName?: string }>({});

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onmessage = (event) => {
      try {
        let msg: any = event.data;
        try {
          msg = JSON.parse(event.data);
        } catch {
          // Plain NMEA is supported below.
        }

        const lat = Number(msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude);
        const lon = Number(msg?.lon ?? msg?.lng ?? msg?.longitude ?? msg?.position?.lon ?? msg?.position?.lng ?? msg?.position?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setOwnShip({
            lat,
            lon,
            sog: Number.isFinite(Number(msg?.sog ?? msg?.speed)) ? Number(msg?.sog ?? msg?.speed) : undefined,
            cog: Number.isFinite(Number(msg?.cog ?? msg?.course)) ? Number(msg?.cog ?? msg?.course) : undefined,
            heading: Number.isFinite(Number(msg?.heading ?? msg?.hdg)) ? Number(msg?.heading ?? msg?.hdg) : null,
          });
          return;
        }

        const nmeaLine = typeof msg === "string" ? msg.trim() : typeof msg?.line === "string" ? msg.line.trim() : "";
        if (nmeaLine.startsWith("!AIVDO")) {
          const decoded = decodeAisPosition(nmeaLine);
          if (decoded) setOwnShip(decoded);
        }
      } catch {
        // AI brief must never interfere with the WX page if AIS data is malformed.
      }
    };

    return () => ws.close();
  }, []);

  const shellClass = nightMode
    ? "fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/95 p-4 text-slate-100 backdrop-blur-xl"
    : "fixed inset-0 z-[1000] overflow-y-auto bg-white/95 p-4 text-slate-950 backdrop-blur-xl";
  const panelClass = nightMode
    ? "mx-auto max-w-7xl rounded-[2rem] border border-cyan-400/20 bg-slate-900/90 p-5 shadow-2xl"
    : "mx-auto max-w-7xl rounded-[2rem] border border-slate-300 bg-white p-5 shadow-2xl";
  const innerClass = nightMode
    ? "rounded-xl border border-slate-700/70 bg-slate-950/50 p-4"
    : "rounded-xl border border-slate-300 bg-slate-50 p-4";
  const primaryButton = nightMode
    ? "rounded-2xl bg-cyan-300 px-6 py-4 text-2xl font-black text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
    : "rounded-2xl bg-slate-900 px-6 py-4 text-2xl font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButton = nightMode
    ? "rounded-2xl border border-white/10 bg-white/10 px-6 py-4 text-2xl font-bold text-slate-100 hover:bg-white/15"
    : "rounded-2xl border border-slate-300 bg-slate-100 px-6 py-4 text-2xl font-bold text-slate-900 hover:bg-white";
  const muted = nightMode ? "text-slate-400" : "text-slate-600";
  const label = nightMode ? "text-cyan-300/80" : "text-slate-500";
  const outputClass = nightMode
    ? "mt-4 whitespace-pre-wrap rounded-xl border border-cyan-400/20 bg-slate-950/70 p-5 font-mono text-xl leading-relaxed text-slate-100"
    : "mt-4 whitespace-pre-wrap rounded-xl border border-slate-300 bg-slate-50 p-5 font-mono text-xl leading-relaxed text-slate-950";
  const launcherClass = nightMode
    ? "fixed bottom-5 right-5 z-[900] rounded-2xl border border-cyan-200/30 bg-cyan-300 px-6 py-4 text-xl font-black text-slate-950 shadow-2xl shadow-black/40 hover:bg-cyan-200"
    : "fixed bottom-5 right-5 z-[900] rounded-2xl border border-slate-300 bg-slate-900 px-6 py-4 text-xl font-black text-white shadow-2xl hover:bg-slate-700";

  async function analyze() {
    if (!file) {
      setError("Select an AMI weather PDF first.");
      return;
    }

    setLoading(true);
    setError("");
    setSummary("");

    try {
      let weather: any = null;
      if (ownShip.lat !== undefined && ownShip.lon !== undefined) {
        try {
          const wxResponse = await fetch(
            `/api/wx?lat=${encodeURIComponent(ownShip.lat.toFixed(6))}&lon=${encodeURIComponent(ownShip.lon.toFixed(6))}`,
            { cache: "no-store" },
          );
          if (wxResponse.ok) weather = await wxResponse.json();
        } catch {
          // AMI analysis can proceed if live NOAA context is temporarily unavailable.
        }
      }

      const form = new FormData();
      form.append("file", file);
      form.append("context", JSON.stringify({ ownShip, weather }));

      const response = await fetch("/api/ai-weather-brief", { method: "POST", body: form });
      const json = (await response.json()) as BriefResponse;
      if (!response.ok || !json.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);

      setSummary(json.summary || "No summary returned.");
      setMeta({ model: json.model, generatedAt: json.generatedAt, sourceName: json.sourceName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI weather brief failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className={launcherClass} onClick={() => setOpen(true)}>
        AI Weather Brief
      </button>

      {open ? (
        <div className={shellClass} role="dialog" aria-modal="true" aria-label="AI Weather Brief">
          <section className={panelClass}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className={`text-2xl font-bold uppercase tracking-[0.25em] ${label}`}>AI Weather Brief</p>
                <h2 className="mt-2 text-4xl font-black">AMI Route Forecast Analyzer</h2>
                <p className={`mt-2 max-w-5xl text-2xl ${muted}`}>
                  Load an AMI route-weather PDF. NavDash combines the report with live AIS position, COG/SOG, and fresh WX-page context for a concise bridge brief.
                </p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Close</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <div className={innerClass}><p className={`text-xl uppercase ${label}`}>Latitude</p><p className="mt-1 font-mono text-2xl">{ownShip.lat?.toFixed(5) ?? "--"}</p></div>
              <div className={innerClass}><p className={`text-xl uppercase ${label}`}>Longitude</p><p className="mt-1 font-mono text-2xl">{ownShip.lon?.toFixed(5) ?? "--"}</p></div>
              <div className={innerClass}><p className={`text-xl uppercase ${label}`}>SOG</p><p className="mt-1 font-mono text-2xl">{ownShip.sog !== undefined ? `${ownShip.sog.toFixed(1)} kt` : "--"}</p></div>
              <div className={innerClass}><p className={`text-xl uppercase ${label}`}>COG</p><p className="mt-1 font-mono text-2xl">{ownShip.cog !== undefined ? `${Math.round(ownShip.cog).toString().padStart(3, "0")}°T` : "--"}</p></div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_auto]">
              <div className={innerClass}>
                <p className={`text-2xl uppercase tracking-[0.2em] ${label}`}>Source Report</p>
                <p className="mt-2 text-2xl font-semibold">{file?.name || "No AMI PDF selected"}</p>
                <p className={`mt-1 text-xl ${muted}`}>PDF only, maximum 20 MB. The source report remains distinct from the AI interpretation.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setSummary("");
                    setError("");
                    setMeta({});
                  }}
                />
                <button type="button" className={secondaryButton} onClick={() => inputRef.current?.click()}>Load AMI PDF</button>
                <button type="button" className={primaryButton} disabled={!file || loading} onClick={analyze}>
                  {loading ? "Analyzing..." : "Analyze Weather"}
                </button>
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-4 text-xl ${nightMode ? "border-amber-300/25 bg-amber-950/20 text-amber-100" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
              AI interpretation is advisory only. Verify routing decisions, warnings, wind, seas, and timing directly in the AMI report and official bridge sources before acting.
            </div>

            {error ? <div className="mt-4 rounded-xl border border-red-400/50 bg-red-950/30 p-4 text-2xl text-red-100">{error}</div> : null}

            {summary ? (
              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>AI Interpretation</p>
                  <p className={`text-xl ${muted}`}>
                    {meta.sourceName || file?.name}{meta.model ? ` | ${meta.model}` : ""}{meta.generatedAt ? ` | ${new Date(meta.generatedAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <pre className={outputClass}>{summary}</pre>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
