"use strict";

const fs = require("fs");

const sourcePath = "NavDash-Shipboard-Bridge.js";
let source = fs.readFileSync(sourcePath, "utf8");

if (source.includes("function decodeGpsPosition(")) {
  console.log("GPS position decoder already present; no patch needed.");
  process.exit(0);
}

const insertMarker = "function distanceNm(";
const insertAt = source.indexOf(insertMarker);
if (insertAt < 0) throw new Error("Could not find distanceNm insertion marker.");

const gpsSupport = `function parseNmeaCoordinate(raw, hemisphere) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const degrees = Math.floor(value / 100);
  const minutes = value - degrees * 100;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60) return null;
  let decimal = degrees + minutes / 60;
  const hemi = String(hemisphere || "").trim().toUpperCase();
  if (hemi === "S" || hemi === "W") decimal *= -1;
  return decimal;
}

function decodeGpsPosition(sentence) {
  try {
    const clean = String(sentence || "").trim();
    if (!clean.startsWith("$")) return null;
    const parts = clean.split(",");
    const type = String(parts[0] || "").slice(-3).toUpperCase();

    if (type === "GGA") {
      if (parts.length < 7 || Number(parts[6] || 0) <= 0) return null;
      const lat = parseNmeaCoordinate(parts[2], parts[3]);
      const lon = parseNmeaCoordinate(parts[4], parts[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return {
        lat,
        lon,
        sog: null,
        cog: null,
        heading: null,
        source: "GGA",
        timestamp: Date.now(),
        receivedAt: new Date().toISOString(),
      };
    }

    if (type === "RMC") {
      if (parts.length < 9 || String(parts[2] || "").toUpperCase() !== "A") return null;
      const lat = parseNmeaCoordinate(parts[3], parts[4]);
      const lon = parseNmeaCoordinate(parts[5], parts[6]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const sog = Number(parts[7]);
      const cog = Number(parts[8]);
      return {
        lat,
        lon,
        sog: Number.isFinite(sog) ? sog : null,
        cog: Number.isFinite(cog) ? cog : null,
        heading: null,
        source: "RMC",
        timestamp: Date.now(),
        receivedAt: new Date().toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

let lastPositionLogAt = 0;
function handleOwnShipPosition(sentence) {
  const position = decodeOwnShipPosition(sentence) || decodeGpsPosition(sentence);
  if (!position) return;
  if (!position.source) position.source = String(sentence || "").includes("AIVDO") ? "AIVDO" : "NMEA";
  recordOwnShipPosition(position);
  broadcast({ type: "position", ...position });
  const now = Date.now();
  if (now - lastPositionLogAt >= 30000) {
    lastPositionLogAt = now;
    console.log(\`[POSITION] \${position.source} \${position.lat.toFixed(6)}, \${position.lon.toFixed(6)}\`);
  }
}

`;

source = source.slice(0, insertAt) + gpsSupport + source.slice(insertAt);

const candidates = [
  "recordOwnShipPosition(decodeOwnShipPosition(clean));",
  "recordOwnShipPosition(decodeOwnShipPosition(line));",
];
let replaced = false;
for (const candidate of candidates) {
  if (source.includes(candidate)) {
    source = source.replace(candidate, candidate.includes("clean") ? "handleOwnShipPosition(clean);" : "handleOwnShipPosition(line);");
    replaced = true;
    break;
  }
}

if (!replaced) {
  throw new Error("Could not find the own-ship position call site to patch.");
}

fs.writeFileSync(sourcePath, source, "utf8");
console.log("Added GGA/RMC own-ship position support and normalized position broadcast.");
