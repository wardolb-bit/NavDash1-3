"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Waypoint = { id?: string; name?: string; lat: number; lon: number };
type NoaaPoint = {
  lat: number;
  lon: number;
  distanceNm: number;
  windKt: number | null;
  windDirectionDeg: number | null;
  gustKt: number | null;
  waveHeightFt: number | null;
  wavePeriodSec: number | null;
  source: string;
};
type NoaaFrame = { validAt: string; points: NoaaPoint[] };
type NoaaForecast = {
  version: number;
  provider: string;
  product: string;
  generatedAt: string;
  sampleCount: number;
  coveredSampleCount: number;
  frames: NoaaFrame[];
  note?: string | null;
};
type MapView = { lat: number; lon: number; zoom: number };

type PixelOffset = { x: number; y: number };

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const MAP_VIEW_STORAGE_KEY = "navdash-main-map-view-v3";

function normalizeRoute(payload: any): Waypoint[] {
  return (Array.isArray(payload?.waypoints) ? payload.waypoints : [])
    .map((wp: any) => ({
      id: typeof wp?.id === "string" ? wp.id : undefined,
      name: typeof wp?.name === "string" ? wp.name : undefined,
      lat: Number(wp?.lat ?? wp?.latitude),
      lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
    }))
    .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function readRoute() {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (raw) return normalizeRoute(JSON.parse(raw));
  } catch {}
  return [] as Waypoint[];
}

function readMapView(route: Waypoint[]): MapView {
  try {
    const raw = window.sessionStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const view = { lat: Number(parsed?.lat), lon: Number(parsed?.lon), zoom: Number(parsed?.zoom) };
      if (Number.isFinite(view.lat) && Number.isFinite(view.lon) && Number.isFinite(view.zoom)) return view;
    }
  } catch {}
  if (route.length) {
    const mid = route[Math.floor(route.length / 2)];
    return { lat: mid.lat, lon: mid.lon, zoom: 7 };
  }
  return { lat: 21.3, lon: -157.9, zoom: 7 };
}

function mercator(lat: number, lon: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const clipped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin(clipped * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function layerPoint(point: NoaaPoint, view: MapView, width: number, height: number) {
  let lon = point.lon;
  while (lon - view.lon > 180) lon -= 360;
  while (lon - view.lon < -180) lon += 360;
  const center = mercator(view.lat, view.lon, view.zoom);
  const marker = mercator(point.lat, lon, view.zoom);
  return { x: marker.x - center.x + width / 2, y: marker.y - center.y + height / 2 };
}

function sameView(a: MapView, b: MapView) {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7 && Math.abs(a.zoom - b.zoom) < 1e-7;
}

function paneTranslation(element: HTMLElement | null): PixelOffset {
  if (!element) return { x: 0, y: 0 };
  const transform = element.style.transform || getComputedStyle(element).transform || "";
  if (!transform || transform === "none") return { x: 0, y: 0 };

  const matrix3d = /matrix3d\(([^)]+)\)/.exec(transform);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map(Number);
    if (values.length === 16) return { x: values[12] || 0, y: values[13] || 0 };
  }

  const matrix = /matrix\(([^)]+)\)/.exec(transform);
  if (matrix) {
    const values = matrix[1].split(",").map(Number);
    if (values.length === 6) return { x: values[4] || 0, y: values[5] || 0 };
  }

  const translate3d = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/i.exec(transform);
  if (translate3d) return { x: Number(translate3d[1]) || 0, y: Number(translate3d[2]) || 0 };

  const translate = /translate\(\s*(-?[\d.]+)px(?:,|\s)\s*(-?[\d.]+)px/i.exec(transform);
  if (translate) return { x: Number(translate[1]) || 0, y: Number(translate[2]) || 0 };

  return { x: 0, y: 0 };
}

function paneIsSettled(element: HTMLElement | null) {
  const offset = paneTranslation(element);
  return Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5;
}

function validLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${String(date.getUTCDate()).padStart(2, "0")} ${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${String(date.getUTCHours()).padStart(2, "0")}00Z`;
}

function windSpeedText(point: NoaaPoint) {
  return point.windKt === null ? "WIND -- KT" : `WIND ${Math.round(point.windKt)} KT`;
}

function gustText(point: NoaaPoint) {
  return point.gustKt === null ? "" : `GUST ${Math.round(point.gustKt)} KT`;
}

function directionText(point: NoaaPoint) {
  const dir = point.windDirectionDeg === null ? "---" : String(Math.round(point.windDirectionDeg)).padStart(3, "0");
  return `DIR ${dir}°`;
}

export function NoaaLeafletPaneWeatherOverlay() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [markerPane, setMarkerPane] = useState<HTMLElement | null>(null);
  const [mapPane, setMapPane] = useState<HTMLElement | null>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [forecast, setForecast] = useState<NoaaForecast | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [showSeas, setShowSeas] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [anchorView, setAnchorView] = useState<MapView>({ lat: 21.3, lon: -157.9, zoom: 7 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const anchorViewRef = useRef<MapView>({ lat: 21.3, lon: -157.9, zoom: 7 });
  const pendingViewRef = useRef<MapView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const find = () => {
      if (cancelled) return;
      const element = document.getElementById("v12-map");
      const isolated = element?.querySelector("#navmap-main-isolated-v2") as HTMLElement | null;
      const pane = isolated?.querySelector(".leaflet-marker-pane") as HTMLElement | null;
      const movingPane = isolated?.querySelector(".leaflet-map-pane") as HTMLElement | null;
      if (element && pane && movingPane) {
        const initialRoute = readRoute();
        const initialView = readMapView(initialRoute);
        setHost(element);
        setMarkerPane(pane);
        setMapPane(movingPane);
        setRoute(initialRoute);
        setAnchorView(initialView);
        anchorViewRef.current = initialView;
        return;
      }
      timer = window.setTimeout(find, 100);
    };
    find();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!host || !markerPane || !mapPane) return;

    const sync = () => {
      const nextRoute = readRoute();
      setRoute((current) => JSON.stringify(current) === JSON.stringify(nextRoute) ? current : nextRoute);

      const nextView = readMapView(nextRoute);
      if (!sameView(anchorViewRef.current, nextView)) pendingViewRef.current = nextView;

      // Leaflet moves the whole pane while dragging/zooming, then resets the pane and
      // updates its pixel origin. Only replace our layer coordinates after that reset.
      // This avoids both the double-pan and the zoom/disappear failure.
      const pending = pendingViewRef.current;
      if (pending && paneIsSettled(mapPane) && paneIsSettled(markerPane)) {
        anchorViewRef.current = pending;
        pendingViewRef.current = null;
        setAnchorView(pending);
      }

      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };

    sync();
    const timer = window.setInterval(sync, 50);
    window.addEventListener("resize", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", sync);
    };
  }, [host, markerPane, mapPane]);

  const routeSignature = useMemo(() => route.map((wp) => `${wp.lat.toFixed(5)},${wp.lon.toFixed(5)}`).join(";"), [route]);

  useEffect(() => {
    if (!routeSignature || route.length < 2) { setForecast(null); setVisible(false); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/noaa-route-weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: route }),
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "NOAA route weather unavailable");
        if (!cancelled) { setForecast(data); setSelectedIndex(0); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "NOAA route weather unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [routeSignature]);

  if (!host || !markerPane) return null;
  const frame = forecast?.frames?.[Math.min(selectedIndex, Math.max(0, (forecast?.frames?.length || 1) - 1))] || null;

  const markers = visible && frame ? createPortal(
    <>
      {frame.points.map((point, index) => {
        const pos = layerPoint(point, anchorView, size.width, size.height);
        return (
          <div
            key={`${point.lat}-${point.lon}-${index}`}
            title={`${validLabel(frame.validAt)} | ${windSpeedText(point)}${point.gustKt === null ? "" : ` | ${gustText(point)}`} | ${directionText(point)} | Seas ${point.waveHeightFt ?? "--"} ft @ ${point.wavePeriodSec ?? "--"} s | ${point.source}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              zIndex: 640,
              transform: `translate3d(${pos.x - 39}px, ${pos.y - 26}px, 0)`,
              pointerEvents: "auto",
              willChange: "transform",
            }}
          >
            <div style={{ width: 78, minHeight: 52, border: "2px solid #a7f3d0", background: "rgba(3,18,24,.94)", color: "#ecfeff", borderRadius: 6, boxShadow: "0 0 0 2px rgba(3,18,24,.7)", display: "grid", placeItems: "center", padding: "4px 5px", fontFamily: "system-ui,sans-serif" }}>
              {showWind ? <>
                <div style={{ fontSize: 10, fontWeight: 900, lineHeight: 1.05 }}>{windSpeedText(point)}</div>
                {point.gustKt !== null ? <div style={{ marginTop: 2, fontSize: 9, fontWeight: 850 }}>{gustText(point)}</div> : null}
                <div style={{ marginTop: 2, fontSize: 8, fontWeight: 800, color: "#a7f3d0" }}>{directionText(point)}</div>
              </> : null}
              {showSeas ? <div style={{ marginTop: 2, fontSize: 9, fontWeight: 800, color: "#f1d56b" }}>{point.waveHeightFt === null ? "SEA --" : `SEAS ${point.waveHeightFt.toFixed(1)} FT`}</div> : null}
            </div>
          </div>
        );
      })}
    </>,
    markerPane
  ) : null;

  const controls = createPortal(
    <div style={{ position: "absolute", zIndex: 770, top: 58, right: 10, width: panelOpen ? 318 : "auto", pointerEvents: "auto", fontFamily: "system-ui,sans-serif" }}>
      <button type="button" onClick={() => setPanelOpen((v) => !v)} style={{ float: "right", minHeight: 34, padding: "7px 11px", border: "1px solid rgba(167,243,208,.55)", borderRadius: 5, background: "rgba(5,12,18,.94)", color: "#d1fae5", fontSize: 10, fontWeight: 900, letterSpacing: ".11em", cursor: "pointer" }}>WX LAYERS · PREVIEW</button>
      {panelOpen ? (
        <div style={{ clear: "both", marginTop: 40, border: "1px solid rgba(167,243,208,.38)", borderRadius: 7, background: "rgba(5,12,18,.95)", color: "#d7e7ee", padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,.32)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "#a7f3d0", fontSize: 11, letterSpacing: ".1em" }}>NOAA ROUTE WX</strong>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800 }}>
              <input type="checkbox" checked={visible} disabled={!forecast || !frame?.points?.length} onChange={(e) => setVisible(e.target.checked)} /> DISPLAY
            </label>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 10 }}>
            <label><input type="checkbox" checked={showWind} onChange={(e) => setShowWind(e.target.checked)} /> WIND</label>
            <label><input type="checkbox" checked={showSeas} onChange={(e) => setShowSeas(e.target.checked)} /> SEAS</label>
          </div>
          {forecast?.frames?.length ? (
            <>
              <div style={{ marginTop: 9, display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 750 }}>
                <span>FORECAST TIME</span><span style={{ color: "#a7f3d0" }}>{validLabel(frame!.validAt)}</span>
              </div>
              <input type="range" min={0} max={forecast.frames.length - 1} step={1} value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))} style={{ width: "100%", accentColor: "#a7f3d0" }} />
              <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.35 }}>{forecast.provider} · {forecast.coveredSampleCount}/{forecast.sampleCount} route samples</div>
              {forecast.note ? <div style={{ marginTop: 4, fontSize: 9, color: "#f1d56b" }}>{forecast.note}</div> : null}
            </>
          ) : loading ? <div style={{ marginTop: 9, fontSize: 10, color: "#94a3b8" }}>Loading NOAA route forecast…</div> : error ? <div style={{ marginTop: 9, fontSize: 10, color: "#fca5a5" }}>{error}</div> : <div style={{ marginTop: 9, fontSize: 10, color: "#94a3b8" }}>Load a route to enable NOAA weather.</div>}
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(148,163,184,.16)", fontSize: 9, color: "#8294a5" }}>NOAA markers stay with Leaflet during pan and re-anchor only after the map pane fully settles. AMI WX remains independent.</div>
        </div>
      ) : null}
    </div>,
    host
  );

  return <>{markers}{controls}</>;
}
