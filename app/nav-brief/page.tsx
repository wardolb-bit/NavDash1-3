"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type RouteBrief = {
  routeName: string;
  waypoints: Waypoint[];
};

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function toDeg(value: number) {
  return (value * 180) / Math.PI;
}

function nmBetween(a: Waypoint, b: Waypoint) {
  const rNm = 3440.065;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * rNm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a: Waypoint, b: Waypoint) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function formatCoord(value: number, isLat: boolean) {
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const degText = isLat ? String(deg).padStart(2, "0") : String(deg).padStart(3, "0");
  return `${degText}° ${min.toFixed(3)}' ${hemi}`;
}

function parseCoordinate(raw: string | null, isLat: boolean) {
  if (!raw) return NaN;
  const text = raw.trim();

  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;

  const hemiMatch = text.match(/[NSEW]/i);
  const hemi = hemiMatch?.[0]?.toUpperCase();

  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return NaN;

  let value = nums[0];
  if (nums.length >= 2) value = Math.abs(nums[0]) + nums[1] / 60;
  if (nums.length >= 3) value = Math.abs(nums[0]) + nums[1] / 60 + nums[2] / 3600;

  if (hemi === "S" || hemi === "W") value *= -1;
  if (!hemi && nums[0] < 0) value *= -1;

  if (isLat && Math.abs(value) > 90) return NaN;
  if (!isLat && Math.abs(value) > 180) return NaN;

  return value;
}

function getAttr(node: Element, names: string[]) {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) return value;
  }
  return null;
}

function findName(node: Element, fallback: string) {
  const attrName = getAttr(node, ["name", "Name", "id", "ID"]);
  if (attrName) return attrName;

  const nameNode =
    node.querySelector("name") ||
    node.querySelector("Name") ||
    node.querySelector("waypointName") ||
    node.querySelector("WaypointName");

  const text = nameNode?.textContent?.trim();
  return text || fallback;
}

