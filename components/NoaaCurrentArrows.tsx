"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CurrentPoint = { lat: number; lon: number; u: number; v: number };
type CurrentResponse = {
  provider: string;
  product: string;
  dataset: string;
  validAt: string;
  units: string;
  points: CurrentPoint[];
};

const MAP_ID = "navmap-main-isolated-v2";
const TOGGLE_ID = "navdash-current-arrows-toggle";
const CANVAS_ID = "navdash-current-arrows-canvas";
const MPS_TO_KNOTS = 1.9438444924;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function validTimeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "LATEST";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).toUpperCase();
}

export function NoaaCurrentArrows() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState<CurrentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mapRef = useRef<any>(null);
  const reloadRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const findMap = () => {
      if (stopped) return;
      const outer = document.getElementById("v12-map");
      const mapElement = document.getElementById(MAP_ID) as any;
      const map = mapElement?.__navdashLeafletMap;
      if (outer && map) {
        setHost(outer);
        mapRef.current = map;
        return;
      }
      timer = window.setTimeout(findMap, 100);
    };
    findMap();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!host || !map) return;

    const load = async () => {
      if (!enabled) return;
      const bounds = map.getBounds();
      const south = clamp(bounds.getSouth() - 0.35, -89.5, 89.5);
      const north = clamp(bounds.getNorth() + 0.35, -89.5, 89.5);
      const west = bounds.getWest() - 0.35;
      const east = bounds.getEast() + 0.35;

      if (west < -180 || east > 180 || east <= west) {
        setData(null);
        setError("Current arrows do not yet span the dateline.");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          south: south.toFixed(3),
          north: north.toFixed(3),
          west: west.toFixed(3),
          east: east.toFixed(3),
        });
        const response = await fetch(`/api/noaa-current-arrows?${params.toString()}`, { cache: "no-store" });
        const next = await response.json();
        if (!response.ok) throw new Error(next?.error || "NOAA current arrows unavailable");
        setData(next);
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : "NOAA current arrows unavailable");
      } finally {
        setLoading(false);
      }
    };

    const schedule = () => {
      window.clearTimeout(reloadRef.current);
      reloadRef.current = window.setTimeout(load, 250);
    };

    if (enabled) load();
    else {
      setData(null);
      setError("");
    }

    map.on("moveend", schedule);
    return () => {
      map.off("moveend", schedule);
      window.clearTimeout(reloadRef.current);
    };
  }, [enabled, host]);

  useEffect(() => {
    const map = mapRef.current;
    const mapElement = document.getElementById(MAP_ID) as HTMLElement | null;
    document.getElementById(CANVAS_ID)?.remove();
    if (!enabled || !map || !mapElement || !data?.points?.length) return;

    const canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    canvas.style.cssText = "position:absolute;inset:0;z-index:740;pointer-events:none;width:100%;height:100%";
    mapElement.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, mapElement.clientWidth);
      const height = Math.max(1, mapElement.clientHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const day = document.documentElement.getAttribute("data-navdash-theme") === "day";
      const arrowColor = day ? "#006f78" : "#22d3ee";
      const textColor = day ? "#12313a" : "#dffbff";
      const haloColor = day ? "rgba(255,255,255,.94)" : "rgba(5,12,18,.92)";
      const bounds = map.getBounds();

      const candidates = data.points
        .filter((p) => bounds.contains([p.lat, p.lon]))
        .map((p) => ({ p, screen: map.latLngToContainerPoint([p.lat, p.lon]) }))
        .filter(({ screen }) => screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height);

      const spacing = map.getZoom() >= 10 ? 58 : map.getZoom() >= 8 ? 72 : 92;
      const kept: typeof candidates = [];
      for (const candidate of candidates) {
        if (kept.some((other) => Math.hypot(other.screen.x - candidate.screen.x, other.screen.y - candidate.screen.y) < spacing)) continue;
        kept.push(candidate);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.font = "700 10px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (const { p, screen } of kept) {
        const speedKn = Math.hypot(p.u, p.v) * MPS_TO_KNOTS;
        if (!Number.isFinite(speedKn) || speedKn < 0.03) continue;

        // NOAA u/v are eastward/northward components. Arrow points toward SET.
        const setRad = Math.atan2(p.u, p.v);
        const length = clamp(18 + speedKn * 6, 20, 36);
        const dx = Math.sin(setRad) * length;
        const dy = -Math.cos(setRad) * length;
        const x1 = screen.x - dx * 0.42;
        const y1 = screen.y - dy * 0.42;
        const x2 = screen.x + dx * 0.58;
        const y2 = screen.y + dy * 0.58;
        const shaftAngle = Math.atan2(y2 - y1, x2 - x1);
        const head = 6;

        const pathArrow = () => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - Math.cos(shaftAngle - Math.PI / 6) * head, y2 - Math.sin(shaftAngle - Math.PI / 6) * head);
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - Math.cos(shaftAngle + Math.PI / 6) * head, y2 - Math.sin(shaftAngle + Math.PI / 6) * head);
        };

        ctx.strokeStyle = haloColor;
        ctx.lineWidth = 4.5;
        pathArrow();
        ctx.stroke();

        ctx.strokeStyle = arrowColor;
        ctx.lineWidth = 1.9;
        pathArrow();
        ctx.stroke();

        const label = `${speedKn.toFixed(1)} kt`;
        const labelY = screen.y + 19;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = haloColor;
        ctx.strokeText(label, screen.x, labelY);
        ctx.fillStyle = textColor;
        ctx.fillText(label, screen.x, labelY);
      }
    };

    draw();
    const redraw = () => draw();
    map.on("zoomend moveend", redraw);
    const observer = new ResizeObserver(redraw);
    observer.observe(mapElement);

    return () => {
      observer.disconnect();
      map.off("zoomend moveend", redraw);
      canvas.remove();
    };
  }, [data, enabled]);

  useEffect(() => () => {
    window.clearTimeout(reloadRef.current);
    document.getElementById(CANVAS_ID)?.remove();
  }, []);

  const status = loading
    ? "NOAA CURRENTS • LOADING"
    : error
      ? "NOAA CURRENTS • UNAVAILABLE"
      : data
        ? `NOAA CURRENTS • ${validTimeLabel(data.validAt)}`
        : "NOAA CURRENTS";

  return (
    <>
      <button
        id={TOGGLE_ID}
        type="button"
        aria-pressed={enabled}
        data-current-enabled={enabled ? "true" : "false"}
        onClick={() => setEnabled((value) => !value)}
        style={{ display: "none" }}
      >
        NOAA CURRENTS {enabled ? "ON" : "OFF"}
      </button>

      {host && enabled ? createPortal(
        <div
          style={{
            position: "absolute",
            zIndex: 745,
            right: 10,
            bottom: 10,
            pointerEvents: "none",
            padding: "5px 8px",
            borderRadius: 4,
            border: "1px solid rgba(34,211,238,.34)",
            background: "rgba(5,12,18,.82)",
            color: error ? "#fca5a5" : "#bff8ff",
            font: "800 9px/1.2 system-ui,sans-serif",
            letterSpacing: ".08em",
          }}
          title={error || data?.product || "NOAA surface currents"}
        >
          {status}
        </div>,
        host,
      ) : null}
    </>
  );
}
