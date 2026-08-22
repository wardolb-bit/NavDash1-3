'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAisWebSocketUrl } from '../../lib/aisWebSocket';
import { useBridgeTheme } from '../../lib/useBridgeTheme';

type OwnShip = {
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number | null;
};

type Waypoint = {
  id?: string;
  name?: string;
  lat: number;
  lon: number;
};

type RouteState = {
  routeName?: string;
  waypoints?: Waypoint[];
  activeWaypointIndex?: number;
};

type PositionLogEntry = {
  lat: number;
  lon: number;
  timestamp: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  receivedAt?: string;
};

const REPORT_TIME_OPTIONS = ['0000', '0600', '1200', '1800'];
const FULLSCREEN_PREF_KEY = 'navconsole-fullscreen';
const ETA_DESTINATION_STORAGE_KEY = 'position-report-eta-destination-v1';
const VESSEL_CREW_CONDITION_STORAGE_KEY = 'position-report-vessel-crew-condition-v1';
const ROUTE_STORAGE_KEY = 'navconsole-saved-route';
const LEGACY_ROUTE_STORAGE_KEY = 'navdash-v12-loaded-route';

function buildUtcReportSubject(reportTimeUtc: string) {
  const now = new Date();
  const day = now.getUTCDate().toString().padStart(2, '0');
  const month = now.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const year = now.getUTCFullYear();
  return `${day}${reportTimeUtc}Z${month}${year}`;
}

function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload.split('').map(char => sixBitCharToValue(char).toString(2).padStart(6, '0')).join('');
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
    const parts = sentence.split(',');
    if (parts.length < 6) return null;
    const payload = parts[5];
    if (!payload) return null;
    const bits = payloadToBits(payload);
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

function padCourse(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value).toString().padStart(3, '0')}°T`;
}

function toDDM(value?: number, type: 'lat' | 'lon' = 'lat') {
  if (value === undefined || Number.isNaN(value)) return '--';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemi = type === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const degWidth = type === 'lat' ? 2 : 3;
  return `${deg.toString().padStart(degWidth, '0')}° ${min.toFixed(3).padStart(6, '0')}' ${hemi}`;
}

function toReportDDM(value?: number, type: 'lat' | 'lon' = 'lat') {
  if (value === undefined || Number.isNaN(value)) return '--';
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const decimalMinutes = (abs - deg) * 60;
  let min = Math.floor(decimalMinutes + 0.5);
  if (min === 60) { deg += 1; min = 0; }
  const hemi = type === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const degWidth = type === 'lat' ? 2 : 3;
  return `${deg.toString().padStart(degWidth, '0')}° ${min.toString().padStart(2, '0')}' ${hemi}`;
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3440.065;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distance?: number | null) {
  if (!distance || Number.isNaN(distance)) return '--';
  return `${distance.toFixed(0)} nm`;
}

function formatFieldLabel(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return spaced.split(' ').map(word => word.toLowerCase() === 'eta' ? 'ETA' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatWindDirection(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '--';
  const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numeric)) return `${Math.round(numeric).toString().padStart(3, '0')}°T`;
  return trimmed.includes('°') ? trimmed : `${trimmed}°T`;
}

function formatWindSpeed(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '--';
  return trimmed.toLowerCase().includes('kt') ? trimmed : `${trimmed} kts`;
}

function formatRangeNm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '--';
  return /\bnm\b/i.test(trimmed) ? trimmed : `${trimmed} nm`;
}

function formatBearingTrue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '--';
  const compact = trimmed.replace(/\s+/g, '');
  if (/°T$/i.test(compact)) return compact.replace(/t$/i, 'T');
  if (/°$/i.test(compact)) return `${compact}T`;
  if (/T$/i.test(compact)) return `${compact.slice(0, -1)}°T`;
  return `${compact}°T`;
}