function parseRtz(xmlText: string): RouteBrief {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Could not parse RTZ/XML route file.");

  const routeNode =
    doc.querySelector("route") ||
    doc.querySelector("Route") ||
    doc.documentElement;

  const routeName =
    getAttr(routeNode, ["name", "Name", "id", "ID"]) ||
    routeNode.querySelector("routeName")?.textContent?.trim() ||
    routeNode.querySelector("name")?.textContent?.trim() ||
    "Loaded RTZ Route";

  const possibleWpNodes = Array.from(
    doc.querySelectorAll("waypoint, Waypoint, wp, WP")
  );

  const waypoints: Waypoint[] = [];

  possibleWpNodes.forEach((node, index) => {
    const pos =
      node.querySelector("position") ||
      node.querySelector("Position") ||
      node.querySelector("pos") ||
      node;

    const latRaw =
      getAttr(pos, ["lat", "Lat", "latitude", "Latitude"]) ||
      getAttr(node, ["lat", "Lat", "latitude", "Latitude"]);

    const lonRaw =
      getAttr(pos, ["lon", "Lon", "longitude", "Longitude"]) ||
      getAttr(pos, ["long", "Long"]) ||
      getAttr(node, ["lon", "Lon", "longitude", "Longitude"]) ||
      getAttr(node, ["long", "Long"]);

    const lat = parseCoordinate(latRaw, true);
    const lon = parseCoordinate(lonRaw, false);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      waypoints.push({
        id: getAttr(node, ["id", "ID", "revision", "number"]) || `WP${String(index + 1).padStart(3, "0")}`,
        name: findName(node, `Waypoint ${index + 1}`),
        lat,
        lon,
      });
    }
  });

  if (waypoints.length < 2) {
    throw new Error("Route needs at least two valid waypoints.");
  }

  return { routeName, waypoints };
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatDateTimeLocal(date: Date) {
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function segmentRows(waypoints: Waypoint[]) {
  return waypoints.slice(1).map((wp, index) => {
    const from = waypoints[index];
    const distance = nmBetween(from, wp);
    const bearing = bearingBetween(from, wp);

    return {
      from,
      to: wp,
      distance,
      bearing,
    };
  });
}

function totalDistance(waypoints: Waypoint[]) {
  return segmentRows(waypoints).reduce((sum, leg) => sum + leg.distance, 0);
}

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default function NavBriefBuilderPage() {
  const [route, setRoute] = useState<RouteBrief | null>(null);
  const [routeError, setRouteError] = useState("");
  const [plannedSpeed, setPlannedSpeed] = useState("10");
  const [departure, setDeparture] = useState("");
  const [weatherSummary, setWeatherSummary] = useState("");
  const [gribFileName, setGribFileName] = useState("");
  const [gribStatus, setGribStatus] = useState("");
  const [gribInventory, setGribInventory] = useState("");
  const [officialForecast, setOfficialForecast] = useState("");
  const [opsNotes, setOpsNotes] = useState("");
  const [portNotes, setPortNotes] = useState("");
  const [briefGenerated, setBriefGenerated] = useState(false);

  const legs = useMemo(() => (route ? segmentRows(route.waypoints) : []), [route]);
  const distanceNm = useMemo(() => (route ? totalDistance(route.waypoints) : 0), [route]);
  const speed = safeNumber(plannedSpeed, 10);
  const voyageHours = distanceNm / speed;

  const departureDate = departure ? new Date(departure) : null;
  const eta = departureDate ? addHours(departureDate, voyageHours) : null;

  async function loadRtz(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setRouteError("");
    setBriefGenerated(false);

    try {
      const text = await file.text();
      const parsed = parseRtz(text);
      setRoute(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load route.";
      setRoute(null);
      setRouteError(message);
    }
  }

  async function loadSharedRoute() {
    setRouteError("");

    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route state API returned ${response.status}`);

      const data = await response.json();
      const waypoints = Array.isArray(data?.waypoints)
        ? data.waypoints
            .map((wp: any, index: number) => ({
              id: String(wp.id || `WP${String(index + 1).padStart(3, "0")}`),
              name: String(wp.name || wp.id || `Waypoint ${index + 1}`),
              lat: Number(wp.lat),
              lon: Number(wp.lon),
            }))
            .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon))
        : [];

      if (waypoints.length < 2) throw new Error("No shared route is loaded on the server.");

      setRoute({
        routeName: String(data.routeName || "Shared NavDash Route"),
        waypoints,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load shared route.";
      setRouteError(message);
    }
  }

  function routeCenter() {
    if (!route?.waypoints.length) return null;

    const lat =
      route.waypoints.reduce((sum, wp) => sum + wp.lat, 0) / route.waypoints.length;
    const lon =
      route.waypoints.reduce((sum, wp) => sum + wp.lon, 0) / route.waypoints.length;

    return { lat, lon };
  }

  async function loadGrib(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setGribFileName(file.name);
    setGribStatus("Reading GRIB file...");
    setGribInventory("");

    try {
      const form = new FormData();
      form.append("file", file);

      const center = routeCenter();
      if (center) {
        form.append("lat", String(center.lat));
        form.append("lon", String(center.lon));
      }

      const response = await fetch("/api/grib-summary", {
        method: "POST",
        body: form,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || `GRIB parser returned ${response.status}`);
      }

      setWeatherSummary(data.summary || "GRIB loaded, but no summary was returned.");
      setGribInventory(data.inventoryPreview || "");
      setGribStatus(data.status || "GRIB loaded.");

      if (data.sourceNotes) {
        setOfficialForecast(previous =>
          previous.trim()
            ? `${previous.trim()}\n\n${data.sourceNotes}`
            : data.sourceNotes
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse GRIB file.";
      setGribStatus(message);
    }
  }

  function generateBrief() {
    setBriefGenerated(true);
  }

  function printBrief() {
    window.print();
  }

  const origin = route?.waypoints[0];
  const destination = route?.waypoints[route.waypoints.length - 1];

  return (
    <main className="min-h-screen bg-[#07111f] px-4 py-5 text-slate-100 print:bg-white print:text-black">
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          .print-card {
            border: 1px solid #999 !important;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
          }

          body {
            background: white !important;
          }
        }
      `}</style>

      <div className="mx-auto max-w-7xl space-y-5">
        <header className="no-print rounded-3xl border border-cyan-300/20 bg-slate-950/60 p-5 shadow-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-200">
                NavDash 1.3
              </div>
              <h1 className="mt-2 text-3xl font-black text-white">Voyage Brief Builder</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Build a bridge-ready route and weather brief from an RTZ route,
                planned speed, departure time, and weather/GRIB notes.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white hover:bg-white/15"
              >
                NavDash
              </Link>
              <button
                type="button"
                onClick={printBrief}
                className="rounded-2xl border border-wardGold/40 bg-wardGold px-4 py-3 text-sm font-black text-black"
              >
                Print / Save PDF
              </button>
            </div>
          </div>
        </header>

        <section className="no-print grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">1. Route</h2>
            <p className="mt-1 text-sm text-slate-400">Load an RTZ or pull the shared NavDash route.</p>

            <div className="mt-4 space-y-3">
              <input
                type="file"
                accept=".rtz,.xml,.txt"
                onChange={loadRtz}
                className="w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-slate-200"
              />
              <button
                type="button"
                onClick={loadSharedRoute}
                className="w-full rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100"
              >
                Use Shared NavDash Route
              </button>
              {routeError && (
                <div className="rounded-2xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">
                  {routeError}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">2. Planning</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Departure date/time
                <input
                  type="datetime-local"
                  value={departure}
                  onChange={event => setDeparture(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm normal-case tracking-normal text-white"
                />
              </label>

              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Planned speed, kt
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={plannedSpeed}
                  onChange={event => setPlannedSpeed(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm normal-case tracking-normal text-white"
                />
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <h2 className="text-lg font-black text-white">3. Generate</h2>
            <p className="mt-1 text-sm text-slate-400">
              Build a draft brief from the loaded route and entered weather notes.
            </p>

            <button
              type="button"
              onClick={generateBrief}
              disabled={!route}
              className="mt-5 w-full rounded-2xl border border-wardGold/40 bg-wardGold px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generate Voyage Brief
            </button>

            <div className="mt-4 text-xs leading-5 text-slate-400">
              NavDash can upload a GRIB2 file if the server has wgrib2 available. Manual
              weather notes still work as backup.
            </div>
          </div>
        </section>

        <section className="no-print grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
              GRIB / weather summary
            </div>

            <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
              <label className="block text-xs font-black uppercase tracking-[0.2em] text-cyan-100">
                Load GRIB2 file
                <input
                  type="file"
                  accept=".grb,.grb2,.grib,.grib2"
                  onChange={loadGrib}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm normal-case tracking-normal text-slate-200"
                />
              </label>

              <div className="mt-2 text-xs leading-5 text-slate-300">
                {gribFileName ? `Selected: ${gribFileName}` : "Optional: load a GRIB to auto-fill the weather summary."}
                {gribStatus ? (
                  <div className="mt-1 text-cyan-100">{gribStatus}</div>
                ) : null}
              </div>
            </div>

            <textarea
              value={weatherSummary}
              onChange={event => setWeatherSummary(event.target.value)}
              placeholder="GRIB summary will auto-fill here, or you can type/paste weather notes manually..."
              className="mt-3 min-h-40 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white"
            />

            {gribInventory ? (
              <details className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                <summary className="cursor-pointer font-black text-slate-100">
                  GRIB inventory preview
                </summary>
                <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
                  {gribInventory}
                </pre>
              </details>
            ) : null}
          </div>

          <label className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
              Official forecast / operational notes
            </div>
            <textarea
              value={officialForecast}
              onChange={event => setOfficialForecast(event.target.value)}
              placeholder="Paste NWS/High Seas/coastal forecast notes or official source summary..."
              className="mt-3 min-h-40 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white"
            />
          </label>

          <label className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
              Watch items
            </div>
            <textarea
              value={opsNotes}
              onChange={event => setOpsNotes(event.target.value)}
              placeholder="Examples: monitor lee shore, squall line, traffic separation, arrival timing, machinery limits..."
              className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white"
            />
          </label>

          <label className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-xl">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
              Arrival / port / pilotage notes
            </div>
            <textarea
              value={portNotes}
              onChange={event => setPortNotes(event.target.value)}
              placeholder="Pilot station, reporting, berth notes, local hazards, arrival restrictions..."
              className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white"
            />
          </label>
        </section>

        <section className="print-card rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <div className="border-b border-white/10 pb-4 print:border-black/20">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-200 print:text-black">
              NavDash Voyage Brief
            </div>
            <h2 className="mt-2 text-3xl font-black text-white print:text-black">
              {route ? route.routeName : "No route loaded"}
            </h2>
            <p className="mt-2 text-sm text-slate-300 print:text-black">
              Generated: {formatDateTimeLocal(new Date())}
            </p>
          </div>

          {!route && (
            <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-950/30 p-4 text-amber-100 print:border-black print:bg-white print:text-black">
              Load an RTZ or shared NavDash route to generate the brief.
            </div>
          )}

          {route && (
            <div className="mt-5 space-y-6">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    From
                  </div>
                  <div className="mt-2 text-xl font-black">{origin?.name}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    To
                  </div>
                  <div className="mt-2 text-xl font-black">{destination?.name}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    Distance
                  </div>
                  <div className="mt-2 text-xl font-black">{distanceNm.toFixed(1)} NM</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    ETA
                  </div>
                  <div className="mt-2 text-xl font-black">
                    {eta ? formatDateTimeLocal(eta) : "--"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    Planned speed
                  </div>
                  <div className="mt-2 text-lg font-black">{speed.toFixed(1)} kt</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    Voyage time
                  </div>
                  <div className="mt-2 text-lg font-black">{voyageHours.toFixed(1)} hr</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 print-card">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 print:text-black">
                    Waypoints
                  </div>
                  <div className="mt-2 text-lg font-black">{route.waypoints.length}</div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Weather summary</h3>
                <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 print-card">
                  {weatherSummary.trim() || "No GRIB/weather summary entered."}
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Official forecast / source notes</h3>
                <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 print-card">
                  {officialForecast.trim() || "No official forecast notes entered."}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-xl font-black">Watch items</h3>
                  <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 print-card">
                    {opsNotes.trim() || "No watch items entered."}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-black">Arrival / port notes</h3>
                  <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 print-card">
                    {portNotes.trim() || "No arrival or port notes entered."}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Route legs</h3>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 print:border-black">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-white/10 print:bg-white">
                      <tr>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">Leg</th>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">From</th>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">To</th>
                        <th className="border border-white/10 px-3 py-2 text-right print:border-black">Course</th>
                        <th className="border border-white/10 px-3 py-2 text-right print:border-black">Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legs.map((leg, index) => (
                        <tr key={`${leg.from.id}-${leg.to.id}-${index}`}>
                          <td className="border border-white/10 px-3 py-2 print:border-black">
                            {index + 1}
                          </td>
                          <td className="border border-white/10 px-3 py-2 print:border-black">
                            {leg.from.name}
                          </td>
                          <td className="border border-white/10 px-3 py-2 print:border-black">
                            {leg.to.name}
                          </td>
                          <td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">
                            {String(Math.round(leg.bearing)).padStart(3, "0")}°
                          </td>
                          <td className="border border-white/10 px-3 py-2 text-right font-mono print:border-black">
                            {leg.distance.toFixed(1)} NM
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black">Waypoint table</h3>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 print:border-black">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-white/10 print:bg-white">
                      <tr>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">No.</th>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">Waypoint</th>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">Latitude</th>
                        <th className="border border-white/10 px-3 py-2 text-left print:border-black">Longitude</th>
                      </tr>
                    </thead>
                    <tbody>
                      {route.waypoints.map((wp, index) => (
                        <tr key={`${wp.id}-${index}`}>
                          <td className="border border-white/10 px-3 py-2 print:border-black">
                            {index + 1}
                          </td>
                          <td className="border border-white/10 px-3 py-2 print:border-black">
                            {wp.name}
                          </td>
                          <td className="border border-white/10 px-3 py-2 font-mono print:border-black">
                            {formatCoord(wp.lat, true)}
                          </td>
                          <td className="border border-white/10 px-3 py-2 font-mono print:border-black">
                            {formatCoord(wp.lon, false)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {!briefGenerated && (
                <div className="no-print rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-4 text-sm text-cyan-100">
                  Brief preview updates live. Click <b>Generate Voyage Brief</b> when ready, then
                  print or save to PDF.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
