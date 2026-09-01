"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type Vessel = {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updatedAt: number;
};

type OwnShip = Vessel;

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

function decodeAisPosition(line: string): Vessel | null {
  try {
    if (!line.startsWith("!AIVDM") && !line.startsWith("!AIVDO")) return null;
    const parts = line.split(",");
    if (Number(parts[1]) !== 1 || !parts[5]) return null;

    const bits = payloadToBits(parts[5]);
    const type = unsigned(bits, 0, 6);
    const mmsi = unsigned(bits, 8, 30);

    let sog: number | null = null;
    let cog: number | null = null;
    let heading: number | null = null;
    let lon = 0;
    let lat = 0;

    if ([1, 2, 3].includes(type)) {
      const sogRaw = unsigned(bits, 50, 10);
      lon = signed(bits, 61, 28) / 600000;
      lat = signed(bits, 89, 27) / 600000;
      const cogRaw = unsigned(bits, 116, 12);
      const headingRaw = unsigned(bits, 128, 9);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
      heading = headingRaw === 511 ? null : headingRaw;
    } else if (type === 18) {
      const sogRaw = unsigned(bits, 46, 10);
      lon = signed(bits, 57, 28) / 600000;
      lat = signed(bits, 85, 27) / 600000;
      const cogRaw = unsigned(bits, 112, 12);
      const headingRaw = unsigned(bits, 124, 9);
      sog = sogRaw >= 1023 ? null : sogRaw / 10;
      cog = cogRaw >= 3600 ? null : cogRaw / 10;
      heading = headingRaw === 511 ? null : headingRaw;
    } else {
      return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;

    return { mmsi, lat, lon, sog, cog, heading, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

function destinationPoint(lat: number, lon: number, bearing: number, distanceNm: number) {
  const radiusNm = 3440.065;
  const d = distanceNm / radiusNm;
  const brg = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180 };
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

function vesselIconHtml(vessel: Vessel, ownShip: boolean) {
  const orientation = vessel.heading ?? vessel.cog ?? 0;
  const stroke = ownShip ? "#22d3ee" : "#38bdf8";
  const fill = ownShip ? "#071019" : "#08131c";
  const accent = ownShip ? "#f1d56b" : "#38bdf8";
  const size = ownShip ? 34 : 22;
  const center = size / 2;
  return `<div style="width:${size}px;height:${size}px;transform:rotate(${orientation}deg);transform-origin:${center}px ${center}px;filter:drop-shadow(0 0 4px rgba(34,211,238,.35))"><svg width="${size}" height="${size}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 1 L24 25 L15 20 L6 25 Z" fill="${fill}" stroke="${stroke}" stroke-width="${ownShip ? 2.2 : 1.8}" stroke-linejoin="round"/><path d="M15 4 L15 20" stroke="${accent}" stroke-width="1.4"/><circle cx="15" cy="15" r="2" fill="${stroke}"/></svg></div>`;
}

export default function PilotPage() {
  const { nightMode, toggleTheme } = useBridgeTheme();
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const ownLayerRef = useRef<any>(null);
  const targetLayerRef = useRef<any>(null);
  const ownMarkerRef = useRef<any>(null);
  const headingVectorRef = useRef<any>(null);
  const cogVectorRef = useRef<any>(null);
  const targetMarkersRef = useRef<Map<number, any>>(new Map());
  const followingRef = useRef(true);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [targets, setTargets] = useState<Map<number, Vessel>>(new Map());
  const [aisStatus, setAisStatus] = useState("CONNECTING");
  const [following, setFollowing] = useState(true);
  const [chartStatus, setChartStatus] = useState("NOAA ENC");

  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initMap() {
      const element = mapElementRef.current;
      if (!element || mapRef.current || cancelled) return;
      const L = await import("leaflet");

      if (!document.querySelector('link[data-pilot-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-pilot-leaflet", "true");
        document.head.appendChild(link);
      }

      const map = L.map(element, {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      }).setView([13.4443, 144.7937], 10);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        opacity: 0.18,
      }).addTo(map);

      try {
        L.tileLayer.wms(
          "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer",
          {
            layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            opacity: 1,
          } as any,
        ).addTo(map);
      } catch {
        setChartStatus("CHART FALLBACK");
      }

      const targetPane = map.createPane("pilot-targets");
      targetPane.style.zIndex = "710";
      const ownPane = map.createPane("pilot-ownship");
      ownPane.style.zIndex = "720";
      targetLayerRef.current = L.layerGroup([], { pane: "pilot-targets" } as any).addTo(map);
      ownLayerRef.current = L.layerGroup([], { pane: "pilot-ownship" } as any).addTo(map);
      mapRef.current = map;

      const breakFollow = () => {
        if (!followingRef.current) return;
        followingRef.current = false;
        setFollowing(false);
      };
      map.on("dragstart", breakFollow);
      map.on("zoomstart", breakFollow);

      const invalidate = () => requestAnimationFrame(() => map.invalidateSize({ animate: false }));
      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(element);
      window.addEventListener("resize", invalidate);
      for (const delay of [0, 100, 300, 700]) window.setTimeout(invalidate, delay);
      (element as any).__pilotInvalidate = invalidate;
    }

    initMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      const element = mapElementRef.current as any;
      if (element?.__pilotInvalidate) window.removeEventListener("resize", element.__pilotInvalidate);
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      ownLayerRef.current = null;
      targetLayerRef.current = null;
      ownMarkerRef.current = null;
      headingVectorRef.current = null;
      cogVectorRef.current = null;
      targetMarkersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setAisStatus("CONNECTING");
      try {
        socket = new WebSocket(getAisWebSocketUrl());
        socket.onopen = () => setAisStatus("AIS LIVE");
        socket.onmessage = (event) => {
          let raw = String(event.data || "");
          try {
            const json = JSON.parse(raw);
            raw = typeof json === "string" ? json : json?.sentence || json?.nmea || json?.raw || json?.line || raw;
          } catch {}

          for (const sourceLine of raw.split(/\r?\n/)) {
            const line = sourceLine.trim();
            const decoded = decodeAisPosition(line);
            if (!decoded) continue;
            if (line.startsWith("!AIVDO")) {
              setOwnShip(decoded);
            } else {
              setTargets((current) => {
                const next = new Map(current);
                next.set(decoded.mmsi, decoded);
                return next;
              });
            }
          }
        };
        socket.onerror = () => setAisStatus("AIS CHECK");
        socket.onclose = () => {
          if (closed) return;
          setAisStatus("RECONNECTING");
          retryTimer = window.setTimeout(connect, 2000);
        };
      } catch {
        setAisStatus("RECONNECTING");
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
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 10 * 60 * 1000;
      setTargets((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [mmsi, vessel] of next) {
          if (vessel.updatedAt < cutoff) {
            next.delete(mmsi);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    async function drawOwnShip() {
      const map = mapRef.current;
      const layer = ownLayerRef.current;
      if (!map || !layer || !ownShip) return;
      const L = await import("leaflet");
      const pos: [number, number] = [ownShip.lat, ownShip.lon];
      const icon = L.divIcon({
        className: "pilot-ownship-icon",
        html: vesselIconHtml(ownShip, true),
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      if (!ownMarkerRef.current) {
        ownMarkerRef.current = L.marker(pos, { icon, pane: "pilot-ownship", interactive: false }).addTo(layer);
      } else {
        ownMarkerRef.current.setLatLng(pos);
        ownMarkerRef.current.setIcon(icon);
      }

      if (headingVectorRef.current) layer.removeLayer(headingVectorRef.current);
      if (cogVectorRef.current) layer.removeLayer(cogVectorRef.current);
      headingVectorRef.current = null;
      cogVectorRef.current = null;

      if (ownShip.heading !== null) {
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.heading, 1);
        headingVectorRef.current = L.polyline([pos, [end.lat, end.lon]], {
          pane: "pilot-ownship",
          color: "#f1d56b",
          weight: 2,
          opacity: 0.9,
        }).addTo(layer);
      }

      if (ownShip.cog !== null && ownShip.sog !== null && ownShip.sog > 0.1) {
        const end = destinationPoint(ownShip.lat, ownShip.lon, ownShip.cog, ownShip.sog * 0.1);
        cogVectorRef.current = L.polyline([pos, [end.lat, end.lon]], {
          pane: "pilot-ownship",
          color: "#22d3ee",
          weight: 2.5,
          opacity: 0.95,
          dashArray: "8 6",
        }).addTo(layer);
      }

      if (followingRef.current) map.panTo(pos, { animate: false });
    }
    drawOwnShip();
  }, [ownShip]);

  useEffect(() => {
    async function drawTargets() {
      const layer = targetLayerRef.current;
      if (!layer) return;
      const L = await import("leaflet");
      const live = new Set<number>();

      for (const [mmsi, vessel] of targets) {
        live.add(mmsi);
        const pos: [number, number] = [vessel.lat, vessel.lon];
        const icon = L.divIcon({
          className: "pilot-target-icon",
          html: vesselIconHtml(vessel, false),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const popup = `<div style="font-family:ui-monospace,monospace;min-width:150px"><b>MMSI ${mmsi}</b><br/>COG ${vessel.cog === null ? "---" : vessel.cog.toFixed(1) + "°"}<br/>SOG ${vessel.sog === null ? "---" : vessel.sog.toFixed(1) + " kt"}<br/>HDG ${vessel.heading === null ? "---" : vessel.heading.toFixed(0) + "°"}</div>`;
        const existing = targetMarkersRef.current.get(mmsi);
        if (existing) {
          existing.setLatLng(pos);
          existing.setIcon(icon);
          existing.setPopupContent(popup);
        } else {
          const marker = L.marker(pos, { icon, pane: "pilot-targets" }).bindPopup(popup).addTo(layer);
          targetMarkersRef.current.set(mmsi, marker);
        }
      }

      for (const [mmsi, marker] of targetMarkersRef.current) {
        if (!live.has(mmsi)) {
          layer.removeLayer(marker);
          targetMarkersRef.current.delete(mmsi);
        }
      }
    }
    drawTargets();
  }, [targets]);

  const targetCount = targets.size;
  const positionText = useMemo(() => {
    if (!ownShip) return { lat: "--° --.---'", lon: "---° --.---'" };
    return { lat: formatLat(ownShip.lat), lon: formatLon(ownShip.lon) };
  }, [ownShip]);

  function centerOwnShip() {
    if (!mapRef.current || !ownShip) return;
    followingRef.current = true;
    setFollowing(true);
    mapRef.current.setView([ownShip.lat, ownShip.lon], Math.max(mapRef.current.getZoom(), 12), { animate: false });
  }

  function zoom(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    followingRef.current = false;
    setFollowing(false);
    map.setZoom(map.getZoom() + delta, { animate: false });
  }

  const shell = nightMode ? "bg-[#03070a] text-slate-100" : "bg-[#eef2f4] text-[#0c1720]";
  const panel = nightMode ? "border-[#263846] bg-[#071019]/95" : "border-[#aab8c1] bg-white/95";
  const muted = nightMode ? "text-slate-500" : "text-slate-500";
  const value = nightMode ? "text-cyan-300" : "text-[#006b82]";

  return (
    <main className={`h-[100dvh] w-screen overflow-hidden ${shell}`}>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <header className={`grid grid-cols-[minmax(190px,1.4fr)_repeat(3,minmax(88px,.55fr))_auto] items-stretch border-b ${panel}`}>
          <div className="min-w-0 px-4 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c9a227]">NAVDASH PILOT</div>
            <div className={`truncate font-mono text-[13px] font-bold ${value}`}>{positionText.lat} &nbsp; {positionText.lon}</div>
          </div>
          <div className="border-l border-current/10 px-3 py-2 text-center">
            <div className={`text-[9px] font-black uppercase tracking-[0.12em] ${muted}`}>HDG</div>
            <div className={`font-mono text-2xl font-black ${value}`}>{ownShip?.heading == null ? "---" : `${ownShip.heading.toFixed(0)}°`}</div>
          </div>
          <div className="border-l border-current/10 px-3 py-2 text-center">
            <div className={`text-[9px] font-black uppercase tracking-[0.12em] ${muted}`}>COG</div>
            <div className={`font-mono text-2xl font-black ${value}`}>{ownShip?.cog == null ? "---" : `${ownShip.cog.toFixed(1)}°`}</div>
          </div>
          <div className="border-l border-current/10 px-3 py-2 text-center">
            <div className={`text-[9px] font-black uppercase tracking-[0.12em] ${muted}`}>SOG</div>
            <div className={`font-mono text-2xl font-black ${value}`}>{ownShip?.sog == null ? "---" : `${ownShip.sog.toFixed(1)}`}</div>
            <div className={`-mt-1 text-[8px] font-black ${muted}`}>KT</div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <div className={`border px-2 py-1 text-[9px] font-black ${aisStatus === "AIS LIVE" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}>{aisStatus}</div>
            <button type="button" onClick={toggleTheme} className={`border px-2 py-1 text-[9px] font-black ${panel}`}>{nightMode ? "DAY" : "NIGHT"}</button>
          </div>
        </header>

        <section className="relative min-h-0">
          <div ref={mapElementRef} className="absolute inset-0" style={{ background: nightMode ? "#071019" : "#dce7eb" }} />

          <div className="pointer-events-none absolute left-3 top-3 z-[800] flex flex-col gap-2">
            <div className={`pointer-events-auto border px-3 py-2 shadow-xl ${panel}`}>
              <div className={`text-[8px] font-black uppercase tracking-[0.14em] ${muted}`}>CHART</div>
              <div className="text-[11px] font-black text-[#c9a227]">{chartStatus}</div>
            </div>
            <div className={`pointer-events-auto border px-3 py-2 shadow-xl ${panel}`}>
              <div className={`text-[8px] font-black uppercase tracking-[0.14em] ${muted}`}>AIS TARGETS</div>
              <div className={`font-mono text-xl font-black ${value}`}>{targetCount}</div>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 right-4 z-[800] flex flex-col gap-2">
            <button type="button" onClick={() => zoom(1)} className={`pointer-events-auto h-11 w-12 border text-xl font-black shadow-xl ${panel}`}>+</button>
            <button type="button" onClick={() => zoom(-1)} className={`pointer-events-auto h-11 w-12 border text-xl font-black shadow-xl ${panel}`}>−</button>
            <button type="button" onClick={centerOwnShip} disabled={!ownShip} className={`pointer-events-auto min-w-[118px] border px-3 py-3 text-[10px] font-black shadow-xl ${following ? "border-cyan-400/50 text-cyan-300" : panel}`}>{following ? "FOLLOWING" : "CENTER SHIP"}</button>
          </div>

          <div className={`pointer-events-none absolute bottom-4 left-4 z-[800] border px-3 py-2 text-[9px] font-bold shadow-xl ${panel}`}>
            <span className={muted}>AIS ONLY</span>
            <span className="mx-2 text-[#c9a227]">•</span>
            <span className={muted}>6 MIN COG VECTOR</span>
          </div>
        </section>
      </div>
    </main>
  );
}