function safeText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function finiteNumber(value: unknown, fallback = NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readWaypointName(wp: unknown, index: number) {
  if (!wp || typeof wp !== 'object') return `Waypoint ${index + 1}`;
  const record = wp as Record<string, unknown>;
  return safeText(record.name ?? record.waypointName ?? record.label ?? record.id, `Waypoint ${index + 1}`);
}

function readWaypointId(wp: unknown, index: number) {
  if (!wp || typeof wp !== 'object') return `WP${String(index + 1).padStart(2, '0')}`;
  const record = wp as Record<string, unknown>;
  return safeText(record.id ?? record.waypointId ?? record.number, `WP${String(index + 1).padStart(2, '0')}`);
}

function readWaypointCoordinate(wp: unknown, primary: string, secondary: string) {
  if (!wp || typeof wp !== 'object') return NaN;
  const record = wp as Record<string, unknown>;
  const position = record.position && typeof record.position === 'object' ? record.position as Record<string, unknown> : {};
  return finiteNumber(record[primary] ?? record[secondary] ?? position[primary] ?? position[secondary]);
}

function normalizeRouteState(candidate: unknown): RouteState | null {
  try {
    if (!candidate || typeof candidate !== 'object') return null;
    const parsed = candidate as Record<string, unknown>;
    const rawWaypoints = Array.isArray(parsed.waypoints) ? parsed.waypoints : Array.isArray(parsed.route) ? parsed.route : [];
    const waypoints = rawWaypoints.map((wp, index) => ({
      id: readWaypointId(wp, index), name: readWaypointName(wp, index),
      lat: readWaypointCoordinate(wp, 'lat', 'latitude'), lon: readWaypointCoordinate(wp, 'lon', 'longitude'),
    })).filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
    if (waypoints.length < 2) return null;
    const rawIndex = finiteNumber(parsed.activeWaypointIndex, 1);
    const activeWaypointIndex = Math.min(Math.max(Math.round(rawIndex), 1), waypoints.length - 1);
    return { routeName: safeText(parsed.routeName, 'Loaded RTZ Route'), waypoints, activeWaypointIndex };
  } catch { return null; }
}

function loadSavedRoute(): RouteState | null {
  if (typeof window === 'undefined') return null;
  const candidates: string[] = [];
  try { const saved = window.localStorage.getItem(ROUTE_STORAGE_KEY); if (saved) candidates.push(saved); } catch {}
  try { const saved = window.sessionStorage.getItem(ROUTE_STORAGE_KEY); if (saved) candidates.push(saved); } catch {}
  try { const saved = window.localStorage.getItem(LEGACY_ROUTE_STORAGE_KEY); if (saved) candidates.push(saved); } catch {}
  try { const saved = window.sessionStorage.getItem(LEGACY_ROUTE_STORAGE_KEY); if (saved) candidates.push(saved); } catch {}
  for (const candidate of candidates) {
    try { const normalized = normalizeRouteState(JSON.parse(candidate)); if (normalized) return normalized; } catch {}
  }
  return null;
}

function normalizePositionHistory(candidate: unknown): PositionLogEntry[] {
  const entries = Array.isArray(candidate) ? candidate : candidate && typeof candidate === 'object' && Array.isArray((candidate as { entries?: unknown[] }).entries) ? (candidate as { entries: unknown[] }).entries : [];
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const timestamp = Number(item.timestamp);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) return null;
    return {
      lat, lon, timestamp,
      sog: Number.isFinite(Number(item.sog)) ? Number(item.sog) : null,
      cog: Number.isFinite(Number(item.cog)) ? Number(item.cog) : null,
      heading: Number.isFinite(Number(item.heading)) ? Number(item.heading) : null,
      receivedAt: typeof item.receivedAt === 'string' ? item.receivedAt : undefined,
    };
  }).filter((entry): entry is PositionLogEntry => entry !== null).sort((a, b) => a.timestamp - b.timestamp);
}

