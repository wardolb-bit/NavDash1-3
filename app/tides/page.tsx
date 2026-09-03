"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";
import styles from "./tides.module.css";

type TidePoint = { time: string; valueFt: number; type?: string };
type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceNm?: number;
  type?: string;
  referenceId?: string;
  timezoneCorr?: number | null;
};
type TideResponse = {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  station?: TideStation;
  stations?: TideStation[];
  datum?: string;
  units?: string;
  timeZone?: string;
  hourly?: TidePoint[];
  highLow?: TidePoint[];
};
type Position = { lat: number; lon: number; updatedAt: number };

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}
function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}
function payloadBits(payload: string) {
  return payload.split("").map((char) => {
    let value = char.charCodeAt(0) - 48;
    if (value > 40) value -= 8;
    return value.toString(2).padStart(6, "0");
  }).join("");
}
function decodeOwnShip(line: string): Position | null {
  if (!line.startsWith("!AIVDO")) return null;
  const parts = line.split(",");
  if (Number(parts[1]) !== 1 || !parts[5]) return null;
  try {
    const bits = payloadBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    let lon = 0;
    let lat = 0;
    if ([1, 2, 3].includes(type)) {
      lon = signed(bits, 61, 28) / 600000;
      lat = signed(bits, 89, 27) / 600000;
    } else if ([18, 19].includes(type)) {
      lon = signed(bits, 57, 28) / 600000;
      lat = signed(bits, 85, 27) / 600000;
    } else return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;
    return { lat, lon, updatedAt: Date.now() };
  } catch {
    return null;
  }
}
function parseStationTime(value: string) {
  const [datePart, timePart = "00:00"] = value.trim().split(/\s+/);
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
function fmtTime(value?: string) {
  if (!value) return "--";
  const d = parseStationTime(value);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDate(value?: string) {
  if (!value) return "--";
  const d = parseStationTime(value);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function timezoneLabel(offset?: number | null) {
  if (offset === null || offset === undefined || !Number.isFinite(offset)) return "LST/LDT";
  const sign = offset <= 0 ? "−" : "+";
  return `UTC${sign}${Math.abs(offset)}`;
}
function interpolate(points: TidePoint[], now: Date) {
  if (!points.length) return null;
  const timed = points.map((p) => ({ ...p, ms: parseStationTime(p.time).getTime() })).sort((a, b) => a.ms - b.ms);
  const t = now.getTime();
  if (t <= timed[0].ms) return timed[0].valueFt;
  if (t >= timed[timed.length - 1].ms) return timed[timed.length - 1].valueFt;
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].ms >= t) {
      const a = timed[i - 1];
      const b = timed[i];
      const ratio = (t - a.ms) / (b.ms - a.ms || 1);
      return a.valueFt + (b.valueFt - a.valueFt) * ratio;
    }
  }
  return null;
}
function TideChart({ points, now }: { points: TidePoint[]; now: Date }) {
  const width = 900;
  const height = 360;
  const pad = 36;
  const data = points.slice().sort((a, b) => parseStationTime(a.time).getTime() - parseStationTime(b.time).getTime());
  if (data.length < 2) return <div className={styles.emptyChart}>Waiting for NOAA tide predictions…</div>;
  const times = data.map((p) => parseStationTime(p.time).getTime());
  const values = data.map((p) => p.valueFt);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spanV = Math.max(0.5, maxV - minV);
  const x = (t: number) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - minV) / spanV) * (height - pad * 2);
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(parseStationTime(p.time).getTime()).toFixed(1)},${y(p.valueFt).toFixed(1)}`).join(" ");
  const nowX = x(Math.min(maxT, Math.max(minT, now.getTime())));
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="NOAA predicted tide curve">
      {[0, 1, 2, 3, 4].map((i) => {
        const yy = pad + ((height - pad * 2) * i) / 4;
        return <line key={i} x1={pad} x2={width - pad} y1={yy} y2={yy} className={styles.gridLine} />;
      })}
      <path d={path} className={styles.tideLine} />
      <line x1={nowX} x2={nowX} y1={pad} y2={height - pad} className={styles.nowLine} />
      <text x={nowX + 6} y={pad + 14} className={styles.nowLabel}>NOW</text>
      <text x={pad} y={height - 10} className={styles.axisLabel}>{fmtTime(data[0]?.time)}</text>
      <text x={width - pad} y={height - 10} textAnchor="end" className={styles.axisLabel}>{fmtTime(data[data.length - 1]?.time)}</text>
      <text x={pad} y={20} className={styles.axisLabel}>{maxV.toFixed(1)} ft</text>
      <text x={pad} y={height - pad - 7} className={styles.axisLabel}>{minV.toFixed(1)} ft</text>
    </svg>
  );
}

export default function TidesPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const [position, setPosition] = useState<Position | null>(null);
  const [manualLat, setManualLat] = useState("21.33");
  const [manualLon, setManualLon] = useState("-157.967");
  const [data, setData] = useState<TideResponse | null>(null);
  const [stationId, setStationId] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TideStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  const lastLookupRef = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(getAisWebSocketUrl());
        ws.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const parsed = JSON.parse(raw);
            raw = typeof parsed === "string" ? parsed : parsed?.sentence || parsed?.nmea || parsed?.raw || parsed?.line || raw;
          } catch {}
          for (const sourceLine of raw.split(/\r?\n/)) {
            const decoded = decodeOwnShip(sourceLine.trim());
            if (decoded) setPosition(decoded);
          }
        };
        ws.onclose = () => { if (!closed) retry = window.setTimeout(connect, 2500); };
      } catch {
        retry = window.setTimeout(connect, 2500);
      }
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, []);

  async function loadTides(pos: Position, station = stationId) {
    const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)},${station}`;
    if (lastLookupRef.current === key && data?.ok) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ lat: String(pos.lat), lon: String(pos.lon) });
      if (station) params.set("station", station);
      const res = await fetch(`/api/tides?${params}`, { cache: "no-store" });
      const json: TideResponse = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Tide lookup failed.");
      setData(json);
      setStationId(json.station?.id || station);
      lastLookupRef.current = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)},${json.station?.id || station}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!position) return;
    const timer = window.setTimeout(() => loadTides(position, stationId), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lon]);

  async function searchStations() {
    if (!position || search.trim().length < 2) return;
    try {
      const params = new URLSearchParams({ lat: String(position.lat), lon: String(position.lon), q: search.trim() });
      const res = await fetch(`/api/tides?${params}`, { cache: "no-store" });
      const json = await res.json();
      setSearchResults(Array.isArray(json?.stations) ? json.stations : []);
    } catch {
      setSearchResults([]);
    }
  }

  const highLow = data?.highLow || [];
  const hourly = data?.hourly || [];
  const currentHeight = interpolate(hourly, now);
  const future = highLow.filter((p) => parseStationTime(p.time).getTime() >= now.getTime());
  const nextHigh = future.find((p) => p.type === "H");
  const nextLow = future.find((p) => p.type === "L");
  const rising = (() => {
    if (hourly.length < 2) return null;
    const futureHourly = hourly.find((p) => parseStationTime(p.time).getTime() > now.getTime());
    return futureHourly && currentHeight !== null ? futureHourly.valueFt >= currentHeight : null;
  })();
  const grouped = useMemo(() => {
    const map = new Map<string, TidePoint[]>();
    highLow.forEach((p) => {
      const key = fmtDate(p.time);
      map.set(key, [...(map.get(key) || []), p]);
    });
    return Array.from(map.entries()).slice(0, 6);
  }, [highLow]);

  const station = data?.station;
  const stationDistance = station?.distanceNm;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <div className={styles.eyebrow}>NAVDASH • NOAA CO-OPS</div>
          <h1>Tides</h1>
        </div>
        <div className={styles.actions}>
          <Link href="/" className={styles.button}>Nav Dash</Link>
          <button className={styles.button} onClick={toggleTheme}>{nightMode ? "Day" : "Bridge Night"}</button>
          <button className={styles.button} onClick={() => window.print()}>Print Tide Sheet</button>
        </div>
      </header>

      {!position && (
        <section className={styles.manualCard}>
          <div><strong>AIS position not received yet.</strong><span> Enter a position to test the tide page.</span></div>
          <div className={styles.manualInputs}>
            <input aria-label="Latitude" value={manualLat} onChange={(e) => setManualLat(e.target.value)} />
            <input aria-label="Longitude" value={manualLon} onChange={(e) => setManualLon(e.target.value)} />
            <button onClick={() => {
              const lat = Number(manualLat); const lon = Number(manualLon);
              if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setPosition({ lat, lon, updatedAt: Date.now() });
            }}>Use Position</button>
          </div>
        </section>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.stationBanner}>
        <div>
          <div className={styles.stationName}>{station?.name || (loading ? "Finding nearest tide station…" : "Waiting for vessel position")}</div>
          <div className={styles.stationMeta}>
            {station ? `NOAA ${station.id} • ${data?.datum || "MLLW"} • ${timezoneLabel(station.timezoneCorr)} • ${stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM from vessel` : "distance unavailable"}` : "Nearest valid NOAA tide prediction station will be selected automatically."}
          </div>
        </div>
        <div className={styles.stationSearch}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchStations(); }} placeholder="Search NOAA station" />
          <button onClick={searchStations} disabled={!position || search.trim().length < 2}>Search</button>
        </div>
      </section>

      {searchResults.length > 0 && (
        <section className={styles.searchResults}>
          {searchResults.map((s) => (
            <button key={s.id} onClick={() => { setSearchResults([]); setSearch(""); setStationId(s.id); if (position) loadTides(position, s.id); }}>
              <span>{s.name}</span><small>{s.id} • {s.distanceNm?.toFixed(1) ?? "--"} NM</small>
            </button>
          ))}
        </section>
      )}

      <section className={styles.heroGrid}>
        <div className={styles.chartCard}>
          <div className={styles.statusRow}>
            <div>
              <div className={styles.tideState}>{rising === null ? "TIDE" : rising ? "FLOODING" : "EBBING"}</div>
              <div className={styles.currentHeight}>{currentHeight === null ? "--" : currentHeight.toFixed(1)} <span>ft</span></div>
              <div className={styles.muted}>Predicted height • {data?.datum || "MLLW"}</div>
            </div>
            <div className={styles.nowTime}>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
          </div>
          <TideChart points={hourly} now={now} />
        </div>

        <aside className={styles.sideCard}>
          <div className={styles.nextBlock}><span>Next High</span><strong>{nextHigh ? `${nextHigh.valueFt.toFixed(1)} ft` : "--"}</strong><small>{nextHigh ? `${fmtDate(nextHigh.time)} • ${fmtTime(nextHigh.time)}` : "No event in range"}</small></div>
          <div className={styles.nextBlock}><span>Next Low</span><strong>{nextLow ? `${nextLow.valueFt.toFixed(1)} ft` : "--"}</strong><small>{nextLow ? `${fmtDate(nextLow.time)} • ${fmtTime(nextLow.time)}` : "No event in range"}</small></div>
          <div className={styles.sourceBlock}><span>Source</span><strong>NOAA CO-OPS</strong><small>Official Tide Predictions • {data?.timeZone || "LST/LDT"}</small></div>
        </aside>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.tableCard}>
          <h2>High / Low Predictions</h2>
          <div className={styles.days}>
            {grouped.map(([day, events]) => (
              <div key={day} className={styles.dayRow}>
                <div className={styles.dayLabel}>{day}</div>
                <div className={styles.events}>{events.map((event, idx) => <div key={`${event.time}-${idx}`} className={styles.event}><span className={event.type === "H" ? styles.high : styles.low}>{event.type === "H" ? "HIGH" : "LOW"}</span><strong>{fmtTime(event.time)}</strong><span>{event.valueFt.toFixed(1)} ft</span></div>)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.infoCard}>
          <h2>Station / Vessel</h2>
          <dl>
            <div><dt>Station</dt><dd>{station?.name || "--"}</dd></div>
            <div><dt>Station ID</dt><dd>{station?.id || "--"}</dd></div>
            <div><dt>Datum</dt><dd>{data?.datum || "MLLW"}</dd></div>
            <div><dt>Time basis</dt><dd>{timezoneLabel(station?.timezoneCorr)}</dd></div>
            <div><dt>Station type</dt><dd>{station?.type === "S" ? "Subordinate" : station?.type === "R" ? "Reference" : station?.type || "--"}</dd></div>
            <div><dt>Vessel position</dt><dd>{position ? `${position.lat.toFixed(4)}°, ${position.lon.toFixed(4)}°` : "--"}</dd></div>
            <div><dt>Distance</dt><dd>{stationDistance !== undefined ? `${stationDistance.toFixed(1)} NM` : "--"}</dd></div>
          </dl>
          {stationDistance !== undefined && stationDistance > 100 && <div className={styles.warning}>Nearest prediction station is distant from the vessel. Select the destination or port station for operational planning.</div>}
        </div>
      </section>

      <footer className={styles.footer}>Predictions: NOAA CO-OPS • Datum: {data?.datum || "MLLW"} • Times: {timezoneLabel(station?.timezoneCorr)} • Generated: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "--"}</footer>
    </main>
  );
}
