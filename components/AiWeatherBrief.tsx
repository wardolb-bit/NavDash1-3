"use client";

import { useRef, useState } from "react";

type OwnShipContext = {
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number | null;
};

type WeatherContext = {
  generatedAt?: string;
  nws?: {
    forecastName?: string;
    forecastLocation?: string;
    detailedForecast?: string;
    shortForecast?: string;
    windSpeedText?: string;
    windDirection?: string;
    forecastWindKt?: number | null;
  };
  ndbc?: {
    station?: string;
    distanceNm?: number;
    windKt?: number | null;
    gustKt?: number | null;
    waveFt?: number | null;
  };
  pacific?: {
    summarySource?: string;
    summaryMode?: string;
    summaryText?: string;
    parsed?: {
      maxWindKt?: number | null;
      maxSeasFt?: number | null;
      windDisplayText?: string;
      seasDisplayText?: string;
      warnings?: string[];
    };
  };
};

type Props = {
  nightMode: boolean;
  ownShip: OwnShipContext;
  weatherData: WeatherContext | null;
};

type BriefResponse = {
  ok: boolean;
  summary?: string;
  model?: string;
  generatedAt?: string;
  sourceName?: string;
  error?: string;
};

export default function AiWeatherBrief({ nightMode, ownShip, weatherData }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ model?: string; generatedAt?: string; sourceName?: string }>({});

  const panelClass = nightMode
    ? "mt-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5"
    : "mt-4 rounded-2xl border border-slate-300 bg-white p-5";

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

  async function analyze() {
    if (!file) {
      setError("Select an AMI weather PDF first.");
      return;
    }

    setLoading(true);
    setError("");
    setSummary("");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "context",
        JSON.stringify({
          ownShip,
          weather: weatherData,
        }),
      );

      const response = await fetch("/api/ai-weather-brief", {
        method: "POST",
        body: form,
      });

      const json = (await response.json()) as BriefResponse;
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `${response.status} ${response.statusText}`);
      }

      setSummary(json.summary || "No summary returned.");
      setMeta({ model: json.model, generatedAt: json.generatedAt, sourceName: json.sourceName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI weather brief failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={panelClass}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className={`text-2xl font-bold uppercase tracking-[0.25em] ${label}`}>AI Weather Brief</p>
          <h2 className="mt-2 text-3xl font-black">AMI Route Forecast Analyzer</h2>
          <p className={`mt-2 max-w-5xl text-2xl ${muted}`}>
            Load the AMI PDF and NavDash will summarize it against the live vessel position, COG/SOG, and the weather context already loaded on this page.
          </p>
        </div>
        <div className={`max-w-xl text-2xl ${muted}`}>
          AI interpretation is advisory only. The uploaded AMI report and official source products remain the controlling weather information.
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_auto]">
        <div className={innerClass}>
          <p className={`text-2xl uppercase tracking-[0.2em] ${label}`}>Source Report</p>
          <p className="mt-2 text-2xl font-semibold">{file?.name || "No AMI PDF selected"}</p>
          <p className={`mt-1 text-xl ${muted}`}>
            PDF only, maximum 20 MB. The file is sent to the server only when Analyze is pressed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0] || null;
              setFile(selected);
              setSummary("");
              setError("");
              setMeta({});
            }}
          />
          <button type="button" className={secondaryButton} onClick={() => inputRef.current?.click()}>
            Load AMI PDF
          </button>
          <button type="button" className={primaryButton} disabled={!file || loading} onClick={analyze}>
            {loading ? "Analyzing..." : "Analyze Weather"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-400/50 bg-red-950/30 p-4 text-2xl text-red-100">{error}</div>
      ) : null}

      {summary ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-2xl font-bold uppercase tracking-[0.2em] ${label}`}>AI Interpretation</p>
            <p className={`text-xl ${muted}`}>
              {meta.sourceName || file?.name}
              {meta.model ? ` | ${meta.model}` : ""}
              {meta.generatedAt ? ` | ${new Date(meta.generatedAt).toLocaleString()}` : ""}
            </p>
          </div>
          <pre className={outputClass}>{summary}</pre>
          <p className={`mt-3 text-xl ${muted}`}>
            Verify routing decisions, warnings, wind, seas, and timing against the original AMI report and official bridge sources before acting.
          </p>
        </div>
      ) : null}
    </section>
  );
}
