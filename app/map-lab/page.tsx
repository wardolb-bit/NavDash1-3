"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

type OwnShip = {
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number | null;
};

function sixBitCharToValue(char: string) {
  let value = char.charCodeAt(0) - 48;
  if (value > 40) value -= 8;
  return value;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function unsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

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

    return {
      lat,
      lon,
      sog,
      cog,
      heading: headingRaw === 511 ? null : headingRaw,
    };
  } catch {
    return null;
  }
}

function destinationPoint(lat: number, lon: number, bearing: number, distanceNm: number) {
  const radiusNm = 3440.065;
  const distanceRad = distanceNm / radiusNm;
  const bearingRad = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceRad) +
      Math.cos(lat1) * Math.sin(distanceRad) * Math.cos(bearingRad),
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(distanceRad) * Math.cos(lat1),
      Math.cos(distanceRad) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}

function formatLat(value: number) {
  const hemi = value >= 0 ? "N" : "S";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(2, "0")}° ${min.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

function formatLon(value: number) {
  const hemi = value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(3, "0")}° ${min.toFixed(3).padStart(6, "0")}' ${hemi}`;
}

export default function MapLabPage() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const ownShipLayerRef = useRef<any>(null);
  const ownShipMarkerRef = useRef<any>(null);
  const headingVectorRef = useRef<any>(null);
  const cogVectorRef = useRef<any>(null);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [aisStatus, setAisStatus] = useState("Connecting to AIS…");

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initMap() {
      const element = mapElementRef.current;
      if (!element || mapRef.current || cancelled) return;

      const L = await import("leaflet");

      if (!document.querySelector('link[data-navmap-lab-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-navmap-lab-leaflet", "true");
        document.head.appendChild(link);
      }

      const map = L.map(element, {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: false,
      }).setView([13.4443, 144.7937], 7);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      try {
        L.tileLayer
          .wms(
            "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer",
            {
              layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
              format: "image/png",
              transparent: true,
              version: "1.1.1",
              opacity: 0.85,
            } as any,
          )
          .addTo(map);
      } catch {}

      const ownPane = map.createPane("navmap-ownship");
      ownPane.style.zIndex = "720";
      ownShipLayerRef.current = L.layerGroup([], { pane: "navmap-ownship" } as any).addTo(map);

      mapRef.current = map;

      const invalidate = () => {
        requestAnimationFrame(() => map.invalidateSize({ animate: false }));
      };

      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(element);
      window.addEventListener("resize", invalidate);

      for (const delay of [0, 80, 220, 500, 1000]) {
        window.setTimeout(invalidate, delay);
      }

      (element as any).__navmapInvalidate = invalidate;
    }

    initMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      const element = mapElementRef.current as any;
      if (element?.__navmapInvalidate) {
        window.removeEventListener("resize", element.__navmapInvalidate);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      ownShipLayerRef.current = null;
      ownShipMarkerRef.current = null;
      headingVectorRef.current = null;
      cogVectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setAisStatus("Connecting to AIS…");

      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onopen = () => setAisStatus("AIS LIVE");
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
        socket.onerror = () => setAisStatus("AIS CHECK");
        socket.onclose = () => {
          if (closed) return;
          setAisStatus("AIS RECONNECTING");
          retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        setAisStatus("AIS RECONNECTING");
        retryTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    async function updateOwnShip() {
      const map = mapRef.current;
      const layer = ownShipLayerRef.current;
      if (!map || !layer || !ownShip) return;

      const L = await import("leaflet");
      const position: [number, number] = [ownShip.lat, ownShip.lon];
      const orientation = Number.isFinite(ownShip.heading as number) ? (ownShip.heading as number) : ownShip.cog;

      const icon = L.divIcon({
        className: "navmap-ownship-icon",
        html: `<div style="width:30px;height:30px;transform:rotate(${orientation}deg);transform-origin:15px 15px;filter:drop-shadow(0 0 5px rgba(34,211,238,.35))"><svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="#071019" stroke="#22d3ee" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="#f1d56b" stroke-width="1.5"/><circle cx="15" cy="15" r="2.4" fill="#22d3ee"/></svg></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      if (!ownShipMarkerRef.current) {
        ownShipMarkerRef.current = L.marker(position, {
          icon,
          pane: "navmap-ownship",
          interactive: false,
        }).addTo(layer);
      } else {
        ownShipMarkerRef.current.setLatLng(position);
        ownShipMarkerRef.current.setIcon(icon);
      }

      if (headingVectorRef.current) layer.removeLayer(headingVectorRef.current);
      if (cogVectorRef.current) layer.removeLayer(cogVectorRef.current);
      headingVectorRef.current = null;
      cogVectorRef.current = null;

      if (ownShip.heading !== null && Number.isFinite(ownShip.heading)) {
        const headingEnd = destinationPoint(ownShip.lat, ownShip.lon, ownShip.heading, 0.8);
        headingVectorRef.current = L.polyline(
          [position, [headingEnd.lat, headingEnd.lon]],
          {
            pane: "navmap-ownship",
            color: "#f1d56b",
            weight: 2,
            opacity: 0.9,
          },
        ).addTo(layer);
      }

      if (Number.isFinite(ownShip.sog) && ownShip.sog > 0.1 && Number.isFinite(ownShip.cog)) {
        const distanceNm = ownShip.sog * (6 / 60);
        const cogEnd = destinationPoint(ownShip.lat, ownShip.lon, ownShip.cog, distanceNm);
        cogVectorRef.current = L.polyline(
          [position, [cogEnd.lat, cogEnd.lon]],
          {
            pane: "navmap-ownship",
            color: "#22d3ee",
            weight: 2.5,
            opacity: 0.95,
            dashArray: "8 6",
          },
        ).addTo(layer);
      }
    }

    updateOwnShip();
  }, [ownShip]);

  const centerOwnShip = () => {
    if (!mapRef.current || !ownShip) return;
    mapRef.current.setView([ownShip.lat, ownShip.lon], Math.max(mapRef.current.getZoom(), 9), { animate: false });
    mapRef.current.invalidateSize({ animate: false });
  };

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 flex items-center justify-between border border-amber-500/25 bg-[#071019] px-3 py-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a227]">NAVMAP ISOLATION LAB</div>
          <div className="text-sm font-black">Independent Leaflet lifecycle test</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="border border-slate-700 bg-[#050a0f] px-3 py-2 text-[10px] font-black text-emerald-300">{aisStatus}</span>
          <button
            type="button"
            onClick={centerOwnShip}
            className="border border-cyan-400/40 bg-[#071019] px-3 py-2 text-[10px] font-black text-cyan-200"
          >
            CENTER OWN SHIP
          </button>
          <Link href="/" className="border border-[#c9a227]/50 bg-[#101820] px-3 py-2 text-[10px] font-black text-[#f1d56b]">
            NAV CONSOLE
          </Link>
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="border border-slate-700/50 bg-[#071019] p-1">
          <div
            ref={mapElementRef}
            id="navmap-lab-map"
            style={{ width: "100%", height: "calc(100vh - 86px)", minHeight: "620px", background: "#0a141d" }}
          />
        </section>

        <aside className="border border-slate-700/50 bg-[#071019] p-4">
          <div className="mb-4 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">OWN SHIP</div>
          <div className="space-y-2 font-mono text-xl font-black text-cyan-300">
            <div>{ownShip ? formatLat(ownShip.lat) : "--"}</div>
            <div>{ownShip ? formatLon(ownShip.lon) : "--"}</div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="border border-slate-800 bg-[#050a0f] p-3">
              <div className="text-[9px] font-black text-slate-500">COG</div>
              <div className="mt-1 text-2xl font-black">{ownShip ? `${ownShip.cog.toFixed(1)}°` : "--"}</div>
            </div>
            <div className="border border-slate-800 bg-[#050a0f] p-3">
              <div className="text-[9px] font-black text-slate-500">SOG</div>
              <div className="mt-1 text-2xl font-black">{ownShip ? `${ownShip.sog.toFixed(1)} KT` : "--"}</div>
            </div>
            <div className="border border-slate-800 bg-[#050a0f] p-3">
              <div className="text-[9px] font-black text-slate-500">HDG</div>
              <div className="mt-1 text-2xl font-black">{ownShip?.heading !== null && ownShip ? `${ownShip.heading.toFixed(0)}°` : "--"}</div>
            </div>
            <div className="border border-slate-800 bg-[#050a0f] p-3">
              <div className="text-[9px] font-black text-slate-500">VECTOR</div>
              <div className="mt-1 text-sm font-black text-cyan-200">6 MIN COG</div>
            </div>
          </div>
          <div className="mt-5 text-xs leading-5 text-slate-400">
            This lab owns its own Leaflet container, resize observer, AIS connection, own-ship marker, heading vector, and COG vector. The bridge-console DOM enhancers do not touch this map.
          </div>
        </aside>
      </div>
    </main>
  );
}
