"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";

const ROUTE_STORAGE_KEY = "navconsole-saved-route";
const ECDIS_WMS = "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer";

type OwnShip = { lat: number; lon: number; sog: number; cog: number };
type Waypoint = { lat: number; lon: number; name?: string; id?: string };

function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}
function payloadToBits(payload: string) {
  return payload.split("").map(char => sixBitCharToValue(char).toString(2).padStart(6, "0")).join("");
}
function getUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}
function getSigned(bits: string, start: number, length: number) {
  const value = getUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}
function decodeOwnShip(sentence: string): OwnShip | null {
  try {
    if (!sentence.startsWith("!AIVDO")) return null;
    const parts = sentence.split(",");
    if (parts.length < 6) return null;
    const bits = payloadToBits(parts[5]);
    if (![1, 2, 3].includes(getUnsigned(bits, 0, 6))) return null;
    const sog = getUnsigned(bits, 50, 10) / 10;
    const lon = getSigned(bits, 61, 28) / 600000;
    const lat = getSigned(bits, 89, 27) / 600000;
    const cog = getUnsigned(bits, 116, 12) / 10;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, sog, cog };
  } catch {
    return null;
  }
}

function loadRoute(): Waypoint[] {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const rawWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
    return rawWaypoints
      .map((wp: any) => ({
        lat: Number(wp.lat ?? wp.latitude ?? wp.position?.lat ?? wp.position?.latitude),
        lon: Number(wp.lon ?? wp.longitude ?? wp.position?.lon ?? wp.position?.longitude),
        name: wp.name,
        id: wp.id,
      }))
      .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
  } catch {
    return [];
  }
}

export default function EncLabPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ownShipMarker = useRef<L.CircleMarker | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [status, setStatus] = useState("Connecting to wheelhouse AIS…");
  const [chartMode, setChartMode] = useState<"ecdis" | "plain">("ecdis");

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    const map = L.map(mapNode.current, {
      zoomControl: true,
      worldCopyJump: true,
      preferCanvas: true,
    }).setView([13.45, 144.75], 8);

    const plain = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    });

    const ecdis = L.tileLayer.wms(ECDIS_WMS, {
      layers: "0",
      format: "image/png",
      transparent: false,
      version: "1.3.0",
      maxZoom: 18,
      attribution: "NOAA ENC / IHO S-52 portrayal",
    } as L.WMSOptions);

    ecdis.addTo(map);
    (map as any)._encLayers = { ecdis, plain };

    const route = loadRoute();
    if (route.length > 1) {
      routeLayer.current = L.polyline(route.map(wp => [wp.lat, wp.lon] as [number, number]), {
        color: "#f2cf5b",
        weight: 3,
        opacity: 0.95,
      }).addTo(map);
      map.fitBounds(routeLayer.current.getBounds(), { padding: [40, 40] });
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current as (L.Map & { _encLayers?: { ecdis: L.TileLayer.WMS; plain: L.TileLayer } }) | null;
    if (!map?._encLayers) return;
    const { ecdis, plain } = map._encLayers;
    if (chartMode === "ecdis") {
      if (map.hasLayer(plain)) map.removeLayer(plain);
      if (!map.hasLayer(ecdis)) ecdis.addTo(map);
    } else {
      if (map.hasLayer(ecdis)) map.removeLayer(ecdis);
      if (!map.hasLayer(plain)) plain.addTo(map);
    }
  }, [chartMode]);

  useEffect(() => {
    const ws = new WebSocket(getAisWebSocketUrl());
    ws.onopen = () => setStatus("AIS LIVE");
    ws.onerror = () => setStatus("AIS unavailable");
    ws.onclose = () => setStatus("AIS disconnected");
    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "nmea") return;
        const decoded = decodeOwnShip(String(msg.line || ""));
        if (!decoded) return;
        setOwnShip(decoded);

        const map = mapRef.current;
        if (!map) return;
        if (!ownShipMarker.current) {
          ownShipMarker.current = L.circleMarker([decoded.lat, decoded.lon], {
            radius: 8,
            color: "#42d3c8",
            weight: 2,
            fillColor: "#42d3c8",
            fillOpacity: 0.8,
          }).addTo(map);
          map.setView([decoded.lat, decoded.lon], Math.max(map.getZoom(), 9));
        } else {
          ownShipMarker.current.setLatLng([decoded.lat, decoded.lon]);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const centerOwnShip = () => {
    if (ownShip && mapRef.current) mapRef.current.setView([ownShip.lat, ownShip.lon], Math.max(mapRef.current.getZoom(), 10));
  };

  const fitRoute = () => {
    if (routeLayer.current && mapRef.current) mapRef.current.fitBounds(routeLayer.current.getBounds(), { padding: [40, 40] });
  };

  return (
    <main className="min-h-screen bg-[#04080c] p-2 text-slate-100">
      <div className="mb-2 grid grid-cols-[260px_1fr_auto] items-center border border-[#c9a227]/30 bg-[#071019] px-3 py-2">
        <div>
          <div className="text-sm font-black tracking-[.18em] text-[#e7c95c]">NAVDASH ENC LAB</div>
          <div className="mt-1 text-[10px] font-bold tracking-[.14em] text-slate-500">NOAA ENC / S-52 PROTOTYPE</div>
        </div>
        <div className="text-center text-[10px] font-black tracking-[.14em] text-emerald-300">{status}</div>
        <div className="flex gap-1">
          <button className="border border-slate-600 bg-[#0a141d] px-3 py-2 text-[10px] font-black" onClick={centerOwnShip}>Own Ship</button>
          <button className="border border-slate-600 bg-[#0a141d] px-3 py-2 text-[10px] font-black" onClick={fitRoute}>Route Fit</button>
          <button
            className="border border-[#c9a227]/60 bg-[#0a141d] px-3 py-2 text-[10px] font-black text-[#e7c95c]"
            onClick={() => setChartMode(mode => mode === "ecdis" ? "plain" : "ecdis")}
          >
            {chartMode === "ecdis" ? "S-52 ENC" : "Plain Map"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-2">
        <section className="relative border border-slate-700 bg-[#071019]">
          <div ref={mapNode} className="h-[calc(100vh-78px)] min-h-[650px] w-full" />
        </section>

        <aside className="border border-slate-700 bg-[#071019] p-3">
          <div className="border-b border-slate-700 pb-3">
            <div className="text-[9px] font-black tracking-[.18em] text-[#c9a227]">OWN SHIP</div>
            <div className="mt-2 font-mono text-xl text-[#42d3c8]">{ownShip ? ownShip.lat.toFixed(5) : "--"}</div>
            <div className="font-mono text-xl text-[#42d3c8]">{ownShip ? ownShip.lon.toFixed(5) : "--"}</div>
          </div>
          <div className="grid grid-cols-2 border-b border-slate-700 py-3">
            <div><div className="text-[9px] font-black text-slate-500">COG</div><div className="mt-1 text-2xl font-black">{ownShip ? `${ownShip.cog.toFixed(1)}°` : "--"}</div></div>
            <div><div className="text-[9px] font-black text-slate-500">SOG</div><div className="mt-1 text-2xl font-black">{ownShip ? `${ownShip.sog.toFixed(1)} kt` : "--"}</div></div>
          </div>
          <div className="pt-3 text-xs leading-5 text-slate-400">
            Experimental situational-awareness display using NOAA's ECDIS Display Service. Not an approved ECDIS or chart-carriage system.
          </div>
        </aside>
      </div>
    </main>
  );
}
