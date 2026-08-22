"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type OwnShip = { lat: number; lon: number; sog: number; cog: number; heading: number | null };
type Waypoint = { id?: string; name?: string; lat: number; lon: number };

const ROUTE_STORAGE_KEY = "navconsole-saved-route";

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}
function payloadToBits(payload: string) {
  return payload.split("").map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}
function unsigned(bits: string, start: number, length: number) { return parseInt(bits.slice(start, start + length), 2); }
function signed(bits: string, start: number, length: number) {
  const raw = bits.slice(start, start + length);
  const value = parseInt(raw, 2);
  const signBit = 2 ** (length - 1);
  return value >= signBit ? value - 2 ** length : value;
}
function decodeOwnShip(line: string): OwnShip | null {
  try {
    if (!line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;
    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    if (![1, 2, 3].includes(type)) return null;
    const sog = unsigned(bits, 50, 10) / 10;
    const lon = signed(bits, 61, 28) / 600000;
    const lat = signed(bits, 89, 27) / 600000;
    const cog = unsigned(bits, 116, 12) / 10;
    const headingRaw = unsigned(bits, 128, 9);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, sog, cog, heading: headingRaw === 511 ? null : headingRaw };
  } catch { return null; }
}

function destinationPoint(lat: number, lon: number, bearing: number, distanceNm: number) {
  const radiusNm = 3440.065;
  const distanceRad = distanceNm / radiusNm;
  const bearingRad = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceRad) + Math.cos(lat1) * Math.sin(distanceRad) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(distanceRad) * Math.cos(lat1), Math.cos(distanceRad) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180 };
}

function unwrapRoute(route: Waypoint[]) {
  if (!route.length) return [] as Array<[number, number]>;
  const points: Array<[number, number]> = [];
  let previousLon = route[0].lon;
  points.push([route[0].lat, previousLon]);
  for (let index = 1; index < route.length; index += 1) {
    let lon = route[index].lon;
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    points.push([route[index].lat, lon]);
    previousLon = lon;
  }
  return points;
}

function normalizeRoutePayload(payload: any): Waypoint[] {
  const raw = Array.isArray(payload?.waypoints) ? payload.waypoints : [];
  return raw.map((wp: any) => ({
    id: typeof wp?.id === "string" ? wp.id : undefined,
    name: typeof wp?.name === "string" ? wp.name : undefined,
    lat: Number(wp?.lat ?? wp?.latitude),
    lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
  })).filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
}

function readSavedRoute() {
  try {
    const local = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (local) return normalizeRoutePayload(JSON.parse(local));
  } catch {}
  return [] as Waypoint[];
}

function routeSignature(route: Waypoint[]) {
  return route.map((wp) => `${wp.id || ""}|${wp.name || ""}|${wp.lat.toFixed(6)}|${wp.lon.toFixed(6)}`).join(";");
}

export function NavMapMainOverlayV2() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const findHost = () => {
      if (cancelled) return;
      const element = document.getElementById("v12-map");
      if (element) {
        if (getComputedStyle(element).position === "static") element.style.position = "relative";
        setHost(element);
        return;
      }
      timer = window.setTimeout(findHost, 100);
    };
    findHost();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  if (!host) return null;
  return createPortal(<IsolatedMainMap />, host);
}

