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
type AmiOverlay = {
  sourceName?: string;
  forecastPoints?: Array<{ validAt?: string }>;
};

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const AMI_OVERLAY_STORAGE_KEY = "navdash-ami-route-forecast-v1";
const MAP_ELEMENT_ID = "navmap-main-isolated-v2";
const NOAA_PANE = "navmap-main-noaa-wx-v1";
const NOAA_TOOLTIP_PANE = "navmap-main-noaa-wx-tooltip-v1";

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

function readAmiOverlay(): AmiOverlay | null {
  try {
    const raw = window.localStorage.getItem(AMI_OVERLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.forecastPoints) ? parsed : null;
  } catch {
    return null;
  }
}

function longitudeNearReference(lon: number, referenceLon: number) {
  let adjusted = lon;
  while (adjusted - referenceLon > 180) adjusted -= 360;
  while (adjusted - referenceLon < -180) adjusted += 360;
  return adjusted;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function validLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).toUpperCase();
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

function blockHtml(point: NoaaPoint, showWind: boolean, showSeas: boolean) {
  const wind = showWind ? `<div style="font-size:10px;font-weight:900;line-height:1.05">${escapeHtml(windSpeedText(point))}</div>${point.gustKt !== null ? `<div style="margin-top:2px;font-size:9px;font-weight:850">${escapeHtml(gustText(point))}</div>` : ""}<div style="margin-top:2px;font-size:8px;font-weight:800;color:#a7f3d0">${escapeHtml(directionText(point))}</div>` : "";
  const seas = showSeas ? `<div style="margin-top:2px;font-size:9px;font-weight:800;color:#f1d56b">${point.waveHeightFt === null ? "SEA --" : `SEAS ${point.waveHeightFt.toFixed(1)} FT`}</div>` : "";
  return `<div style="width:78px;min-height:52px;border:2px solid #a7f3d0;background:rgba(3,18,24,.94);color:#ecfeff;border-radius:6px;box-shadow:0 0 0 2px rgba(3,18,24,.7);display:grid;place-items:center;padding:4px 5px;font-family:system-ui,sans-serif">${wind}${seas}</div>`;
}

