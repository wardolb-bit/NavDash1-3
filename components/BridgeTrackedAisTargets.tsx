"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const AIS_NAME_CACHE_KEY = "navdash-ais-name-cache-v1";
const TRACKED_TARGETS_KEY = "navdash-tracked-ais-targets-v1";
const TARGET_MAX_AGE_MS = 30 * 60 * 1000;
const OWN_SHIP_MAX_AGE_MS = 2 * 60 * 1000;
const PICK_RADIUS_PX = 22;

type Target = {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  updatedAt: number;
};

type OwnShip = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  updatedAt: number;
};

function sixBit(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function bitsFromPayload(payload: string) {
  return payload.split("").map((char) => sixBit(char).toString(2).padStart(6, "0")).join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const sign = 2 ** (length - 1);
  return value >= sign ? value - 2 ** length : value;
}

function decodePosition(line: string, ownShip: boolean): Target | OwnShip | null {
  try {
    if (ownShip ? !/^[$!]AIVDO/.test(line) : !line.startsWith("!AIVDM")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = bitsFromPayload(parts[5]);
    const type = unsigned(bits, 0, 6);
    const mmsi = unsigned(bits, 8, 30);
    let sog: number | null = null;
    let cog: number | null = null;
    let lon = 0;
    let lat = 0;

    if ([1, 2, 3].includes(type)) {
      const sogRaw = unsigned(bits, 50, 10);
      lon = signed(bits, 61, 28) / 600000;
      lat = signed(bits, 89, 27) / 600000;
      const cogRaw = unsigned(bits, 116, 12);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
    } else if (!ownShip && type === 18) {
      const sogRaw = unsigned(bits, 46, 10);
      lon = signed(bits, 57, 28) / 600000;
      lat = signed(bits, 85, 27) / 600000;
      const cogRaw = unsigned(bits, 112, 12);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
    } else {
      return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const common = { lat, lon, sog, cog, updatedAt: Date.now() };
    return ownShip ? common : { mmsi, ...common };
  } catch {
    return null;
  }
}

function normalizeTime(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeTarget(value: any): Target | null {
  const mmsi = Number(value?.mmsi);
  const lat = Number(value?.lat);
  const lon = Number(value?.lon);
  if (!Number.isFinite(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const numberOrNull = (input: unknown) => Number.isFinite(Number(input)) ? Number(input) : null;
  return {
    mmsi,
    lat,
    lon,
    sog: numberOrNull(value?.sog),
    cog: numberOrNull(value?.cog),
    updatedAt: normalizeTime(value?.updatedAt ?? value?.lastSeen),
  };
}

function velocity(sog: number | null, cog: number | null) {
  if (sog === null || !Number.isFinite(sog)) return null;
  if (sog <= 0.2) return { east: 0, north: 0 };
  if (cog === null || !Number.isFinite(cog)) return null;
  const radians = cog * Math.PI / 180;
  return { east: sog * Math.sin(radians), north: sog * Math.cos(radians) };
}

function cpaTcpa(own: OwnShip | null, target: Target) {
  if (!own || Date.now() - own.updatedAt > OWN_SHIP_MAX_AGE_MS) return null;
  if (Date.now() - target.updatedAt > TARGET_MAX_AGE_MS) return null;
  const ownVelocity = velocity(own.sog, own.cog);
  const targetVelocity = velocity(target.sog, target.cog);
  if (!ownVelocity || !targetVelocity) return null;

  const meanLat = (own.lat + target.lat) * 0.5 * Math.PI / 180;
  const east = (target.lon - own.lon) * 60 * Math.cos(meanLat);
  const north = (target.lat - own.lat) * 60;
  const relativeEast = targetVelocity.east - ownVelocity.east;
  const relativeNorth = targetVelocity.north - ownVelocity.north;
  const relativeSpeedSquared = relativeEast ** 2 + relativeNorth ** 2;
  if (relativeSpeedSquared < 0.0001) return null;

  const tcpaHours = -((east * relativeEast) + (north * relativeNorth)) / relativeSpeedSquared;
  if (!Number.isFinite(tcpaHours) || tcpaHours < 0) return null;
  const cpaEast = east + relativeEast * tcpaHours;
  const cpaNorth = north + relativeNorth * tcpaHours;
  const cpaNm = Math.hypot(cpaEast, cpaNorth);
  if (!Number.isFinite(cpaNm)) return null;
  return { cpaNm, tcpaMinutes: tcpaHours * 60 };
}

function namesFromCache() {
  const names = new Map<number, string>();
  try {
    const parsed = JSON.parse(localStorage.getItem(AIS_NAME_CACHE_KEY) || "{}");
    for (const [key, value] of Object.entries(parsed || {})) {
      const name = String((value as any)?.name || "").trim();
      if (name) names.set(Number(key), name);
    }
  } catch {}
  return names;
}

function trackedFromStorage() {
  const tracked = new Set<number>();
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACKED_TARGETS_KEY) || "[]");
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        const mmsi = Number(value);
        if (Number.isFinite(mmsi)) tracked.add(mmsi);
      }
    }
  } catch {}
  return tracked;
}

function formatTcpa(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} MIN`;
  return `${(minutes / 60).toFixed(1)} HR`;
}

export function BridgeTrackedAisTargets() {
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let renderTimer = 0;
    let map: any = null;
    let mapElement: HTMLElement | null = null;
    let names = namesFromCache();
    let ownShip: OwnShip | null = null;
    const targets = new Map<number, Target>();
    const tracked = trackedFromStorage();

    const panel = document.createElement("section");
    panel.id = "bc2-tracked-targets";
    panel.style.cssText = "flex:1;min-height:120px;border-bottom:1px solid rgba(255,255,255,.10);padding:10px 12px;overflow:auto;";
    const systemStrip = document.getElementById("bc2-system-strip");
    systemStrip?.parentElement?.insertBefore(panel, systemStrip);

    const isDay = () => document.documentElement.dataset.navdashTheme === "day" || document.documentElement.classList.contains("day-mode");
    const persistTracked = () => {
      try { localStorage.setItem(TRACKED_TARGETS_KEY, JSON.stringify(Array.from(tracked))); } catch {}
    };

    const render = () => {
      if (disposed) return;
      names = namesFromCache();
      const day = isDay();
      panel.style.background = day ? "#ffffff" : "#071019";
      panel.style.color = day ? "#17212b" : "#7fa88a";
      panel.innerHTML = "";

      const title = document.createElement("div");
      title.textContent = "TRACKED TARGETS";
      title.style.cssText = `font:900 8px/1 system-ui,sans-serif;letter-spacing:.16em;margin-bottom:8px;color:${day ? "#64748b" : "#6f9278"}`;
      panel.appendChild(title);

      if (!tracked.size) {
        const empty = document.createElement("div");
        empty.textContent = "DOUBLE-CLICK AIS TARGET TO TRACK";
        empty.style.cssText = `font:800 9px/1.35 system-ui,sans-serif;color:${day ? "#94a3b8" : "#516b59"};padding-top:4px`;
        panel.appendChild(empty);
        return;
      }

      for (const mmsi of tracked) {
        const target = targets.get(mmsi);
        const row = document.createElement("button");
        row.type = "button";
        row.dataset.mmsi = String(mmsi);
        row.title = "Click to remove tracked target";
        row.style.cssText = `display:grid;grid-template-columns:minmax(0,1fr) 72px 72px;width:100%;gap:6px;align-items:center;padding:7px 5px;border:0;border-top:1px solid ${day ? "rgba(15,23,42,.10)" : "rgba(111,146,120,.16)"};background:transparent;color:${day ? "#17212b" : "#7fa88a"};text-align:left;cursor:pointer;font-family:system-ui,sans-serif`;

        const name = document.createElement("span");
        name.textContent = names.get(mmsi) || `AIS ${mmsi}`;
        name.style.cssText = "font-size:10px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

        const approach = target ? cpaTcpa(ownShip, target) : null;
        const cpa = document.createElement("span");
        cpa.textContent = approach ? `CPA ${approach.cpaNm.toFixed(2)}` : "CPA --";
        cpa.style.cssText = "font-size:9px;font-weight:800;text-align:right;white-space:nowrap";

        const tcpa = document.createElement("span");
        tcpa.textContent = approach ? `TCPA ${formatTcpa(approach.tcpaMinutes)}` : "TCPA --";
        tcpa.style.cssText = "font-size:9px;font-weight:800;text-align:right;white-space:nowrap";

        row.append(name, cpa, tcpa);
        row.addEventListener("click", () => {
          tracked.delete(mmsi);
          persistTracked();
          render();
        });
        panel.appendChild(row);
      }
    };

    const scheduleRender = () => {
      window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(render, 120);
    };

    const toggleNearestTarget = (event: MouseEvent) => {
      if (!map || !mapElement) return;
      const rect = mapElement.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      let nearest: { mmsi: number; distance: number } | null = null;

      for (const target of targets.values()) {
        if (Date.now() - target.updatedAt > TARGET_MAX_AGE_MS) continue;
        const point = map.latLngToContainerPoint([target.lat, target.lon]);
        const distance = Math.hypot(point.x - clickX, point.y - clickY);
        if (distance <= PICK_RADIUS_PX && (!nearest || distance < nearest.distance)) nearest = { mmsi: target.mmsi, distance };
      }

      if (!nearest) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (tracked.has(nearest.mmsi)) tracked.delete(nearest.mmsi);
      else tracked.add(nearest.mmsi);
      persistTracked();
      render();
    };

    const attachMap = () => {
      const element = document.getElementById("navmap-main-isolated-v2") as any;
      const nextMap = element?.__navdashLeafletMap;
      if (!element || !nextMap) return;
      if (mapElement === element && map === nextMap) return;
      mapElement?.removeEventListener("dblclick", toggleNearestTarget, true);
      mapElement = element;
      map = nextMap;
      mapElement.addEventListener("dblclick", toggleNearestTarget, true);
    };

    const applySnapshotTarget = (value: any) => {
      const target = normalizeTarget(value);
      if (!target || Date.now() - target.updatedAt > TARGET_MAX_AGE_MS) return;
      targets.set(target.mmsi, target);
      if (typeof value?.name === "string" && value.name.trim()) {
        names.set(target.mmsi, value.name.trim());
      }
      if (tracked.has(target.mmsi)) scheduleRender();
    };

    const applyOwnShip = (value: any) => {
      const lat = Number(value?.lat);
      const lon = Number(value?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      ownShip = {
        lat,
        lon,
        sog: Number.isFinite(Number(value?.sog)) ? Number(value.sog) : null,
        cog: Number.isFinite(Number(value?.cog)) ? Number(value.cog) : null,
        updatedAt: normalizeTime(value?.updatedAt ?? value?.lastSeen),
      };
      if (tracked.size) scheduleRender();
    };

    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onopen = () => {
          try { socket?.send(JSON.stringify({ type: "ais-target-snapshot-request" })); } catch {}
        };
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          let json: any = null;
          try { json = JSON.parse(raw); } catch {}

          if (json?.type === "ais-target-snapshot") {
            const list = Array.isArray(json?.targets) ? json.targets : Array.isArray(json?.vessels) ? json.vessels : [];
            for (const item of list) applySnapshotTarget(item);
            applyOwnShip(json?.ownShip || json?.ownship);
            scheduleRender();
            return;
          }
          if (json?.type === "ais-target-update" || json?.type === "ais-target") {
            applySnapshotTarget(json.target || json.vessel || json);
            return;
          }
          if (json?.type === "ownship-state" || json?.type === "own-ship-state") {
            applyOwnShip(json.ownShip || json.ownship || json);
            return;
          }

          raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            if (!line) continue;
            const decodedOwn = decodePosition(line, true) as OwnShip | null;
            if (decodedOwn) {
              ownShip = decodedOwn;
              if (tracked.size) scheduleRender();
              continue;
            }
            const target = decodePosition(line, false) as Target | null;
            if (!target) continue;
            targets.set(target.mmsi, target);
            if (tracked.has(target.mmsi)) scheduleRender();
          }
        };
        socket.onclose = () => {
          if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    const onMapReady = () => attachMap();
    window.addEventListener("navdash-leaflet-map-ready", onMapReady);
    const mapAttachTimer = window.setInterval(attachMap, 1000);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-navdash-theme"] });

    attachMap();
    connect();
    render();

    return () => {
      disposed = true;
      window.removeEventListener("navdash-leaflet-map-ready", onMapReady);
      window.clearInterval(mapAttachTimer);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(renderTimer);
      themeObserver.disconnect();
      mapElement?.removeEventListener("dblclick", toggleNearestTarget, true);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      panel.remove();
    };
  }, []);

  return null;
}