function IsolatedMainMap() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const ownLayerRef = useRef<any>(null);
  const ownMarkerRef = useRef<any>(null);
  const headingVectorRef = useRef<any>(null);
  const cogVectorRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const routeMarkersRef = useRef<any[]>([]);
  const routeSignatureRef = useRef("");
  const didInitialRouteFitRef = useRef(false);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const timeouts: number[] = [];

    async function initMap() {
      const element = elementRef.current;
      if (!element || mapRef.current || cancelled) return;
      const L = await import("leaflet");
      if (cancelled) return;

      if (!document.querySelector('link[data-navmap-main-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-navmap-main-leaflet", "true");
        document.head.appendChild(link);
      }

      const map = L.map(element, { zoomControl: true, attributionControl: false, preferCanvas: false }).setView([13.4443, 144.7937], 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      try {
        L.tileLayer.wms("https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer", {
          layers: "0,1,2,3,4,5,6,7,8,9,10,11,12", format: "image/png", transparent: true, version: "1.1.1", opacity: 0.85,
        } as any).addTo(map);
      } catch {}

      const ownPane = map.createPane("navmap-main-ownship-v2");
      ownPane.style.zIndex = "720";
      ownLayerRef.current = L.layerGroup([], { pane: "navmap-main-ownship-v2" } as any).addTo(map);
      mapRef.current = map;

      const invalidate = () => requestAnimationFrame(() => map.invalidateSize({ animate: false }));
      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(element);
      window.addEventListener("resize", invalidate);
      (element as any).__navmapMainInvalidateV2 = invalidate;
      for (const delay of [0, 80, 220, 500, 1000]) timeouts.push(window.setTimeout(invalidate, delay));
    }

    initMap();
    return () => {
      cancelled = true;
      timeouts.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      const element = elementRef.current as any;
      if (element?.__navmapMainInvalidateV2) window.removeEventListener("resize", element.__navmapMainInvalidateV2);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      ownLayerRef.current = null; ownMarkerRef.current = null; headingVectorRef.current = null; cogVectorRef.current = null;
      routeLayerRef.current = null; routeMarkersRef.current = [];
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}
          for (const line of raw.split(/\r?\n/)) {
            const decoded = decodeOwnShip(line.trim());
            if (decoded) setOwnShip(decoded);
          }
        };
        socket.onclose = () => { if (!closed) retryTimer = window.setTimeout(connect, 2000); };
      } catch { retryTimer = window.setTimeout(connect, 2000); }
    };
    connect();
    return () => {
      closed = true; window.clearTimeout(retryTimer);
      if (socket) { socket.onclose = null; socket.close(); }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      if (cancelled) return;
      let nextRoute = readSavedRoute();
      if (nextRoute.length < 2) {
        try {
          const response = await fetch("/api/route-state", { cache: "no-store" });
          if (response.ok) nextRoute = normalizeRoutePayload(await response.json());
        } catch {}
      }
      const signature = routeSignature(nextRoute);
      if (signature !== routeSignatureRef.current) {
        routeSignatureRef.current = signature;
        setRoute(nextRoute);
      }
      timer = window.setTimeout(refresh, 1500);
    };
    refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    async function updateRoute() {
      const map = mapRef.current;
      if (!map) return;
      const L = await import("leaflet");
      if (routeLayerRef.current) { try { map.removeLayer(routeLayerRef.current); } catch {} routeLayerRef.current = null; }
      for (const marker of routeMarkersRef.current) { try { map.removeLayer(marker); } catch {} }
      routeMarkersRef.current = [];
      if (route.length < 2) return;

      const points = unwrapRoute(route);
      routeLayerRef.current = L.polyline(points as any, { color: "#c9a227", weight: 4, opacity: 0.95 }).addTo(map);
      routeMarkersRef.current = route.map((wp, index) => L.circleMarker(points[index] as any, {
        radius: 5, color: "#c9a227", fillColor: "#c9a227", fillOpacity: 0.85, weight: 2,
      }).bindTooltip(`${wp.id || `WP${index + 1}`} ${wp.name || ""}`.trim()).addTo(map));

      if (!didInitialRouteFitRef.current) {
        didInitialRouteFitRef.current = true;
        try { map.fitBounds(L.latLngBounds(points as any), { padding: [35, 35], maxZoom: 10 }); } catch {}
      }
    }
    updateRoute();
  }, [route]);

  useEffect(() => {
    async function updateOwnShip() {
      const map = mapRef.current;
      const layer = ownLayerRef.current;
      if (!map || !layer || !ownShip) return;
      const L = await import("leaflet");
      const position: [number, number] = [ownShip.lat, ownShip.lon];
      const orientation = ownShip.heading !== null && Number.isFinite(ownShip.heading) ? ownShip.heading : ownShip.cog;
      const icon = L.divIcon({
        className: "navmap-main-ownship-icon",
        html: `<div style="width:30px;height:30px;transform:rotate(${orientation}deg);transform-origin:15px 15px;filter:drop-shadow(0 0 5px rgba(34,211,238,.35))"><svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#071019" stroke="#22d3ee" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#f1d56b" stroke-width="1.5"/><circle cx="15" cy="15" r="2.4" fill="#22d3ee"/></svg></div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      });
      if (!ownMarkerRef.current) ownMarkerRef.current = L.marker(position, { icon, pane: "navmap-main-ownship-v2", interactive: false }).addTo(layer);
      else { ownMarkerRef.current.setLatLng(position); ownMarkerRef.current.setIcon(icon); }

      if (headingVectorRef.current) layer.removeLayer(headingVectorRef.current);
      if (cogVectorRef.current) layer.removeLayer(cogVectorRef.current);
      headingVectorRef.current = null; cogVectorRef.current = null;

      if (ownShip.heading !== null && Number.isFinite(ownShip.heading)) {
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.heading, 0.8);
        headingVectorRef.current = L.polyline([position, [end.lat, end.lon]], { pane: "navmap-main-ownship-v2", color: "#f1d56b", weight: 2, opacity: 0.9 }).addTo(layer);
      }
      if (Number.isFinite(ownShip.sog) && ownShip.sog > 0.1 && Number.isFinite(ownShip.cog)) {
        const distanceNm = ownShip.sog * (6 / 60);
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.cog, distanceNm);
        cogVectorRef.current = L.polyline([position, [end.lat, end.lon]], { pane: "navmap-main-ownship-v2", color: "#22d3ee", weight: 2.5, opacity: 0.95, dashArray: "8 6" }).addTo(layer);
      }
    }
    updateOwnShip();
  }, [ownShip]);

  return <div ref={elementRef} id="navmap-main-isolated-v2" style={{ position: "absolute", inset: 0, zIndex: 650, width: "100%", height: "100%", minHeight: "100%", background: "#0a141d" }} />;
}