export default function PositionReportPage() {
  const [lastWsMessage, setLastWsMessage] = useState('');
  const [ownShip, setOwnShip] = useState<OwnShip>({});
  const [route, setRoute] = useState<RouteState>({});
  const [positionLog, setPositionLog] = useState<PositionLogEntry[]>([]);
  const [positionLogStatus, setPositionLogStatus] = useState('Waiting for wheelhouse history');
  const [reportTimeUtc, setReportTimeUtc] = useState('1800');
  const [copyStatus, setCopyStatus] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { nightMode, toggleTheme } = useBridgeTheme();

  const [manual, setManual] = useState({
    hullNumber: '1232', vesselName: 'MB480', callSign: 'WHDB', fuelConsumed: '',
    vesselCrewCondition: '(16 Crew-Green)- (Vessel-Green)', cargoCondition: 'Green', windDirection: '', windSpeed: '',
    precipitation: '', visibility: '', barometer: '', fuelOnBoard: '', potableWater: '', etaDestination: '',
    nearestLand: '', rangeToNearestLand: '', bearingToNearestLand: '', maintenance: 'None', remarks: 'NTR',
  });

  useEffect(() => {
    try {
      const savedEta = window.localStorage.getItem(ETA_DESTINATION_STORAGE_KEY);
      const savedVesselCrewCondition = window.localStorage.getItem(VESSEL_CREW_CONDITION_STORAGE_KEY);
      setManual(prev => ({ ...prev, etaDestination: savedEta ?? prev.etaDestination, vesselCrewCondition: savedVesselCrewCondition ?? prev.vesselCrewCondition }));
    } catch {}
  }, []);

  useEffect(() => {
    const restoreRoute = () => {
      const savedRoute = loadSavedRoute();
      if (savedRoute) setRoute(savedRoute);
      fetch('/api/route-state', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => {
        const sharedRoute = normalizeRouteState(data); if (sharedRoute) setRoute(sharedRoute);
      }).catch(() => {});
    };
    restoreRoute();
    const retryTimers = [500, 1500, 3000].map(delay => window.setTimeout(restoreRoute, delay));
    window.addEventListener('focus', restoreRoute); window.addEventListener('pageshow', restoreRoute); window.addEventListener('storage', restoreRoute);
    return () => { retryTimers.forEach(timer => window.clearTimeout(timer)); window.removeEventListener('focus', restoreRoute); window.removeEventListener('pageshow', restoreRoute); window.removeEventListener('storage', restoreRoute); };
  }, []);

  useEffect(() => {
    const updateFullscreenState = () => { const active = !!document.fullscreenElement; setIsFullscreen(active); window.localStorage.setItem(FULLSCREEN_PREF_KEY, active ? 'true' : 'false'); };
    updateFullscreenState(); document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); window.localStorage.setItem(FULLSCREEN_PREF_KEY, 'true'); }
      else { await document.exitFullscreen(); window.localStorage.setItem(FULLSCREEN_PREF_KEY, 'false'); }
    } catch {}
  }

  useEffect(() => {
    const wsUrl = getAisWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    const requestHistory = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'position-history-request' }));
    };

    ws.onopen = () => {
      setPositionLogStatus('Requesting wheelhouse history');
      requestHistory();
    };

    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        setLastWsMessage(JSON.stringify(msg).slice(0, 500));

        if (msg.type === 'position-history') {
          const entries = normalizePositionHistory(msg.entries ?? msg);
          setPositionLog(entries);
          setPositionLogStatus(entries.length ? `${entries.length} wheelhouse samples` : 'Collecting wheelhouse samples');
          const latest = entries[entries.length - 1];
          if (latest) setOwnShip(prev => ({
            lat: prev.lat ?? latest.lat, lon: prev.lon ?? latest.lon,
            sog: prev.sog ?? latest.sog ?? undefined, cog: prev.cog ?? latest.cog ?? undefined,
            heading: prev.heading ?? latest.heading ?? null,
          }));
        }

        if (msg.type === 'nmea') {
          const decoded = decodeAisPosition(msg.line);
          if (decoded && String(msg.line).startsWith('!AIVDO')) setOwnShip(decoded);
        }

        if (msg.type === 'route-state') {
          const normalizedRoute = normalizeRouteState(msg);
          if (normalizedRoute) setRoute(normalizedRoute);
        }
      } catch {}
    };

    ws.onerror = () => setPositionLogStatus('Wheelhouse history unavailable');
    ws.onclose = () => setPositionLogStatus(prev => positionLog.length ? prev : 'Wheelhouse AIS disconnected');

    const interval = window.setInterval(requestHistory, 60 * 1000);
    const onFocus = () => requestHistory();
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      ws.close();
    };
  }, []);

  const distanceToGo = useMemo(() => {
    if (!ownShip.lat || !ownShip.lon || !route.waypoints?.length) return null;
    const activeIndex = Math.min(Math.max(route.activeWaypointIndex ?? 1, 1), route.waypoints.length - 1);
    const remaining = route.waypoints.slice(activeIndex);
    if (!remaining.length) return null;
    let total = distanceNm(ownShip.lat, ownShip.lon, remaining[0].lat, remaining[0].lon);
    for (let i = 0; i < remaining.length - 1; i++) total += distanceNm(remaining[i].lat, remaining[i].lon, remaining[i + 1].lat, remaining[i + 1].lon);
    return total;
  }, [ownShip, route]);

  const destinationName = useMemo(() => {
    const waypoints = route.waypoints || []; const finalWaypoint = waypoints[waypoints.length - 1];
    return finalWaypoint ? safeText(finalWaypoint.name, safeText(finalWaypoint.id, 'Final waypoint')) : '--';
  }, [route.waypoints]);

  const speedMadeGoodPast24 = useMemo(() => {
    if (positionLog.length < 2) return null;
    const latest = positionLog[positionLog.length - 1];
    const cutoff = latest.timestamp - 24 * 60 * 60 * 1000;
    const recent = positionLog.filter(entry => entry.timestamp >= cutoff && entry.timestamp <= latest.timestamp);
    if (recent.length < 2) return null;
    let distance = 0;
    for (let i = 0; i < recent.length - 1; i++) distance += distanceNm(recent[i].lat, recent[i].lon, recent[i + 1].lat, recent[i + 1].lon);
    const elapsedHours = (recent[recent.length - 1].timestamp - recent[0].timestamp) / (60 * 60 * 1000);
    return elapsedHours > 0 ? distance / elapsedHours : null;
  }, [positionLog]);

  const livePositionActive = ownShip.lat !== undefined && ownShip.lon !== undefined;

  function updateField(field: keyof typeof manual, value: string) {
    setManual(prev => ({ ...prev, [field]: value }));
    if (field === 'etaDestination') try { window.localStorage.setItem(ETA_DESTINATION_STORAGE_KEY, value); } catch {}
    if (field === 'vesselCrewCondition') try { window.localStorage.setItem(VESSEL_CREW_CONDITION_STORAGE_KEY, value); } catch {}
  }

  const emailSubject = buildUtcReportSubject(reportTimeUtc);
  const windLine = `Wind: ${formatWindDirection(manual.windDirection)} @ ${formatWindSpeed(manual.windSpeed)}`;
  const formattedRangeToNearestLand = formatRangeNm(manual.rangeToNearestLand);
  const formattedBearingToNearestLand = formatBearingTrue(manual.bearingToNearestLand);
  const reportText = [
    `Hull Number: ${manual.hullNumber}`, `Vessel Name: ${manual.vesselName}`, `Call Sign: ${manual.callSign}`,
    `Date/Time Group: ${emailSubject}`, `Latitude: ${toReportDDM(ownShip.lat, 'lat')}`, `Longitude: ${toReportDDM(ownShip.lon, 'lon')}`,
    `Course: ${padCourse(ownShip.cog)}`, `Present Speed: ${ownShip.sog !== undefined ? ownShip.sog.toFixed(1) : '--'}`,
    `Speed Made Good Past 24 Hours: ${speedMadeGoodPast24 !== null ? `${speedMadeGoodPast24.toFixed(1)} kts` : '--'}`,
    `Fuel Consumed Past 24 Hours: ${manual.fuelConsumed}`, `Distance to Go: ${formatDistance(distanceToGo)}`,
    `Condition of Vessel and Crew: ${manual.vesselCrewCondition}`, `Condition of Cargo: ${manual.cargoCondition}`, windLine,
    `Precipitation: ${manual.precipitation}`, `Visibility: ${manual.visibility}`, `Barometer: ${manual.barometer}`,
    `Fuel on Board: ${manual.fuelOnBoard}`, `Potable Water on Board: ${manual.potableWater}`, `Destination: ${destinationName}`,
    `ETA to Destination: ${manual.etaDestination}`, `Nearest Point of Land: ${manual.nearestLand}`,
    `Range and Bearing to Nearest Point of Land: ${formattedRangeToNearestLand} / ${formattedBearingToNearestLand}`,
    `Maintenance or Parts Required: ${manual.maintenance}`, `Remarks/ Messages: ${manual.remarks}`,
  ].join('\n');

  async function copyTextToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); return; } catch {
      const textArea = document.createElement('textarea'); textArea.value = text; textArea.style.position = 'fixed'; textArea.style.opacity = '0';
      document.body.appendChild(textArea); textArea.focus(); textArea.select(); document.execCommand('copy'); document.body.removeChild(textArea);
    }
  }

  async function copyReport() { await copyTextToClipboard(reportText); setCopyStatus('Report copied to clipboard.'); window.setTimeout(() => setCopyStatus(''), 3000); }

  const pageClass = nightMode ? 'min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(201,162,39,.28),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.12),transparent_28%),linear-gradient(135deg,#071019,#101c2b_48%,#071019)] p-6 text-slate-100' : 'min-h-screen bg-white p-6 text-slate-950';
  const panelClass = nightMode ? 'rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl' : 'rounded-[2rem] border border-slate-300 bg-white p-6 shadow-sm';
  const inputClass = nightMode ? 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm text-white outline-none focus:border-wardGold' : 'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-950 outline-none focus:border-wardGold';
  const labelClass = nightMode ? 'text-sm text-slate-200' : 'text-sm text-slate-700';
  const labelTextClass = nightMode ? 'block mb-1 text-xs font-bold uppercase tracking-[.18em] text-slate-400' : 'block mb-1 text-xs font-bold uppercase tracking-[.18em] text-slate-500';

  return (
    <main className={pageClass}>
      <div className="relative z-10 min-h-screen p-5 2xl:p-7">
        <header className={nightMode ? "mb-5 rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-xl console-shadow" : "mb-5 rounded-[2rem] border border-slate-300 bg-white p-5 shadow-sm"}>
          <div className="flex items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-3xl border border-wardGold/45 bg-wardGold/15 text-3xl font-black text-wardGold">P</div>
              <div><div className="text-xs font-bold uppercase tracking-[0.42em] text-wardGold">M/V MB480</div><h1 className={nightMode ? "text-4xl font-black tracking-tight text-white 2xl:text-5xl" : "text-4xl font-black tracking-tight text-slate-950 2xl:text-5xl"}>Position Report</h1><div className={nightMode ? "mt-1 text-sm text-slate-300" : "mt-1 text-sm text-slate-600"}>Bridge watch reporting console</div></div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className={livePositionActive ? nightMode ? "inline-flex h-12 w-[190px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-emerald-300/40 bg-emerald-500/10 px-4 text-sm font-black text-emerald-100" : "inline-flex h-12 w-[190px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-emerald-700 bg-emerald-400 px-4 text-sm font-black text-black" : nightMode ? "inline-flex h-12 w-[190px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-red-300/40 bg-red-500/10 px-4 text-sm font-black text-red-100" : "inline-flex h-12 w-[190px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-red-800 bg-red-500 px-4 text-sm font-black text-black"}>{livePositionActive ? "Live Position Active" : "Position Unavailable"}</div>
              <button onClick={toggleFullscreen} className={nightMode ? "inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 hover:bg-white/15" : "inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-slate-300 bg-slate-100 px-4 text-sm font-black text-slate-900 hover:bg-white"} type="button">{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>
              <button onClick={toggleTheme} className={nightMode ? "inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 hover:bg-white/15" : "inline-flex h-12 w-[156px] flex-none items-center justify-center whitespace-nowrap rounded-2xl border border-slate-300 bg-slate-100 px-4 text-sm font-black text-slate-900 hover:bg-white"} type="button">{nightMode ? "Day Mode" : "Night Mode"}</button>
            </div>
          </div>
        </header>
        <div className="grid w-full grid-cols-2 gap-6">
          <section className={panelClass}>
            <div className={nightMode ? "mb-6 grid grid-cols-2 gap-3 rounded-3xl border border-white/10 bg-black/25 p-4" : "mb-6 grid grid-cols-2 gap-3 rounded-3xl border border-slate-300 bg-slate-50 p-4"}>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Latitude</div><div className="font-mono text-lg">{toDDM(ownShip.lat, 'lat')}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Longitude</div><div className="font-mono text-lg">{toDDM(ownShip.lon, 'lon')}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Course</div><div className="font-mono text-lg">{padCourse(ownShip.cog)}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Present Speed</div><div className="font-mono text-lg">{ownShip.sog !== undefined ? `${ownShip.sog.toFixed(1)} kts` : '--'}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>SMG Past 24 Hours</div><div className="font-mono text-lg">{speedMadeGoodPast24 !== null ? `${speedMadeGoodPast24.toFixed(1)} kts` : '--'}</div><div className={nightMode ? "mt-1 text-xs font-bold text-slate-400" : "mt-1 text-xs font-bold text-slate-500"}>{positionLogStatus}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Distance to Go</div><div className="font-mono text-lg">{formatDistance(distanceToGo)}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Route</div><div className="font-mono text-lg">{safeText(route.routeName, '--')}</div></div>
              <div><div className={nightMode ? "text-xs font-bold uppercase tracking-[.18em] text-slate-400" : "text-xs font-bold uppercase tracking-[.18em] text-slate-500"}>Destination</div><div className="font-mono text-lg">{destinationName}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}><span className={labelTextClass}>Report Time UTC</span><select className={inputClass} value={reportTimeUtc} onChange={e => setReportTimeUtc(e.target.value)}>{REPORT_TIME_OPTIONS.map(option => <option key={option} value={option}>{option}Z</option>)}</select></label>
              {Object.entries(manual).map(([key, value]) => <label key={key} className={labelClass}><span className={labelTextClass}>{formatFieldLabel(key)}</span><input className={inputClass} value={value} onChange={e => updateField(key as keyof typeof manual, e.target.value)} /></label>)}
            </div>
            <div className={nightMode ? "mt-4 rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-slate-300" : "mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-600"}>Report DTG: <span className="font-mono">{emailSubject}</span></div>
            <button onClick={copyReport} className={nightMode ? "mt-6 rounded-2xl border border-wardGold/40 bg-wardGold px-5 py-3 font-black text-[#111827] shadow-lg shadow-wardGold/10 hover:brightness-110" : "mt-6 rounded-2xl border border-[#c9a227]/50 bg-[#c9a227] px-5 py-3 font-black text-slate-950 hover:brightness-105"}>Copy Report</button>
            {copyStatus && <div className={nightMode ? "mt-3 text-sm text-red-300" : "mt-3 text-sm text-emerald-700"}>{copyStatus}</div>}
          </section>
          <section className={panelClass}><h2 className="mb-4 text-xl font-black text-wardGold">Generated Report</h2><pre className={nightMode ? "whitespace-pre-wrap font-mono text-sm leading-5 text-slate-100" : "whitespace-pre-wrap font-mono text-sm leading-5 text-slate-900"}>{reportText}</pre></section>
        </div>
      </div>
    </main>
  );
}
