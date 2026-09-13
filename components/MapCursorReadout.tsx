"use client";

import { useEffect } from "react";

function rad(value: number) { return value * Math.PI / 180; }
function deg(value: number) { return value * 180 / Math.PI; }
function normalize360(value: number) { return ((value % 360) + 360) % 360; }
function lonDelta(value: number) { let v = value; while (v > 180) v -= 360; while (v < -180) v += 360; return v; }

function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(lonDelta(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(lonDelta(b.lon - a.lon));
  return normalize360(deg(Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  )));
}

function ddm(value: number, lat: boolean) {
  const hemi = lat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return `${String(degrees).padStart(lat ? 2 : 3, "0")}° ${minutes.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

function parseDdm(text: string | null, lat: boolean) {
  if (!text) return null;
  const match = text.match(/(\d{1,3})°\s*(\d+(?:\.\d+)?)'\s*([NSEW])/i);
  if (!match) return null;
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;
  const hemi = match[3].toUpperCase();
  const value = degrees + minutes / 60;
  const signed = hemi === "S" || hemi === "W" ? -value : value;
  if (lat ? Math.abs(signed) > 90 : Math.abs(signed) > 180) return null;
  return signed;
}

function ownShipPosition() {
  const lat = parseDdm(document.getElementById("bc2-lat")?.textContent ?? null, true);
  const lon = parseDdm(document.getElementById("bc2-lon")?.textContent ?? null, false);
  return lat === null || lon === null ? null : { lat, lon };
}

function findMap() {
  const host = document.getElementById("v12-map");
  if (!host) return { host: null, map: null };
  const nodes = [host, ...Array.from(host.querySelectorAll<HTMLElement>("*"))];
  for (const node of nodes) {
    const map = (node as any).__navdashLeafletMap;
    if (map) return { host, map };
  }
  return { host, map: null };
}

export function MapCursorReadout() {
  useEffect(() => {
    let attachedMap: any = null;
    let overlay: HTMLDivElement | null = null;

    const detach = () => {
      if (attachedMap) {
        attachedMap.off("mousemove", onMouseMove);
        attachedMap.off("mouseout", onMouseOut);
      }
      attachedMap = null;
      overlay?.remove();
      overlay = null;
    };

    const onMouseMove = (event: any) => {
      if (!overlay || !event?.latlng) return;
      const cursor = { lat: Number(event.latlng.lat), lon: Number(event.latlng.lng) };
      if (!Number.isFinite(cursor.lat) || !Number.isFinite(cursor.lon)) return;

      const ship = ownShipPosition();
      const positionText = `${ddm(cursor.lat, true)}  ${ddm(cursor.lon, false)}`;
      if (!ship) {
        overlay.textContent = `${positionText}   RNG --   BRG --`;
        return;
      }

      overlay.textContent = `${positionText}   RNG ${distanceNm(ship, cursor).toFixed(2)} NM   BRG ${bearing(ship, cursor).toFixed(1)}°T`;
    };

    const onMouseOut = () => {
      if (overlay) overlay.textContent = "CURSOR --   RNG --   BRG --";
    };

    const attach = () => {
      const { host, map } = findMap();
      if (!host || !map || map === attachedMap) return;
      detach();
      attachedMap = map;

      overlay = document.createElement("div");
      overlay.id = "navdash-map-cursor-readout";
      overlay.textContent = "CURSOR --   RNG --   BRG --";
      Object.assign(overlay.style, {
        position: "absolute",
        left: "8px",
        bottom: "8px",
        zIndex: "1100",
        pointerEvents: "none",
        padding: "6px 8px",
        border: "1px solid rgba(148, 163, 184, 0.45)",
        background: "rgba(4, 8, 12, 0.88)",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "11px",
        fontWeight: "700",
        lineHeight: "1.2",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        boxShadow: "0 1px 6px rgba(0,0,0,.25)",
      });
      host.appendChild(overlay);

      map.on("mousemove", onMouseMove);
      map.on("mouseout", onMouseOut);
    };

    attach();
    const timer = window.setInterval(attach, 1000);
    return () => {
      window.clearInterval(timer);
      detach();
    };
  }, []);

  return null;
}