export function NoaaLeafletPaneWeatherOverlay() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [forecast, setForecast] = useState<NoaaForecast | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showWind, setShowWind] = useState(true);
  const [showSeas, setShowSeas] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [amiOverlay, setAmiOverlay] = useState<AmiOverlay | null>(null);
  const [amiVisible, setAmiVisible] = useState(true);
  const [amiSelectedIndex, setAmiSelectedIndex] = useState(0);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!host) return;

    const syncAmiControls = () => {
      setAmiOverlay(readAmiOverlay());

      const amiLabel = Array.from(host.querySelectorAll("label")).find((element) => element.textContent?.trim() === "AMI WX") as HTMLLabelElement | undefined;
      if (amiLabel) {
        amiLabel.style.display = "none";
        const checkbox = amiLabel.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (checkbox) setAmiVisible(checkbox.checked);
      }

      const amiBoxLabel = Array.from(host.querySelectorAll("span")).find((element) => element.textContent?.trim() === "AMI ROUTE WX");
      const amiBox = amiBoxLabel?.parentElement?.parentElement as HTMLElement | null;
      if (amiBox) amiBox.style.display = "none";

      const slider = host.querySelector<HTMLInputElement>('input[aria-label="AMI forecast time"]');
      if (slider) setAmiSelectedIndex(Number(slider.value) || 0);
    };

    syncAmiControls();
    const observer = new MutationObserver(syncAmiControls);
    observer.observe(host, { childList: true, subtree: true });
    host.addEventListener("change", syncAmiControls, true);
    window.addEventListener("storage", syncAmiControls);
    window.addEventListener("navdash-ami-overlay-updated", syncAmiControls);

    return () => {
      observer.disconnect();
      host.removeEventListener("change", syncAmiControls, true);
      window.removeEventListener("storage", syncAmiControls);
      window.removeEventListener("navdash-ami-overlay-updated", syncAmiControls);
      const amiLabel = Array.from(host.querySelectorAll("label")).find((element) => element.textContent?.trim() === "AMI WX") as HTMLLabelElement | undefined;
      if (amiLabel) amiLabel.style.display = "";
      const amiBoxLabel = Array.from(host.querySelectorAll("span")).find((element) => element.textContent?.trim() === "AMI ROUTE WX");
      const amiBox = amiBoxLabel?.parentElement?.parentElement as HTMLElement | null;
      if (amiBox) amiBox.style.display = "";
    };
  }, [host]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const find = () => {
      if (cancelled) return;
      const outer = document.getElementById("v12-map");
      const mapElement = document.getElementById(MAP_ELEMENT_ID) as any;
      const map = mapElement?.__navdashLeafletMap;
      if (outer && map) {
        setHost(outer);
        mapRef.current = map;
        return;
      }
      timer = window.setTimeout(find, 100);
    };
    find();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!host) return;
    const syncRoute = () => {
      const next = readRoute();
      setRoute((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    syncRoute();
    const timer = window.setInterval(syncRoute, 500);
    window.addEventListener("storage", syncRoute);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", syncRoute);
    };
  }, [host]);

  const routeSignature = useMemo(() => route.map((wp) => `${wp.lat.toFixed(5)},${wp.lon.toFixed(5)}`).join(";"), [route]);

  useEffect(() => {
    if (!routeSignature || route.length < 2) { setForecast(null); setVisible(false); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError("");
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

  const frame = forecast?.frames?.[Math.min(selectedIndex, Math.max(0, (forecast?.frames?.length || 1) - 1))] || null;
  const amiPoints = amiOverlay?.forecastPoints || [];
  const amiPoint = amiPoints[Math.min(amiSelectedIndex, Math.max(0, amiPoints.length - 1))] || null;

  function setAmiDisplay(next: boolean) {
    setAmiVisible(next);
    if (!host) return;
    const amiLabel = Array.from(host.querySelectorAll("label")).find((element) => element.textContent?.trim() === "AMI WX") as HTMLLabelElement | undefined;
    const checkbox = amiLabel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox && checkbox.checked !== next) checkbox.click();
  }

  function setAmiForecastIndex(next: number) {
    setAmiSelectedIndex(next);
    if (!host) return;
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="AMI forecast time"]');
    if (!slider) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(slider, String(next));
    else slider.value = String(next);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }

  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      if (cancelled) return;

      let pane = map.getPane(NOAA_PANE);
      if (!pane) {
        pane = map.createPane(NOAA_PANE);
        pane.style.zIndex = "750";
        pane.style.pointerEvents = "auto";
      }
      let tooltipPane = map.getPane(NOAA_TOOLTIP_PANE);
      if (!tooltipPane) {
        tooltipPane = map.createPane(NOAA_TOOLTIP_PANE);
        tooltipPane.style.zIndex = "950";
        tooltipPane.style.pointerEvents = "none";
      }
      if (!layerRef.current) layerRef.current = L.layerGroup([], { pane: NOAA_PANE } as any).addTo(map);
      const layer = layerRef.current;
      layer.clearLayers();
      if (!visible || !frame) return;

      const centerLon = map.getCenter().lng;
      for (const point of frame.points) {
        const baseLon = longitudeNearReference(point.lon, centerLon);
        for (const offset of [-360, 0, 360]) {
          const icon = L.divIcon({
            className: "navmap-noaa-route-wx-icon",
            html: blockHtml(point, showWind, showSeas),
            iconSize: [88, 62],
            iconAnchor: [44, 31],
          });
          const marker = L.marker([point.lat, baseLon + offset], { icon, pane: NOAA_PANE });
          marker.bindTooltip(`${validLabel(frame.validAt)} | ${windSpeedText(point)}${point.gustKt === null ? "" : ` | ${gustText(point)}`} | ${directionText(point)} | Seas ${point.waveHeightFt ?? "--"} ft @ ${point.wavePeriodSec ?? "--"} s | ${point.source}`, { direction: "top", opacity: 0.98, pane: NOAA_TOOLTIP_PANE });
          marker.addTo(layer);
        }
      }
    };
    draw();
    return () => { cancelled = true; };
  }, [frame, visible, showWind, showSeas]);

  useEffect(() => () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (map && layer) {
      try { map.removeLayer(layer); } catch {}
    }
    layerRef.current = null;
    mapRef.current = null;
  }, []);

  if (!host) return null;

  return createPortal(
    <>
      <div style={{ position: "absolute", zIndex: 770, top: 58, right: 10, width: panelOpen ? 318 : "auto", pointerEvents: "auto", fontFamily: "system-ui,sans-serif" }}>
        <button type="button" onClick={() => setPanelOpen((v) => !v)} style={{ float: "right", minHeight: 34, padding: "7px 11px", border: "1px solid rgba(167,243,208,.55)", borderRadius: 5, background: "rgba(5,12,18,.94)", color: "#d1fae5", fontSize: 10, fontWeight: 900, letterSpacing: ".11em", cursor: "pointer" }}>WX LAYERS</button>
        {panelOpen ? (
          <div style={{ clear: "both", marginTop: 40, border: "1px solid rgba(167,243,208,.38)", borderRadius: 7, background: "rgba(5,12,18,.95)", color: "#d7e7ee", padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,.32)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong style={{ color: "#a7f3d0", fontSize: 11, letterSpacing: ".1em" }}>NOAA ROUTE WX</strong>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800 }}>
                <input type="checkbox" checked={visible} disabled={!forecast || !frame?.points?.length} onChange={(e) => setVisible(e.target.checked)} /> DISPLAY
              </label>
            </div>
            {route.length < 2 ? <div style={{ marginTop: 4, textAlign: "right", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#f1d56b" }}>.RTZ MUST BE LOADED</div> : null}
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

            <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(148,163,184,.22)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <strong style={{ color: "#67e8f9", fontSize: 11, letterSpacing: ".1em" }}>AMI ROUTE WX</strong>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, opacity: amiOverlay ? 1 : .55 }}>
                  <input type="checkbox" checked={amiVisible && Boolean(amiOverlay)} disabled={!amiOverlay} onChange={(e) => setAmiDisplay(e.target.checked)} /> DISPLAY
                </label>
              </div>
              {amiPoints.length ? (
                <>
                  <div style={{ marginTop: 9, display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 750 }}>
                    <span>FORECAST TIME</span><span style={{ color: "#67e8f9" }}>{amiPoint?.validAt ? validLabel(amiPoint.validAt) : "--"}</span>
                  </div>
                  <input aria-label="WX Layers AMI forecast time" type="range" min={0} max={amiPoints.length - 1} step={1} value={Math.min(amiSelectedIndex, amiPoints.length - 1)} onChange={(e) => setAmiForecastIndex(Number(e.target.value))} style={{ width: "100%", accentColor: "#22d3ee" }} />
                  <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.35 }}>{amiOverlay?.sourceName || "AMI route forecast"} · {amiPoints.length} coordinate points</div>
                </>
              ) : <div style={{ marginTop: 9, fontSize: 10, color: "#94a3b8" }}>Load an AMI route forecast to enable AMI weather.</div>}
            </div>
          </div>
        ) : null}
      </div>
      <style>{`.navmap-noaa-route-wx-icon{background:transparent!important;border:0!important}`}</style>
    </>,
    host
  );
}