"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { getAisWebSocketUrl } from "../../lib/aisWebSocket";
import { useBridgeTheme } from "../../lib/useBridgeTheme";

type GribTimelineRow = {
  label: string;
  valid: string;
  forecast: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  pressureHpa: number | null;
  tempC: number | null;
};

type GribOverlayPoint = {
  lat: number;
  lon: number;
  label: string;
  valid: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  routePoint?: string;
  timeline?: GribTimelineRow[];
};

type RouteForecastPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  worstWindKt: number | null;
  worstGustKt: number | null;
  worstSeasFt: number | null;
  worstSwellFt: number | null;
  worstSwellPeriod: number | null;
  worstValid: string;
  timeline: GribTimelineRow[];
};

type RouteForecast = {
  routeName: string;
  sampledPoints: number;
  routePoints: RouteForecastPoint[];
  worstWindPoint: RouteForecastPoint | null;
  worstSeasPoint: RouteForecastPoint | null;
};

type IsobarGridPoint = {
  lat: number;
  lon: number;
  timeline: GribTimelineRow[];
};

type GribSummary = {
  fileName: string;
  fileSize: number;
  loadedAt: string;
  status: string;
  summary: string;
  sourceNotes: string;
  inventoryPreview: string;
  timeline: GribTimelineRow[];
  overlayPoints: GribOverlayPoint[];
  routeForecast: RouteForecast | null;
  isobarGrid: IsobarGridPoint[];
};

type PointForecast = {
  lat: number;
  lon: number;
  label: string;
  row: GribTimelineRow;
};

type RouteLegForecast = {
  legLabel: string;
  fromName: string;
  toName: string;
  distanceNm: number;
  cumulativeEndNm: number;
  bearingDeg: number;
  etaLabel: string;
  weatherTimeLabel: string;
  etaMatched: boolean;
  level: "HIGH" | "CAUTION" | "NORMAL" | "NO DATA";
  color: string;
  row: GribTimelineRow | null;
  sourcePoint: string;
  seasSourcePoint?: string | null;
  risks: RiskFlag[];
};

type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type RouteState = {
  routeName: string;
  waypoints: Waypoint[];
  activeWaypointIndex: number;
};

type OwnShip = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  receivedAt: string;
};

type PositionLike = {
  lat: number;
  lon: number;
};

type Projection = {
  lat: number;
  lon: number;
  legIndex: number;
  nextWaypoint: Waypoint;
  distanceToNextNm: number;
  distanceAlongNm: number;
  etaHours: number | null;
  forecastLeadHours: number;
  positionSource: string;
};

type RiskFlag = {
  label: string;
  level: "HIGH" | "CAUTION" | "NORMAL";
};

type WxRoutingPanel = "GRIB" | "ROUTE" | "STORM" | "WHAT IF" | "COMPARE" | "LAYERS";
type ProjectionOriginMode = "current" | "manual";

type ScenarioSummary = {
  maxWind: number | null;
  maxSeas: number | null;
  highCount: number;
  cautionCount: number;
  topLevel: RouteLegForecast["level"];
  legCount: number;
};

const MAPLIBRE_CSS_ID = "maplibre-css";
const WX_SOURCE_ID = "navdash-wx-routing-source";
const WX_POINT_LAYER_ID = "navdash-wx-routing-points";
const WX_WIND_LAYER_ID = "navdash-wx-routing-wind";
const WX_LABEL_LAYER_ID = "navdash-wx-routing-labels";
const ROUTE_SOURCE_ID = "navdash-wx-routing-route-source";
const ROUTE_LINE_LAYER_ID = "navdash-wx-routing-route-line";
const ROUTE_WAYPOINT_LAYER_ID = "navdash-wx-routing-route-waypoints";
const ROUTE_WAYPOINT_LABEL_LAYER_ID = "navdash-wx-routing-route-labels";
const ROUTE_EXPOSURE_SOURCE_ID = "navdash-wx-routing-exposure-source";
const ROUTE_EXPOSURE_LAYER_ID = "navdash-wx-routing-exposure-line";
const ISOBAR_SOURCE_ID = "navdash-wx-routing-isobar-source";
const ISOBAR_GLOW_LAYER_ID = "navdash-wx-routing-isobar-glow";
const ISOBAR_LINE_LAYER_ID = "navdash-wx-routing-isobar-lines";
const ISOBAR_LABEL_LAYER_ID = "navdash-wx-routing-isobar-labels";
const PROJECTED_SOURCE_ID = "navdash-wx-routing-projected-source";
const PROJECTED_LAYER_ID = "navdash-wx-routing-projected";
const PROJECTED_LABEL_LAYER_ID = "navdash-wx-routing-projected-label";
const OWNSHIP_SOURCE_ID = "navdash-wx-routing-ownship-source";
const OWNSHIP_LAYER_ID = "navdash-wx-routing-ownship";
const OWNSHIP_LABEL_LAYER_ID = "navdash-wx-routing-ownship-label";
const AIS_ORIGIN_MAX_OFF_TRACK_NM = 25;

function addMapLibreCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(MAPLIBRE_CSS_ID)) return;

  const link = document.createElement("link");
  link.id = MAPLIBRE_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/maplibre-gl@5.14.0/dist/maplibre-gl.css";
  document.head.appendChild(link);
}

function formatNumber(value: number | null | undefined, decimals = 1, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}${suffix}`;
}

function propertyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function formatDirection(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "---";
  return `${String(Math.round(value)).padStart(3, "0")} deg`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLatLon(value: number, isLat: boolean) {
  if (!Number.isFinite(value)) return "--";

  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${degrees} ${minutes.toFixed(1)}' ${hemi}`;
}

function rowForPoint(point: GribOverlayPoint, selectedIndex: number, selectedValid?: string): GribTimelineRow | null {
  const timeline = Array.isArray(point.timeline) ? point.timeline : [];
  const byValid = selectedValid ? timeline.find((row) => row.valid === selectedValid) : null;
  const row = byValid || timeline[selectedIndex];

  if (row) return row;

  if (
    point.windKt !== null ||
    point.gustKt !== null ||
    point.seasFt !== null ||
    point.swellFt !== null
  ) {
    return {
      label: point.label || "Sample",
      valid: point.valid || "",
      forecast: "",
      windKt: point.windKt,
      windDir: point.windDir,
      gustKt: point.gustKt,
      seasFt: point.seasFt,
      swellFt: point.swellFt,
      swellPeriod: point.swellPeriod,
      pressureHpa: null,
      tempC: null,
    };
  }

  return null;
}

function exposureColor(row: GribTimelineRow | null) {
  const wind = Math.max(row?.gustKt ?? 0, row?.windKt ?? 0);
  const seasFt = row?.seasFt ?? 0;

  if (wind >= 40 || seasFt >= 15) return "#ef4444";
  if (wind >= 30 || seasFt >= 10) return "#f59e0b";
  if (wind > 0 || seasFt > 0) return "#22d3ee";
  return "#64748b";
}

function exposureLevel(row: GribTimelineRow | null): RouteLegForecast["level"] {
  if (!row) return "NO DATA";
  const wind = Math.max(row.gustKt ?? 0, row.windKt ?? 0);
  const seasFt = row.seasFt ?? 0;

  if (wind >= 40 || seasFt >= 15) return "HIGH";
  if (wind >= 30 || seasFt >= 10) return "CAUTION";
  if (wind > 0 || seasFt > 0) return "NORMAL";
  return "NO DATA";
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function relativeAngle(fromDeg: number, toDegValue: number) {
  const diff = Math.abs(normalizeDegrees(fromDeg) - normalizeDegrees(toDegValue));
  return diff > 180 ? 360 - diff : diff;
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLon = toRad(unwrapLongitudeNear(lon2, lon1) - lon1);
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

function formatEtaLabel(departureTime: string, hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return "--";
  const departure = departureTime ? new Date(departureTime) : null;
  if (!departure || Number.isNaN(departure.getTime())) return formatDurationHours(hours);
  const eta = new Date(departure.getTime() + Math.max(0, hours) * 3600000);
  const month = String(eta.getMonth() + 1).padStart(2, "0");
  const day = String(eta.getDate()).padStart(2, "0");
  const hour = String(eta.getHours()).padStart(2, "0");
  const minute = String(eta.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}${minute}`;
}

function riskFlagsForLeg(row: GribTimelineRow | null, legBearingDeg: number, nextRow?: GribTimelineRow | null): RiskFlag[] {
  if (!row) return [];

  const risks: RiskFlag[] = [];
  const wind = row.windKt ?? 0;
  const gust = row.gustKt ?? 0;
  const seas = row.seasFt ?? 0;
  const pressure = row.pressureHpa ?? null;
  const worstWind = Math.max(wind, gust);

  if (gust >= 40) risks.push({ label: "HIGH GUSTS", level: "HIGH" });
  else if (gust >= 30) risks.push({ label: "GUSTY", level: "CAUTION" });

  if (seas >= 15) risks.push({ label: "HEAVY SEAS", level: "HIGH" });
  else if (seas >= 10) risks.push({ label: "ROUGH SEAS", level: "CAUTION" });

  if (pressure !== null && pressure <= 1000) risks.push({ label: "LOW PRESSURE", level: "HIGH" });
  else if (pressure !== null && pressure <= 1005) risks.push({ label: "FALLING AREA", level: "CAUTION" });

  if (row.windDir !== null && row.windDir !== undefined && Number.isFinite(row.windDir) && worstWind >= 15) {
    const angle = relativeAngle(row.windDir, legBearingDeg);
    if (angle <= 45) risks.push({ label: seas >= 6 ? "HEAD SEAS" : "HEAD WIND", level: seas >= 10 || worstWind >= 30 ? "CAUTION" : "NORMAL" });
    else if (angle >= 135) risks.push({ label: seas >= 6 ? "FOLLOWING SEAS" : "FOLLOWING WIND", level: seas >= 10 || worstWind >= 30 ? "CAUTION" : "NORMAL" });
    else risks.push({ label: seas >= 6 ? "BEAM SEAS" : "BEAM WIND", level: seas >= 10 || worstWind >= 30 ? "CAUTION" : "NORMAL" });
  }

  if (nextRow) {
    const nextWorstWind = Math.max(nextRow.windKt ?? 0, nextRow.gustKt ?? 0);
    const nextSeas = nextRow.seasFt ?? 0;
    if (nextWorstWind >= worstWind + 5 || nextSeas >= seas + 2) {
      risks.push({ label: "WORSENING TREND", level: nextWorstWind >= 30 || nextSeas >= 10 ? "CAUTION" : "NORMAL" });
    }
  }

  return risks.slice(0, 4);
}

function routePointRow(point: RouteForecastPoint | null | undefined, selectedIndex: number, selectedValid?: string) {
  if (!point?.timeline?.length) return null;
  return point.timeline.find((row) => row.valid === selectedValid) || point.timeline[selectedIndex] || null;
}

function rowHasSeas(row: GribTimelineRow | null | undefined) {
  return row?.seasFt !== null && row?.seasFt !== undefined && Number.isFinite(row.seasFt);
}

function routePointRowNearestEta(point: RouteForecastPoint | null | undefined, etaDate: Date | null) {
  if (!point?.timeline?.length || !etaDate || Number.isNaN(etaDate.getTime())) return null;

  return point.timeline.reduce<GribTimelineRow | null>((best, row) => {
    const rowDate = parseUtcDate(row.valid);
    const bestDate = best ? parseUtcDate(best.valid) : null;
    if (!rowDate) return best;
    if (!best || !bestDate) return row;
    return Math.abs(rowDate.getTime() - etaDate.getTime()) < Math.abs(bestDate.getTime() - etaDate.getTime()) ? row : best;
  }, null);
}

function nearestWaveRowForWaypoint(
  routeForecast: RouteForecast | null | undefined,
  waypoint: Waypoint,
  selectedIndex: number,
  selectedValid?: string,
) {
  const points = routeForecast?.routePoints || [];
  const candidates = points
    .map((point) => {
      const row = routePointRow(point, selectedIndex, selectedValid);
      return rowHasSeas(row)
        ? {
            point,
            row,
            distance: distanceNm(point.lat, point.lon, waypoint.lat, waypoint.lon),
          }
        : null;
    })
    .filter(Boolean) as Array<{ point: RouteForecastPoint; row: GribTimelineRow; distance: number }>;

  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best), candidates[0]);
}

function fillMissingSeasFromNearestRoutePoint(
  row: GribTimelineRow | null,
  routeForecast: RouteForecast | null | undefined,
  waypoint: Waypoint,
  selectedIndex: number,
) {
  if (!row || rowHasSeas(row)) return { row, seasSourcePoint: null };

  const fallback = nearestWaveRowForWaypoint(routeForecast, waypoint, selectedIndex, row.valid);
  if (!fallback?.row) return { row, seasSourcePoint: null };

  return {
    row: {
      ...row,
      seasFt: fallback.row.seasFt,
      swellFt: fallback.row.swellFt,
      swellPeriod: fallback.row.swellPeriod,
    },
    seasSourcePoint: `${fallback.point.id} ${fallback.point.name}`.trim(),
  };
}

function dateFromDepartureHours(departureTime: string, hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return null;
  const departure = departureTime ? new Date(departureTime) : null;
  if (!departure || Number.isNaN(departure.getTime())) return null;
  return new Date(departure.getTime() + Math.max(0, hours) * 3600000);
}

function routePointDistanceScore(point: RouteForecastPoint, waypoint: Waypoint) {
  if (point.id && waypoint.id && point.id === waypoint.id) return -1;
  return distanceNm(point.lat, point.lon, waypoint.lat, waypoint.lon);
}

function nearestRouteForecastPoint(routeForecast: RouteForecast | null | undefined, waypoint: Waypoint) {
  const points = routeForecast?.routePoints || [];
  if (!points.length) return null;

  return points.reduce<RouteForecastPoint | null>((best, point) => {
    if (!best) return point;
    return routePointDistanceScore(point, waypoint) < routePointDistanceScore(best, waypoint) ? point : best;
  }, null);
}

function nearestForecastPointToPosition(routeForecast: RouteForecast | null | undefined, lat: number, lon: number) {
  const points = routeForecast?.routePoints || [];
  if (!points.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return points.reduce<RouteForecastPoint | null>((best, point) => {
    if (!best) return point;
    const pointDistance = distanceNm(point.lat, point.lon, lat, lon);
    const bestDistance = distanceNm(best.lat, best.lon, lat, lon);
    return pointDistance < bestDistance ? point : best;
  }, null);
}

function isobarRowForPoint(point: IsobarGridPoint, selectedIndex: number, selectedValid?: string) {
  return point.timeline.find((row) => row.valid === selectedValid) || point.timeline[selectedIndex] || null;
}

function isobarLevels(values: number[]) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const levels: number[] = [];

  if (spread < 0.05) {
    return [Number(((min + max) / 2).toFixed(1))];
  }

  const interval = spread < 2 ? 0.5 : spread < 8 ? 1 : 4;
  const start = Math.ceil(min / interval) * interval;
  const end = Math.floor(max / interval) * interval;

  for (let level = start; level <= end; level += interval) {
    const rounded = Number(level.toFixed(interval < 1 ? 1 : 0));
    if (rounded > min && rounded < max) levels.push(rounded);
  }

  if (!levels.length) levels.push(Number(((min + max) / 2).toFixed(1)));
  return levels;
}

function formatIsobarPressure(level: number) {
  return `${Number.isInteger(level) ? level.toFixed(0) : level.toFixed(1)} hPa`;
}

function interpolateIsobarPoint(
  a: { lat: number; lon: number; value: number },
  b: { lat: number; lon: number; value: number },
  level: number,
) {
  const span = b.value - a.value;
  const ratio = span === 0 ? 0.5 : (level - a.value) / span;
  return [
    a.lon + (b.lon - a.lon) * ratio,
    a.lat + (b.lat - a.lat) * ratio,
  ];
}

function cellCrossings(
  corners: Array<{ lat: number; lon: number; value: number }>,
  level: number,
) {
  const edges = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  const crossings: number[][] = [];

  for (const [a, b] of edges) {
    const aDiff = a.value - level;
    const bDiff = b.value - level;
    if (aDiff === 0 && bDiff === 0) continue;
    if ((aDiff <= 0 && bDiff >= 0) || (aDiff >= 0 && bDiff <= 0)) {
      crossings.push(interpolateIsobarPoint(a, b, level));
    }
  }

  return crossings;
}

function coordinateKey(coordinate: number[]) {
  return `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`;
}

function midpointCoordinate(coordinates: number[][]) {
  if (coordinates.length === 1) return coordinates[0];
  const index = Math.floor((coordinates.length - 1) / 2);
  const next = Math.min(coordinates.length - 1, index + 1);
  return [
    (coordinates[index][0] + coordinates[next][0]) / 2,
    (coordinates[index][1] + coordinates[next][1]) / 2,
  ];
}

function smoothIsobarLine(coordinates: number[][], iterations = 3) {
  const uniqueCoordinates = coordinates.filter((coordinate, index) => {
    if (index === 0) return true;
    const previous = coordinates[index - 1];
    return previous[0] !== coordinate[0] || previous[1] !== coordinate[1];
  });
  if (uniqueCoordinates.length < 3) return uniqueCoordinates;

  let smoothed = uniqueCoordinates;
  for (let pass = 0; pass < iterations; pass += 1) {
    const nextLine: number[][] = [smoothed[0]];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const current = smoothed[index];
      const next = smoothed[index + 1];
      nextLine.push([
        current[0] * 0.75 + next[0] * 0.25,
        current[1] * 0.75 + next[1] * 0.25,
      ]);
      nextLine.push([
        current[0] * 0.25 + next[0] * 0.75,
        current[1] * 0.25 + next[1] * 0.75,
      ]);
    }
    nextLine.push(smoothed[smoothed.length - 1]);
    smoothed = nextLine;
  }

  return smoothed;
}

function stitchIsobarSegments(segmentFeatures: any[]) {
  const byLevel = new Map<number, number[][][]>();

  for (const feature of segmentFeatures) {
    const level = feature.properties?.level;
    const coordinates = feature.geometry?.coordinates;
    if (!Number.isFinite(level) || !Array.isArray(coordinates) || coordinates.length < 2) continue;
    const lines = byLevel.get(level) || [];
    lines.push(coordinates);
    byLevel.set(level, lines);
  }

  const stitchedFeatures: any[] = [];

  for (const [level, segments] of Array.from(byLevel.entries())) {
    const remaining = [...segments];

    while (remaining.length) {
      const line = remaining.pop() || [];
      let changed = true;

      while (changed) {
        changed = false;
        const startKey = coordinateKey(line[0]);
        const endKey = coordinateKey(line[line.length - 1]);

        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const nextLine = remaining[index];
          const nextStartKey = coordinateKey(nextLine[0]);
          const nextEndKey = coordinateKey(nextLine[nextLine.length - 1]);

          if (endKey === nextStartKey) {
            line.push(...nextLine.slice(1));
          } else if (endKey === nextEndKey) {
            line.push(...nextLine.slice(0, -1).reverse());
          } else if (startKey === nextEndKey) {
            line.unshift(...nextLine.slice(0, -1));
          } else if (startKey === nextStartKey) {
            line.unshift(...nextLine.slice(1).reverse());
          } else {
            continue;
          }

          remaining.splice(index, 1);
          changed = true;
          break;
        }
      }

      const pressure = formatIsobarPressure(level);
      const smoothedLine = smoothIsobarLine(line);
      stitchedFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: smoothedLine,
        },
        properties: {
          pressure,
          level,
        },
      });

      if (smoothedLine.length >= 2) {
        stitchedFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: midpointCoordinate(smoothedLine),
          },
          properties: {
            pressure,
            level,
          },
        });
      }
    }
  }

  return stitchedFeatures;
}

function buildIsobarFeatures(gridPoints: IsobarGridPoint[], selectedIndex: number, selectedValid?: string) {
  const samples = gridPoints
    .map((point) => {
      const row = isobarRowForPoint(point, selectedIndex, selectedValid);
      const value = row?.pressureHpa;
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      return { lat: point.lat, lon: point.lon, value };
    })
    .filter(Boolean) as Array<{ lat: number; lon: number; value: number }>;

  if (samples.length < 9) return [];

  const lats = Array.from(new Set(samples.map((point) => Number(point.lat.toFixed(4))))).sort((a, b) => a - b);
  const lons = Array.from(new Set(samples.map((point) => Number(point.lon.toFixed(4))))).sort((a, b) => a - b);
  const byKey = new Map(samples.map((point) => [`${point.lat.toFixed(4)},${point.lon.toFixed(4)}`, point]));
  const levels = isobarLevels(samples.map((point) => point.value));
  const segmentFeatures: any[] = [];

  for (const level of levels) {
    for (let y = 0; y < lats.length - 1; y += 1) {
      for (let x = 0; x < lons.length - 1; x += 1) {
        const corners = [
          byKey.get(`${lats[y].toFixed(4)},${lons[x].toFixed(4)}`),
          byKey.get(`${lats[y].toFixed(4)},${lons[x + 1].toFixed(4)}`),
          byKey.get(`${lats[y + 1].toFixed(4)},${lons[x + 1].toFixed(4)}`),
          byKey.get(`${lats[y + 1].toFixed(4)},${lons[x].toFixed(4)}`),
        ];
        if (corners.some((corner) => !corner)) continue;

        const crossings = cellCrossings(corners as Array<{ lat: number; lon: number; value: number }>, level);
        if (crossings.length < 2) continue;

        for (let index = 0; index + 1 < crossings.length; index += 2) {
          const lineCoordinates = [crossings[index], crossings[index + 1]];
          segmentFeatures.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: lineCoordinates,
            },
            properties: {
              pressure: formatIsobarPressure(level),
              level,
            },
          });
        }
      }
    }
  }

  return stitchIsobarSegments(segmentFeatures);
}

function windLabel(row: GribTimelineRow | null) {
  if (!row) return "No data";
  return `${formatNumber(row.windKt, 1, " kt")} from ${formatDirection(row.windDir)}`;
}

function formatDurationHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "--";
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const days = Math.floor(totalMinutes / 1440);
  const remainingMinutes = totalMinutes % 1440;
  const hrs = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatSignedDurationHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "--";
  if (Math.abs(hours) < 1 / 120) return "No change";
  return `${hours > 0 ? "+" : "-"}${formatDurationHours(Math.abs(hours))}`;
}

function summarizeScenarioLegs(legForecasts: RouteLegForecast[], extraRows: Array<GribTimelineRow | null | undefined> = []): ScenarioSummary {
  const rows = legForecasts.map((leg) => leg.row).filter(Boolean) as GribTimelineRow[];
  const summaryRows = [...rows, ...(extraRows.filter(Boolean) as GribTimelineRow[])];
  const summaryMaxWind = summaryRows.reduce((max, row) => Math.max(max, row.windKt ?? 0, row.gustKt ?? 0), 0);
  const maxSeas = summaryRows.reduce((max, row) => Math.max(max, row.seasFt ?? 0), 0);
  const highCount = legForecasts.filter((leg) => leg.level === "HIGH").length;
  const cautionCount = legForecasts.filter((leg) => leg.level === "CAUTION").length;
  const extraLevels = extraRows.map((row) => exposureLevel(row ?? null));
  const topLevel = highCount || extraLevels.includes("HIGH") ? "HIGH" : cautionCount || extraLevels.includes("CAUTION") ? "CAUTION" : summaryRows.length ? "NORMAL" : "NO DATA";

  return {
    maxWind: summaryRows.length ? summaryMaxWind : null,
    maxSeas: summaryRows.length ? maxSeas : null,
    highCount,
    cautionCount,
    topLevel,
    legCount: legForecasts.length,
  };
}

function parseRtzRoute(xmlText: string): { routeName: string; waypoints: Waypoint[] } {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Could not parse RTZ/XML route.");

  const routeNode = doc.querySelector("route");
  const routeName =
    routeNode?.getAttribute("routeName") ||
    routeNode?.getAttribute("name") ||
    doc.querySelector("routeInfo")?.getAttribute("routeName") ||
    "Loaded RTZ Route";

  const waypointNodes = Array.from(doc.getElementsByTagName("waypoint"));
  const waypoints = waypointNodes
    .map((wp, index) => {
      const position = wp.getElementsByTagName("position")[0];
      const latRaw =
        position?.getAttribute("lat") ||
        position?.getAttribute("latitude") ||
        wp.getAttribute("lat") ||
        wp.getAttribute("latitude");
      const lonRaw =
        position?.getAttribute("lon") ||
        position?.getAttribute("longitude") ||
        wp.getAttribute("lon") ||
        wp.getAttribute("longitude");

      return {
        id: wp.getAttribute("id") || wp.getAttribute("revision") || `WP${String(index + 1).padStart(2, "0")}`,
        name:
          wp.getAttribute("name") ||
          wp.getAttribute("waypointName") ||
          wp.querySelector("name")?.textContent?.trim() ||
          `Waypoint ${index + 1}`,
        lat: Number(latRaw),
        lon: Number(lonRaw),
      };
    })
    .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));

  if (waypoints.length < 2) throw new Error("RTZ route must contain at least two usable waypoints.");
  return { routeName, waypoints };
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function toDeg(value: number) {
  return (value * 180) / Math.PI;
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function unwrapLongitudeNear(lon: number, referenceLon: number) {
  let adjustedLon = lon;
  while (adjustedLon - referenceLon > 180) adjustedLon -= 360;
  while (adjustedLon - referenceLon < -180) adjustedLon += 360;
  return adjustedLon;
}

function routeCoordinatesForChart(route: Waypoint[]) {
  const points: [number, number][] = [];

  for (const wp of route) {
    const referenceLon = points.length ? points[points.length - 1][0] : wp.lon;
    points.push([unwrapLongitudeNear(wp.lon, referenceLon), wp.lat]);
  }

  return points;
}

function normalizedLongitude(lon: number) {
  let next = lon;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function zoomForRouteSpan(latSpan: number, lonSpan: number) {
  const span = Math.max(latSpan * 2.1, lonSpan);
  if (span > 95) return 2.1;
  if (span > 55) return 2.7;
  if (span > 30) return 3.4;
  if (span > 16) return 4.2;
  if (span > 8) return 5;
  return 5.8;
}

function totalRouteDistanceNm(route: Waypoint[]) {
  return route.reduce((total, wp, index) => {
    if (index === 0) return total;
    const prev = route[index - 1];
    return total + distanceNm(prev.lat, prev.lon, wp.lat, wp.lon);
  }, 0);
}

function interpolateRouteAtDistance(route: Waypoint[], targetDistanceNm: number): Projection | null {
  if (route.length < 2) return null;

  let remaining = Math.max(0, targetDistanceNm);
  let distanceAlong = 0;

  for (let i = 0; i < route.length - 1; i += 1) {
    const start = route[i];
    const end = route[i + 1];
    const legDistance = distanceNm(start.lat, start.lon, end.lat, end.lon);

    if (remaining <= legDistance || i === route.length - 2) {
      const ratio = legDistance > 0 ? Math.min(1, remaining / legDistance) : 0;
      const endLon = unwrapLongitudeNear(end.lon, start.lon);
      const lon = start.lon + (endLon - start.lon) * ratio;
      const lat = start.lat + (end.lat - start.lat) * ratio;
      const normalizedLon = ((lon + 540) % 360) - 180;

      return {
        lat,
        lon: normalizedLon,
        legIndex: i + 1,
        nextWaypoint: end,
        distanceToNextNm: Math.max(0, legDistance - remaining),
        distanceAlongNm: distanceAlong + Math.min(remaining, legDistance),
        etaHours: 0,
        forecastLeadHours: 0,
        positionSource: "Route start",
      };
    }

    remaining -= legDistance;
    distanceAlong += legDistance;
  }

  return null;
}

function routeProgressNearestPosition(route: Waypoint[], position: PositionLike | null) {
  return routeProgressNearestPositionDetail(route, position).progressNm;
}

function routeProgressNearestPositionDetail(route: Waypoint[], position: PositionLike | null) {
  if (!position || route.length < 2) {
    return { progressNm: 0, offTrackNm: null as number | null, usable: false };
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let cumulative = 0;

  for (let i = 0; i < route.length - 1; i += 1) {
    const start = route[i];
    const end = route[i + 1];
    const refLat = (position.lat + start.lat + end.lat) / 3;
    const nmPerDegLon = 60 * Math.cos(toRad(refLat));
    const startLon = unwrapLongitudeNear(start.lon, position.lon);
    const endLon = unwrapLongitudeNear(end.lon, startLon);
    const posLon = unwrapLongitudeNear(position.lon, startLon);

    const startX = startLon * nmPerDegLon;
    const startY = start.lat * 60;
    const endX = endLon * nmPerDegLon;
    const endY = end.lat * 60;
    const posX = posLon * nmPerDegLon;
    const posY = position.lat * 60;
    const dx = endX - startX;
    const dy = endY - startY;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((posX - startX) * dx + (posY - startY) * dy) / lengthSq)) : 0;
    const closestX = startX + dx * t;
    const closestY = startY + dy * t;
    const offTrack = Math.hypot(posX - closestX, posY - closestY);
    const legDistance = distanceNm(start.lat, start.lon, end.lat, end.lon);

    if (offTrack < bestDistance) {
      bestDistance = offTrack;
      bestProgress = cumulative + legDistance * t;
    }

    cumulative += legDistance;
  }

  return {
    progressNm: bestProgress,
    offTrackNm: bestDistance,
    usable: Number.isFinite(bestDistance) && bestDistance <= AIS_ORIGIN_MAX_OFF_TRACK_NM,
  };
}

function planningOriginProgress(route: Waypoint[], position: PositionLike | null, usePositionOrigin: boolean) {
  if (!usePositionOrigin) return 0;
  const origin = routeProgressNearestPositionDetail(route, position);
  return origin.usable ? origin.progressNm : 0;
}

function parseUtcDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00 UTC$/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour)));
}

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hoursBetweenLocalAndUtcValid(localDateTime: string, valid: string) {
  const start = localDateTime ? new Date(localDateTime) : null;
  const end = parseUtcDate(valid);
  if (!start || Number.isNaN(start.getTime()) || !end) return 0;
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
}

function forecastLeadHoursForSelection(
  timeline: GribTimelineRow[],
  selectedIndex: number,
  departureTime: string,
  selectedValid: string,
) {
  const absoluteLead = hoursBetweenLocalAndUtcValid(departureTime, selectedValid);
  const selectedDate = parseUtcDate(selectedValid);
  const firstDate = timeline[0]?.valid ? parseUtcDate(timeline[0].valid) : null;
  const timelineLead =
    selectedDate && firstDate
      ? Math.max(0, (selectedDate.getTime() - firstDate.getTime()) / 3600000)
      : Math.max(0, selectedIndex) * 3;

  if (absoluteLead > 0) return absoluteLead;
  if (selectedIndex > 0 && timelineLead > 0) return timelineLead;
  return 0;
}

function sixBitCharToValue(char: string) {
  const code = char.charCodeAt(0);
  return code < 88 ? code - 48 : code - 56;
}

function payloadToBits(payload: string) {
  return payload
    .split("")
    .map((char) => sixBitCharToValue(char).toString(2).padStart(6, "0"))
    .join("");
}

function getUnsigned(bits: string, start: number, length: number) {
  return parseInt(bits.slice(start, start + length), 2);
}

function getSigned(bits: string, start: number, length: number) {
  const value = getUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);
  return value & signBit ? value - (1 << length) : value;
}

function decodeOwnShipPosition(sentence: string): OwnShip | null {
  try {
    const clean = String(sentence || "").trim();
    if (!clean.startsWith("!AIVDO") && !clean.startsWith("$AIVDO")) return null;

    const parts = clean.split(",");
    if (parts.length < 7) return null;
    const total = Number(parts[1]);
    const fragment = Number(parts[2]);
    const payload = parts[5];
    const fillBits = Number((parts[6] || "0").split("*")[0] || 0);
    if (total !== 1 || fragment !== 1 || !payload) return null;

    const rawBits = payloadToBits(payload);
    const bits = fillBits > 0 ? rawBits.slice(0, -fillBits) : rawBits;
    const messageType = getUnsigned(bits, 0, 6);
    if (![1, 2, 3].includes(messageType)) return null;

    const sogRaw = getUnsigned(bits, 50, 10);
    const lonRaw = getSigned(bits, 61, 28);
    const latRaw = getSigned(bits, 89, 27);
    const cogRaw = getUnsigned(bits, 116, 12);
    const headingRaw = getUnsigned(bits, 128, 9);
    const lat = latRaw / 600000;
    const lon = lonRaw / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      lat,
      lon,
      sog: sogRaw === 1023 ? null : sogRaw / 10,
      cog: cogRaw === 3600 ? null : cogRaw / 10,
      heading: headingRaw === 511 ? null : headingRaw,
      receivedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default function WxRoutingPage() {
  const { nightMode, dayMode, toggleTheme } = useBridgeTheme();
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectedOverlayRef = useRef<HTMLDivElement | null>(null);
  const windParticlesRef = useRef<Array<{ x: number; y: number; age: number; life: number }>>([]);
  const mapRef = useRef<any>(null);
  const maplibreRef = useRef<any>(null);
  const projectedMarkerRef = useRef<HTMLDivElement | null>(null);
  const projectedEdgeMarkerRef = useRef<HTMLDivElement | null>(null);
  const projectionRef = useRef<Projection | null>(null);
  const planningSpeedRef = useRef(0);
  const nightModeRef = useRef(nightMode);
  const projectedRefreshTimersRef = useRef<number[]>([]);
  const handlersBoundRef = useRef(false);
  const routeExposureHandlersBoundRef = useRef(false);
  const playTimerRef = useRef<number | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapStatus, setMapStatus] = useState("Map loading");
  const [gribSummary, setGribSummary] = useState<GribSummary | null>(null);
  const [gribStatus, setGribStatus] = useState("No GRIB file loaded");
  const [gribLoading, setGribLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sampleLat, setSampleLat] = useState("0");
  const [sampleLon, setSampleLon] = useState("0");
  const [selectedPoint, setSelectedPoint] = useState<PointForecast | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [routeStatus, setRouteStatus] = useState("No route loaded");
  const [planningSpeed, setPlanningSpeed] = useState("6.5");
  const [departureTime, setDepartureTime] = useState("");
  const [whatIfSpeed, setWhatIfSpeed] = useState("8.0");
  const [whatIfDelayHours, setWhatIfDelayHours] = useState("0");
  const [activePanel, setActivePanel] = useState<WxRoutingPanel>("ROUTE");
  const [showWindLayer, setShowWindLayer] = useState(true);
  const [showIsobarLayer, setShowIsobarLayer] = useState(true);
  const [showRouteExposureLayer, setShowRouteExposureLayer] = useState(true);
  const [showGribPointLayer, setShowGribPointLayer] = useState(false);
  const [showPositionLayer, setShowPositionLayer] = useState(true);
  const [showProjectedPosition, setShowProjectedPosition] = useState(false);
  const [ownShip, setOwnShip] = useState<OwnShip | null>(null);
  const [aisStatus, setAisStatus] = useState("AIS not connected");
  const [useAisOrigin, setUseAisOrigin] = useState(true);
  const [projectionOriginMode, setProjectionOriginMode] = useState<ProjectionOriginMode>("current");
  const [manualDepartureLat, setManualDepartureLat] = useState("");
  const [manualDepartureLon, setManualDepartureLon] = useState("");
  const [selectedRouteLeg, setSelectedRouteLeg] = useState<RouteLegForecast | null>(null);

  const timeline = gribSummary?.timeline || [];
  const selectedTime = timeline[selectedIndex] || null;
  const route = routeState?.waypoints || [];
  const routeDistanceNm = totalRouteDistanceNm(route);
  const planningSpeedKt = Number(planningSpeed);
  const whatIfSpeedKt = Number(whatIfSpeed);
  const whatIfDelay = Number(whatIfDelayHours);
  const whatIfDepartureTime = useMemo(() => {
    const departure = departureTime ? new Date(departureTime) : null;
    if (!departure || Number.isNaN(departure.getTime()) || !Number.isFinite(whatIfDelay)) return departureTime;
    return formatDateTimeLocal(new Date(departure.getTime() + whatIfDelay * 3600000));
  }, [departureTime, whatIfDelay]);
  const manualDeparturePosition = useMemo<PositionLike | null>(() => {
    const lat = Number(manualDepartureLat);
    const lon = Number(manualDepartureLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }, [manualDepartureLat, manualDepartureLon]);
  const projectionOriginPosition = projectionOriginMode === "current" ? ownShip : manualDeparturePosition;
  const projectionDepartureTime = projectionOriginMode === "current" ? formatDateTimeLocal(new Date()) : departureTime;
  const projection = useMemo(() => {
    if (!showProjectedPosition || !selectedTime || !Number.isFinite(planningSpeedKt) || planningSpeedKt < 0) return null;
    if (!projectionOriginPosition) return null;
    if (projectionOriginMode === "manual" && !departureTime) return null;

    if (planningSpeedKt === 0) {
      const stationaryPosition = projectionOriginPosition;
      if (!stationaryPosition) return null;

      const originProgress = planningOriginProgress(route, projectionOriginPosition, true);
      const routeProjection = route.length >= 2
        ? interpolateRouteAtDistance(route, originProgress)
        : null;
      const fallbackWaypoint = routeProjection?.nextWaypoint || {
        id: "HOLD",
        name: "Stationary",
        lat: stationaryPosition.lat,
        lon: stationaryPosition.lon,
      };

      return {
        lat: stationaryPosition.lat,
        lon: stationaryPosition.lon,
        legIndex: routeProjection?.legIndex || 0,
        nextWaypoint: fallbackWaypoint,
        distanceToNextNm: routeProjection?.distanceToNextNm || 0,
        distanceAlongNm: routeProjection?.distanceAlongNm || 0,
        etaHours: null,
        forecastLeadHours: forecastLeadHoursForSelection(timeline, selectedIndex, projectionDepartureTime, selectedTime.valid),
        positionSource: projectionOriginMode === "current" ? "Current position / current time - stationary" : "Manual departure - stationary",
      };
    }

    if (route.length < 2) return null;

    const elapsedHours = forecastLeadHoursForSelection(timeline, selectedIndex, projectionDepartureTime, selectedTime.valid);
    const originProgress = planningOriginProgress(route, projectionOriginPosition, true);
    const projectedDistance = Math.min(routeDistanceNm, originProgress + elapsedHours * planningSpeedKt);
    const next = interpolateRouteAtDistance(route, projectedDistance);
    if (!next) return null;

    return {
      ...next,
      etaHours: Math.max(0, (routeDistanceNm - projectedDistance) / planningSpeedKt),
      forecastLeadHours: elapsedHours,
      positionSource: projectionOriginMode === "current" ? "Current position / current time" : "Manual departure position / time",
    };
  }, [
    departureTime,
    planningSpeedKt,
    projectionDepartureTime,
    projectionOriginMode,
    projectionOriginPosition,
    route,
    routeDistanceNm,
    selectedIndex,
    selectedTime,
    showProjectedPosition,
    timeline,
  ]);

  projectionRef.current = projection;
  planningSpeedRef.current = planningSpeedKt;
  nightModeRef.current = nightMode;
  const projectionRefreshKey = [
    projection?.lat ?? "",
    projection?.lon ?? "",
    projection?.forecastLeadHours ?? "",
    selectedTime?.valid ?? "",
  ].join("|");
  const projectedForecast = useMemo(() => {
    if (!showProjectedPosition) {
      return {
        row: null,
        source: "projected position off",
        distanceNm: null,
        usingRouteSample: false,
      };
    }

    const routeForecast = gribSummary?.routeForecast || null;
    const position = projection;
    const point = position ? nearestForecastPointToPosition(routeForecast, position.lat, position.lon) : null;
    const row = routePointRow(point, selectedIndex, selectedTime?.valid) || selectedTime || null;

    return {
      row,
      source: point
        ? `${point.id} ${point.name}`.trim()
        : selectedTime
          ? "sample center"
          : "no forecast loaded",
      distanceNm: point && position ? distanceNm(point.lat, point.lon, position.lat, position.lon) : null,
      usingRouteSample: Boolean(point),
    };
  }, [gribSummary?.routeForecast, projection, selectedIndex, selectedTime, showProjectedPosition]);

  const pageClass = dayMode
    ? "min-h-screen bg-white text-slate-950"
    : "min-h-screen bg-[#071019] text-slate-100";
  const panelClass = dayMode
    ? "rounded-[1.4rem] border border-slate-300 bg-white p-4 shadow-xl shadow-slate-900/10"
    : "rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl";
  const cardClass = dayMode
    ? "rounded-xl border border-slate-300 bg-slate-50 p-3"
    : "rounded-xl border border-white/10 bg-black/25 p-3";
  const labelClass = dayMode
    ? "text-xs font-black uppercase tracking-[0.2em] text-slate-500"
    : "text-xs font-black uppercase tracking-[0.2em] text-slate-400";
  const mutedClass = dayMode ? "text-slate-600" : "text-slate-400";
  const buttonClass = dayMode
    ? "border border-slate-400 bg-white px-3 py-2 text-sm font-black text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
    : "border border-white/15 bg-white/10 px-3 py-2 text-sm font-black text-slate-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50";
  const activeButtonClass = "border border-[#c9a227] bg-[#c9a227] px-3 py-2 text-sm font-black text-slate-950";

  const mapFeatures = useMemo(() => {
    return (gribSummary?.overlayPoints || [])
      .map((point) => {
        const row = rowForPoint(point, selectedIndex, selectedTime?.valid);
        if (!row) return null;
        const color = exposureColor(row);
        const label = point.routePoint || point.label || "GRIB";
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [point.lon, point.lat],
          },
          properties: {
            lat: point.lat,
            lon: point.lon,
            label,
            shortLabel: label.length > 12 ? label.slice(0, 12) : label,
            color,
            rotation: row.windDir !== null && row.windDir !== undefined && Number.isFinite(row.windDir) ? row.windDir : 0,
            valid: row.valid,
            windKt: row.windKt,
            windDir: row.windDir,
            gustKt: row.gustKt,
            seasFt: row.seasFt,
            swellFt: row.swellFt,
            swellPeriod: row.swellPeriod,
            pressureHpa: row.pressureHpa,
          },
        };
      })
      .filter(Boolean);
  }, [gribSummary?.overlayPoints, selectedIndex, selectedTime?.valid]);

  const routeExposure = useMemo(() => {
    const coordinates = routeCoordinatesForChart(route);
    const features: any[] = [];
    const legForecasts: RouteLegForecast[] = [];
    const selectedValid = selectedTime?.valid;
    const routeForecast = gribSummary?.routeForecast || null;
    const originProgress = planningOriginProgress(route, ownShip, useAisOrigin);
    let cumulativeEndNm = 0;

    if (coordinates.length < 2 || route.length < 2 || !routeForecast?.routePoints?.length) {
      return { features, legForecasts };
    }

    for (let index = 0; index < route.length - 1; index += 1) {
      const from = route[index];
      const to = route[index + 1];
      const point = nearestRouteForecastPoint(routeForecast, to) || nearestRouteForecastPoint(routeForecast, from);
      const legDistanceNm = distanceNm(from.lat, from.lon, to.lat, to.lon);
      cumulativeEndNm += legDistanceNm;
      const legBearingDeg = bearingDeg(from.lat, from.lon, to.lat, to.lon);
      const isPassed = cumulativeEndNm <= originProgress && originProgress > 0;
      const etaHours =
        !isPassed && Number.isFinite(planningSpeedKt) && planningSpeedKt > 0
          ? Math.max(0, (cumulativeEndNm - originProgress) / planningSpeedKt)
          : null;
      const etaDate = dateFromDepartureHours(departureTime, etaHours);
      const etaMatchedRow = routePointRowNearestEta(point, etaDate);
      const rawRow = etaMatchedRow || routePointRow(point, selectedIndex, selectedValid);
      const seasFilled = fillMissingSeasFromNearestRoutePoint(rawRow, routeForecast, to, selectedIndex);
      const row = seasFilled.row;
      const rowIndex = point?.timeline?.findIndex((candidate) => candidate.valid === row?.valid) ?? -1;
      const nextRow = rowIndex >= 0 ? point?.timeline?.[rowIndex + 1] || null : null;
      const level = exposureLevel(row);
      const color = exposureColor(row);
      const legLabel = `${from.id}-${to.id}`;
      const sourcePoint = point ? `${point.id} ${point.name}`.trim() : "No route sample";
      const legForecast: RouteLegForecast = {
        legLabel,
        fromName: from.name,
        toName: to.name,
        distanceNm: legDistanceNm,
        cumulativeEndNm,
        bearingDeg: legBearingDeg,
        etaLabel: isPassed ? "Passed" : formatEtaLabel(departureTime, etaHours),
        weatherTimeLabel: row?.label || row?.valid || selectedTime?.label || "--",
        etaMatched: Boolean(etaMatchedRow),
        level,
        color,
        row,
        sourcePoint,
        seasSourcePoint: seasFilled.seasSourcePoint,
        risks: riskFlagsForLeg(row, legBearingDeg, nextRow),
      };

      legForecasts.push(legForecast);
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [coordinates[index], coordinates[index + 1]],
        },
        properties: {
          legLabel,
          fromName: from.name,
          toName: to.name,
          level,
          color,
          sourcePoint,
          distanceNm: legDistanceNm,
          bearingDeg: legBearingDeg,
          etaLabel: legForecast.etaLabel,
          weatherTimeLabel: legForecast.weatherTimeLabel,
          etaMatched: legForecast.etaMatched,
          valid: row?.valid || selectedTime?.valid || "",
          windKt: row?.windKt ?? null,
          windDir: row?.windDir ?? null,
          gustKt: row?.gustKt ?? null,
          seasFt: row?.seasFt ?? null,
          swellFt: row?.swellFt ?? null,
          swellPeriod: row?.swellPeriod ?? null,
          pressureHpa: row?.pressureHpa ?? null,
        },
      });
    }

    return { features, legForecasts };
  }, [departureTime, gribSummary?.routeForecast, ownShip, planningSpeedKt, route, selectedIndex, selectedTime?.valid, useAisOrigin]);

  const routeExposureSummary = useMemo(() => {
    return summarizeScenarioLegs(routeExposure.legForecasts, projectedForecast.usingRouteSample ? [projectedForecast.row] : []);
  }, [projectedForecast.row, projectedForecast.usingRouteSample, routeExposure.legForecasts]);

  const whatIfLegForecasts = useMemo(() => {
    const legForecasts: RouteLegForecast[] = [];
    const selectedValid = selectedTime?.valid;
    const routeForecast = gribSummary?.routeForecast || null;
    const originProgress = planningOriginProgress(route, ownShip, useAisOrigin);
    let cumulativeEndNm = 0;

    if (route.length < 2 || !routeForecast?.routePoints?.length || !Number.isFinite(whatIfSpeedKt) || whatIfSpeedKt < 0) {
      return legForecasts;
    }

    for (let index = 0; index < route.length - 1; index += 1) {
      const from = route[index];
      const to = route[index + 1];
      const point = nearestRouteForecastPoint(routeForecast, to) || nearestRouteForecastPoint(routeForecast, from);
      const legDistanceNm = distanceNm(from.lat, from.lon, to.lat, to.lon);
      cumulativeEndNm += legDistanceNm;
      const legBearingDeg = bearingDeg(from.lat, from.lon, to.lat, to.lon);
      const isPassed = cumulativeEndNm <= originProgress && originProgress > 0;
      const etaHours =
        !isPassed && whatIfSpeedKt > 0
          ? Math.max(0, (cumulativeEndNm - originProgress) / whatIfSpeedKt)
          : null;
      const etaDate = dateFromDepartureHours(whatIfDepartureTime, etaHours);
      const etaMatchedRow = routePointRowNearestEta(point, etaDate);
      const rawRow = etaMatchedRow || routePointRow(point, selectedIndex, selectedValid);
      const seasFilled = fillMissingSeasFromNearestRoutePoint(rawRow, routeForecast, to, selectedIndex);
      const row = seasFilled.row;
      const rowIndex = point?.timeline?.findIndex((candidate) => candidate.valid === row?.valid) ?? -1;
      const nextRow = rowIndex >= 0 ? point?.timeline?.[rowIndex + 1] || null : null;
      const level = exposureLevel(row);
      const sourcePoint = point ? `${point.id} ${point.name}`.trim() : "No route sample";

      legForecasts.push({
        legLabel: `${from.id}-${to.id}`,
        fromName: from.name,
        toName: to.name,
        distanceNm: legDistanceNm,
        cumulativeEndNm,
        bearingDeg: legBearingDeg,
        etaLabel: isPassed ? "Passed" : formatEtaLabel(whatIfDepartureTime, etaHours),
        weatherTimeLabel: row?.label || row?.valid || selectedTime?.label || "--",
        etaMatched: Boolean(etaMatchedRow),
        level,
        color: exposureColor(row),
        row,
        sourcePoint,
        seasSourcePoint: seasFilled.seasSourcePoint,
        risks: riskFlagsForLeg(row, legBearingDeg, nextRow),
      });
    }

    return legForecasts;
  }, [gribSummary?.routeForecast, ownShip, route, selectedIndex, selectedTime?.label, selectedTime?.valid, useAisOrigin, whatIfDepartureTime, whatIfSpeedKt]);

  const whatIfSummary = useMemo(() => summarizeScenarioLegs(whatIfLegForecasts), [whatIfLegForecasts]);
  const routeOriginProgress = planningOriginProgress(route, ownShip, useAisOrigin);
  const baseRouteHours =
    Number.isFinite(planningSpeedKt) && planningSpeedKt > 0 && routeDistanceNm > 0
      ? Math.max(0, (routeDistanceNm - routeOriginProgress) / planningSpeedKt)
      : null;
  const whatIfRouteHours =
    Number.isFinite(whatIfSpeedKt) && whatIfSpeedKt > 0 && routeDistanceNm > 0
      ? Math.max(0, (routeDistanceNm - routeOriginProgress) / whatIfSpeedKt)
      : null;
  const whatIfTotalHours =
    whatIfRouteHours !== null && Number.isFinite(whatIfDelay)
      ? Math.max(0, whatIfDelay) + whatIfRouteHours
      : null;
  const arrivalDeltaHours =
    baseRouteHours !== null && whatIfTotalHours !== null
      ? whatIfTotalHours - baseRouteHours
      : null;

  const stormSummary = useMemo(() => {
    const legs = routeExposure.legForecasts.filter((leg) => leg.row);
    const riskLegs = routeExposure.legForecasts.filter((leg) => leg.level === "HIGH" || leg.level === "CAUTION");
    const worstGustLeg = legs.reduce<RouteLegForecast | null>((worst, leg) => {
      const legGust = Math.max(leg.row?.gustKt ?? 0, leg.row?.windKt ?? 0);
      const worstGust = Math.max(worst?.row?.gustKt ?? 0, worst?.row?.windKt ?? 0);
      return !worst || legGust > worstGust ? leg : worst;
    }, null);
    const worstSeaLeg = legs.reduce<RouteLegForecast | null>((worst, leg) => {
      const legSeas = leg.row?.seasFt ?? 0;
      const worstSeas = worst?.row?.seasFt ?? 0;
      return !worst || legSeas > worstSeas ? leg : worst;
    }, null);
    const lowestPressureLeg = legs.reduce<RouteLegForecast | null>((lowest, leg) => {
      const pressure = leg.row?.pressureHpa;
      const lowestPressure = lowest?.row?.pressureHpa;
      if (pressure === null || pressure === undefined || !Number.isFinite(pressure)) return lowest;
      if (lowestPressure === null || lowestPressure === undefined || !Number.isFinite(lowestPressure)) return leg;
      return pressure < lowestPressure ? leg : lowest;
    }, null);
    const riskFlags = riskLegs.flatMap((leg) =>
      leg.risks.map((risk) => ({
        ...risk,
        legLabel: leg.legLabel,
        weatherTimeLabel: leg.weatherTimeLabel,
      })),
    );

    return {
      legs,
      riskLegs,
      worstGustLeg,
      worstSeaLeg,
      lowestPressureLeg,
      riskFlags,
      status: routeExposureSummary.topLevel,
    };
  }, [routeExposure.legForecasts, routeExposureSummary.topLevel]);

  const isobarFeatures = useMemo(
    () => buildIsobarFeatures(gribSummary?.isobarGrid || [], selectedIndex, selectedTime?.valid),
    [gribSummary?.isobarGrid, selectedIndex, selectedTime?.valid],
  );
  const windFlowSamples = useMemo(() => {
    const samples = new Map<string, { lat: number; lon: number; windKt: number; windDir: number }>();

    function addSample(lat: number, lon: number, row: GribTimelineRow | null | undefined) {
      if (!row || row.windKt === null || row.windDir === null || row.windKt === undefined || row.windDir === undefined) return;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(row.windKt) || !Number.isFinite(row.windDir)) return;
      const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      samples.set(key, {
        lat,
        lon,
        windKt: row.windKt,
        windDir: row.windDir,
      });
    }

    for (const point of gribSummary?.isobarGrid || []) {
      addSample(point.lat, point.lon, isobarRowForPoint(point, selectedIndex, selectedTime?.valid));
    }
    for (const point of gribSummary?.overlayPoints || []) {
      addSample(point.lat, point.lon, rowForPoint(point, selectedIndex, selectedTime?.valid));
    }
    for (const point of gribSummary?.routeForecast?.routePoints || []) {
      addSample(point.lat, point.lon, routePointRow(point, selectedIndex, selectedTime?.valid));
    }

    return Array.from(samples.values());
  }, [gribSummary?.isobarGrid, gribSummary?.overlayPoints, gribSummary?.routeForecast?.routePoints, selectedIndex, selectedTime?.valid]);

  function refreshWxSource() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const data = {
      type: "FeatureCollection",
      features: mapFeatures,
    };

    const source = map.getSource(WX_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
      applyLayerVisibility();
      return;
    }

    map.addSource(WX_SOURCE_ID, {
      type: "geojson",
      data,
    });

    map.addLayer({
      id: WX_POINT_LAYER_ID,
      type: "circle",
      source: WX_SOURCE_ID,
      layout: {
        visibility: "none",
      },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 4, 6, 7, 10, 11],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.78,
        "circle-stroke-color": nightMode ? "#e2e8f0" : "#0f172a",
        "circle-stroke-width": 1.2,
      },
    });

    map.addLayer({
      id: WX_WIND_LAYER_ID,
      type: "symbol",
      source: WX_SOURCE_ID,
      layout: {
        visibility: "none",
        "text-field": "^",
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 14, 8, 22],
        "text-rotate": ["get", "rotation"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": nightMode ? "#f8fafc" : "#0f172a",
        "text-halo-color": nightMode ? "#020617" : "#ffffff",
        "text-halo-width": 2,
      },
    });

    map.addLayer({
      id: WX_LABEL_LAYER_ID,
      type: "symbol",
      source: WX_SOURCE_ID,
      minzoom: 6,
      layout: {
        visibility: "none",
        "text-field": ["get", "shortLabel"],
        "text-size": 11,
        "text-offset": [0, 1.7],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": nightMode ? "#f8fafc" : "#111827",
        "text-halo-color": nightMode ? "#020617" : "#ffffff",
        "text-halo-width": nightMode ? 2.5 : 3,
      },
    });

    if (!handlersBoundRef.current) {
      map.on("click", WX_POINT_LAYER_ID, (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties || {};
        const row: GribTimelineRow = {
          label: selectedTime?.label || "",
          valid: props.valid || selectedTime?.valid || "",
          forecast: selectedTime?.forecast || "",
          windKt: propertyNumber(props.windKt),
          windDir: propertyNumber(props.windDir),
          gustKt: propertyNumber(props.gustKt),
          seasFt: propertyNumber(props.seasFt),
          swellFt: propertyNumber(props.swellFt),
          swellPeriod: propertyNumber(props.swellPeriod),
          pressureHpa: propertyNumber(props.pressureHpa),
          tempC: null,
        };

        setSelectedPoint({
          lat: Number(props.lat),
          lon: Number(props.lon),
          label: props.label || "GRIB sample",
          row,
        });
        setSelectedRouteLeg(null);
      });

      map.on("mouseenter", WX_POINT_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", WX_POINT_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      handlersBoundRef.current = true;
    }

    applyLayerVisibility();
  }

  function applyLayerVisibility() {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer(WX_WIND_LAYER_ID)) {
      map.setLayoutProperty(WX_WIND_LAYER_ID, "visibility", showGribPointLayer ? "visible" : "none");
    }
    if (map.getLayer(WX_POINT_LAYER_ID)) {
      map.setLayoutProperty(WX_POINT_LAYER_ID, "visibility", showGribPointLayer ? "visible" : "none");
    }
    if (map.getLayer(WX_LABEL_LAYER_ID)) {
      map.setLayoutProperty(WX_LABEL_LAYER_ID, "visibility", showGribPointLayer ? "visible" : "none");
    }
    if (map.getLayer(ROUTE_EXPOSURE_LAYER_ID)) {
      map.setLayoutProperty(ROUTE_EXPOSURE_LAYER_ID, "visibility", showRouteExposureLayer ? "visible" : "none");
    }
    [ISOBAR_GLOW_LAYER_ID, ISOBAR_LINE_LAYER_ID, ISOBAR_LABEL_LAYER_ID].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", showIsobarLayer ? "visible" : "none");
      }
    });
    [OWNSHIP_LAYER_ID, OWNSHIP_LABEL_LAYER_ID].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", showPositionLayer ? "visible" : "none");
        try {
          map.moveLayer(layerId);
        } catch {
          // Layer order is best-effort across style refreshes.
        }
      }
    });

    if (!showProjectedPosition) {
      projectedMarkerRef.current?.remove();
      projectedMarkerRef.current = null;
      projectedEdgeMarkerRef.current?.remove();
      projectedEdgeMarkerRef.current = null;
    } else {
      scheduleProjectedRefresh();
    }
  }

  function refreshRouteExposureSource() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const data = {
      type: "FeatureCollection",
      features: routeExposure.features,
    };

    const source = map.getSource(ROUTE_EXPOSURE_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
    } else {
      map.addSource(ROUTE_EXPOSURE_SOURCE_ID, {
        type: "geojson",
        data,
      });

      map.addLayer({
        id: ROUTE_EXPOSURE_LAYER_ID,
        type: "line",
        source: ROUTE_EXPOSURE_SOURCE_ID,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 4, 7, 7, 10, 10],
          "line-opacity": 0.95,
        },
      });
    }

    if (!routeExposureHandlersBoundRef.current) {
      map.on("click", ROUTE_EXPOSURE_LAYER_ID, (event: any) => {
        const feature = event.features?.[0];
        const props = feature?.properties || {};
        if (!feature) return;

        const row: GribTimelineRow | null = props.valid
          ? {
              label: selectedTime?.label || "",
              valid: props.valid || selectedTime?.valid || "",
              forecast: selectedTime?.forecast || "",
              windKt: propertyNumber(props.windKt),
              windDir: propertyNumber(props.windDir),
              gustKt: propertyNumber(props.gustKt),
              seasFt: propertyNumber(props.seasFt),
              swellFt: propertyNumber(props.swellFt),
              swellPeriod: propertyNumber(props.swellPeriod),
              pressureHpa: propertyNumber(props.pressureHpa),
              tempC: null,
            }
          : null;

        setSelectedRouteLeg({
          legLabel: props.legLabel || "Route leg",
          fromName: props.fromName || "",
          toName: props.toName || "",
          distanceNm: propertyNumber(props.distanceNm) || 0,
          cumulativeEndNm: 0,
          bearingDeg: propertyNumber(props.bearingDeg) || 0,
          etaLabel: props.etaLabel || "--",
          weatherTimeLabel: props.weatherTimeLabel || row?.label || row?.valid || "--",
          etaMatched: props.etaMatched === true || props.etaMatched === "true",
          level: props.level || "NO DATA",
          color: props.color || "#64748b",
          row,
          sourcePoint: props.sourcePoint || "Route sample",
          risks: riskFlagsForLeg(row, propertyNumber(props.bearingDeg) || 0),
        });
        setSelectedPoint(null);
      });

      map.on("mouseenter", ROUTE_EXPOSURE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", ROUTE_EXPOSURE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      routeExposureHandlersBoundRef.current = true;
    }

    applyLayerVisibility();
  }

  function refreshIsobarSource() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const data = {
      type: "FeatureCollection",
      features: isobarFeatures,
    };

    const source = map.getSource(ISOBAR_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
      if (!map.getLayer(ISOBAR_GLOW_LAYER_ID)) {
        map.addLayer(
          {
            id: ISOBAR_GLOW_LAYER_ID,
            type: "line",
            source: ISOBAR_SOURCE_ID,
            filter: ["==", ["geometry-type"], "LineString"],
            paint: {
              "line-color": nightMode ? "#38bdf8" : "#0f766e",
              "line-width": ["interpolate", ["linear"], ["zoom"], 2, 3, 7, 5, 10, 7],
              "line-opacity": isPlaying ? 0.28 : 0.16,
            },
          },
          map.getLayer(ISOBAR_LINE_LAYER_ID) ? ISOBAR_LINE_LAYER_ID : undefined,
        );
      }
      if (map.getLayer(ISOBAR_GLOW_LAYER_ID)) {
        map.setPaintProperty(ISOBAR_GLOW_LAYER_ID, "line-color", nightMode ? "#38bdf8" : "#0f766e");
        map.setPaintProperty(ISOBAR_GLOW_LAYER_ID, "line-opacity", isPlaying ? 0.28 : 0.16);
      }
      if (map.getLayer(ISOBAR_LINE_LAYER_ID)) {
        map.setPaintProperty(ISOBAR_LINE_LAYER_ID, "line-color", nightMode ? "#e0f2fe" : "#064e3b");
        map.setPaintProperty(ISOBAR_LINE_LAYER_ID, "line-opacity", nightMode ? 0.96 : 0.9);
      }
      if (map.getLayer(ISOBAR_LABEL_LAYER_ID)) {
        map.setPaintProperty(ISOBAR_LABEL_LAYER_ID, "text-color", nightMode ? "#e0f2fe" : "#064e3b");
        map.setPaintProperty(ISOBAR_LABEL_LAYER_ID, "text-halo-color", nightMode ? "#020617" : "#ffffff");
        map.setPaintProperty(ISOBAR_LABEL_LAYER_ID, "text-halo-width", 2);
      }
      applyLayerVisibility();
      return;
    }

    map.addSource(ISOBAR_SOURCE_ID, {
      type: "geojson",
      data,
    });

    map.addLayer({
      id: ISOBAR_GLOW_LAYER_ID,
      type: "line",
      source: ISOBAR_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": nightMode ? "#38bdf8" : "#0f766e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 3, 7, 5, 10, 7],
        "line-opacity": isPlaying ? 0.28 : 0.16,
      },
    });

    map.addLayer({
      id: ISOBAR_LINE_LAYER_ID,
      type: "line",
      source: ISOBAR_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": nightMode ? "#e0f2fe" : "#064e3b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.8, 7, 2.6, 10, 3.4],
        "line-opacity": nightMode ? 0.96 : 0.9,
      },
    });

    map.addLayer({
      id: ISOBAR_LABEL_LAYER_ID,
      type: "symbol",
      source: ISOBAR_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      minzoom: 4,
      layout: {
        "text-field": ["get", "pressure"],
        "text-size": 13,
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": nightMode ? "#e0f2fe" : "#064e3b",
        "text-halo-color": nightMode ? "#020617" : "#ffffff",
        "text-halo-width": 2,
      },
    });

    applyLayerVisibility();
  }

  function refreshRouteSource() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const routeCoordinates = routeCoordinatesForChart(route);
    const waypointFeatures = routeCoordinates.map((coordinates, index) => {
      const waypoint = route[index];

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates,
        },
        properties: {
          label: waypoint?.id || `WP${index + 1}`,
          name: waypoint?.name || `Waypoint ${index + 1}`,
        },
      };
    });

    const data = {
      type: "FeatureCollection",
      features: [
        routeCoordinates.length >= 2
          ? {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: routeCoordinates,
              },
              properties: {
                routeName: routeState?.routeName || "Loaded Route",
              },
            }
          : null,
        ...waypointFeatures,
      ].filter(Boolean),
    };

    const source = map.getSource(ROUTE_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
      if (map.getLayer(ROUTE_LINE_LAYER_ID)) {
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, "line-color", gribSummary?.routeForecast ? "#334155" : "#c9a227");
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, "line-width", gribSummary?.routeForecast ? 3 : 4);
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, "line-opacity", gribSummary?.routeForecast ? 0.55 : 0.92);
      }
    } else {
      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data,
      });

      map.addLayer({
        id: ROUTE_LINE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": gribSummary?.routeForecast ? "#334155" : "#c9a227",
          "line-width": gribSummary?.routeForecast ? 3 : 4,
          "line-opacity": gribSummary?.routeForecast ? 0.55 : 0.92,
        },
      });

      map.addLayer({
        id: ROUTE_WAYPOINT_LAYER_ID,
        type: "circle",
        source: ROUTE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#c9a227",
          "circle-stroke-color": nightMode ? "#020617" : "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      map.addLayer({
        id: ROUTE_WAYPOINT_LABEL_LAYER_ID,
        type: "symbol",
        source: ROUTE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        minzoom: 4,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": nightMode ? "#f8fafc" : "#111827",
          "text-halo-color": nightMode ? "#020617" : "#ffffff",
          "text-halo-width": nightMode ? 2.5 : 3,
        },
      });
    }

    if (routeCoordinates.length >= 2) {
      const lons = routeCoordinates.map((coordinate) => coordinate[0]);
      const lats = routeCoordinates.map((coordinate) => coordinate[1]);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      if (maxLon > 180 || minLon < -180) {
        map.easeTo({
          center: [normalizedLongitude((minLon + maxLon) / 2), (minLat + maxLat) / 2],
          zoom: zoomForRouteSpan(maxLat - minLat, maxLon - minLon),
          duration: 600,
        });
      } else {
        const bounds = routeCoordinates.reduce((nextBounds: any, coordinate) => {
          nextBounds.extend(coordinate);
          return nextBounds;
        }, new maplibreRef.current.LngLatBounds(routeCoordinates[0], routeCoordinates[0]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 600 });
      }
    }
  }

  function refreshProjectedSource() {
    const map = mapRef.current;
    const overlay = projectedOverlayRef.current;
    if (!map || !overlay || !map.isStyleLoaded()) return;

    if (!showProjectedPosition) {
      projectedMarkerRef.current?.remove();
      projectedMarkerRef.current = null;
      projectedEdgeMarkerRef.current?.remove();
      projectedEdgeMarkerRef.current = null;
      return;
    }

    const emptyData = {
      type: "FeatureCollection",
      features: [],
    };

    const source = map.getSource(PROJECTED_SOURCE_ID);
    if (source?.setData) {
      source.setData(emptyData);
    }

    const currentProjection = projectionRef.current;
    if (!currentProjection) {
      projectedMarkerRef.current?.remove();
      projectedMarkerRef.current = null;
      projectedEdgeMarkerRef.current?.remove();
      projectedEdgeMarkerRef.current = null;
      return;
    }

    if (!projectedMarkerRef.current) {
      const markerEl = document.createElement("div");
      markerEl.style.position = "absolute";
      markerEl.style.width = "30px";
      markerEl.style.height = "30px";
      markerEl.style.pointerEvents = "none";
      markerEl.style.zIndex = "1";

      const ring = document.createElement("div");
      ring.style.width = "30px";
      ring.style.height = "30px";
      ring.style.border = "4px solid #22d3ee";
      ring.style.borderRadius = "9999px";
      ring.style.background = "rgba(34, 211, 238, 0.28)";
      ring.style.boxShadow = "0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 18px rgba(34, 211, 238, 0.8)";

      const label = document.createElement("div");
      label.dataset.projectedLabel = "true";
      label.style.position = "absolute";
      label.style.left = "50%";
      label.style.top = "34px";
      label.style.transform = "translateX(-50%)";
      label.style.padding = "1px 4px";
      label.style.borderRadius = "4px";
      label.style.background = nightModeRef.current ? "rgba(2, 6, 23, 0.86)" : "rgba(255, 255, 255, 0.9)";
      label.style.color = nightModeRef.current ? "#f8fafc" : "#111827";
      label.style.fontSize = "11px";
      label.style.fontWeight = "900";
      label.style.lineHeight = "1.1";
      label.style.whiteSpace = "nowrap";
      label.style.textShadow = nightModeRef.current ? "0 1px 2px #020617" : "0 1px 2px #ffffff";

      markerEl.appendChild(ring);
      markerEl.appendChild(label);
      overlay.appendChild(markerEl);

      projectedMarkerRef.current = markerEl;
    }

    const projectedPoint = map.project([currentProjection.lon, currentProjection.lat]);
    projectedMarkerRef.current.style.transform = `translate(${projectedPoint.x - 15}px, ${projectedPoint.y - 15}px)`;
    const label = projectedMarkerRef.current.querySelector("[data-projected-label]") as HTMLDivElement | null;
    if (label) {
      label.textContent = planningSpeedRef.current === 0 ? "HOLD" : "PROJECTED";
      label.style.background = nightModeRef.current ? "rgba(2, 6, 23, 0.86)" : "rgba(255, 255, 255, 0.9)";
      label.style.color = nightModeRef.current ? "#f8fafc" : "#111827";
      label.style.textShadow = nightModeRef.current ? "0 1px 2px #020617" : "0 1px 2px #ffffff";
    }

    const overlayRect = overlay.getBoundingClientRect();
    const visibleLeft = Math.max(0, -overlayRect.left);
    const visibleTop = Math.max(0, -overlayRect.top);
    const visibleRight = Math.min(overlayRect.width, window.innerWidth - overlayRect.left);
    const visibleBottom = Math.min(overlayRect.height, window.innerHeight - overlayRect.top);
    const hasVisibleMapArea = visibleRight > visibleLeft && visibleBottom > visibleTop;
    const isOffVisibleMap =
      hasVisibleMapArea &&
      (projectedPoint.x < visibleLeft ||
        projectedPoint.x > visibleRight ||
        projectedPoint.y < visibleTop ||
        projectedPoint.y > visibleBottom);

    if (!hasVisibleMapArea || !isOffVisibleMap) {
      projectedEdgeMarkerRef.current?.remove();
      projectedEdgeMarkerRef.current = null;
      return;
    }

    if (!projectedEdgeMarkerRef.current) {
      const edgeMarker = document.createElement("div");
      edgeMarker.style.position = "absolute";
      edgeMarker.style.pointerEvents = "none";
      edgeMarker.style.zIndex = "2";
      edgeMarker.style.padding = "4px 7px";
      edgeMarker.style.border = "2px solid #22d3ee";
      edgeMarker.style.borderRadius = "6px";
      edgeMarker.style.background = "rgba(2, 6, 23, 0.88)";
      edgeMarker.style.color = "#f8fafc";
      edgeMarker.style.fontSize = "11px";
      edgeMarker.style.fontWeight = "900";
      edgeMarker.style.lineHeight = "1";
      edgeMarker.style.whiteSpace = "nowrap";
      edgeMarker.style.boxShadow = "0 0 14px rgba(34, 211, 238, 0.55)";
      overlay.appendChild(edgeMarker);
      projectedEdgeMarkerRef.current = edgeMarker;
    }

    const clampedX = Math.min(Math.max(projectedPoint.x, visibleLeft + 20), visibleRight - 92);
    const clampedY = Math.min(Math.max(projectedPoint.y, visibleTop + 18), visibleBottom - 24);
    const arrow =
      projectedPoint.x < visibleLeft ? "<" : projectedPoint.x > visibleRight ? ">" : projectedPoint.y < visibleTop ? "^" : "v";
    projectedEdgeMarkerRef.current.textContent = `${planningSpeedRef.current === 0 ? "HOLD" : "PROJECTED"} ${arrow}`;
    projectedEdgeMarkerRef.current.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  }

  function scheduleProjectedRefresh() {
    refreshProjectedSource();

    if (typeof window === "undefined") return;

    projectedRefreshTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    projectedRefreshTimersRef.current = [];

    window.requestAnimationFrame(() => {
      refreshProjectedSource();
      window.requestAnimationFrame(refreshProjectedSource);
    });

    projectedRefreshTimersRef.current = [100, 350, 800].map((delay) =>
      window.setTimeout(refreshProjectedSource, delay),
    );
  }

  function refreshOwnShipSource() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const hasOwnShipPosition =
      ownShip &&
      Number.isFinite(ownShip.lat) &&
      Number.isFinite(ownShip.lon) &&
      Math.abs(ownShip.lat) <= 90 &&
      Math.abs(ownShip.lon) <= 180;

    const data = {
      type: "FeatureCollection",
      features: hasOwnShipPosition
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [ownShip.lon, ownShip.lat],
              },
              properties: {
                label: "CURRENT POSITION",
              },
            },
          ]
        : [],
    };

    const source = map.getSource(OWNSHIP_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
      if (map.getLayer(OWNSHIP_LABEL_LAYER_ID)) {
        map.setPaintProperty(OWNSHIP_LABEL_LAYER_ID, "text-color", nightMode ? "#f8fafc" : "#111827");
        map.setPaintProperty(OWNSHIP_LABEL_LAYER_ID, "text-halo-color", nightMode ? "#020617" : "#ffffff");
      }
    } else {
      map.addSource(OWNSHIP_SOURCE_ID, {
        type: "geojson",
        data,
      });
    }

    if (!map.getLayer(OWNSHIP_LAYER_ID)) {
      map.addLayer({
        id: OWNSHIP_LAYER_ID,
        type: "circle",
        source: OWNSHIP_SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 7, 10, 11, 14],
          "circle-color": "#f59e0b",
          "circle-opacity": 0.96,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
    }

    if (!map.getLayer(OWNSHIP_LABEL_LAYER_ID)) {
      map.addLayer({
        id: OWNSHIP_LABEL_LAYER_ID,
        type: "symbol",
        source: OWNSHIP_SOURCE_ID,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.8],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": nightMode ? "#f8fafc" : "#111827",
          "text-halo-color": nightMode ? "#020617" : "#ffffff",
          "text-halo-width": 2.5,
        },
      });
    }

    [OWNSHIP_LAYER_ID, OWNSHIP_LABEL_LAYER_ID].forEach((layerId) => {
      try {
        if (map.getLayer(layerId)) map.moveLayer(layerId);
      } catch {
        // Layer order is best-effort across style refreshes.
      }
    });

    applyLayerVisibility();
  }

  function applyGribSummary(data: any, fallbackName = "Saved GRIB", fallbackSize = 0) {
    const nextSummary = {
      fileName: data?.fileName || fallbackName,
      fileSize: Number.isFinite(Number(data?.fileSize)) ? Number(data.fileSize) : fallbackSize,
      loadedAt: data?.loadedAt || new Date().toISOString(),
      status: data?.status || "GRIB loaded",
      summary: data?.summary || "GRIB loaded.",
      sourceNotes: data?.sourceNotes || "",
      inventoryPreview: data?.inventoryPreview || "",
      timeline: Array.isArray(data?.timeline) ? data.timeline : [],
      overlayPoints: Array.isArray(data?.overlayPoints) ? data.overlayPoints : [],
      routeForecast: data?.routeForecast || null,
      isobarGrid: Array.isArray(data?.isobarGrid) ? data.isobarGrid : [],
    };

    setGribSummary(nextSummary);
    setSelectedIndex(0);
    setSelectedPoint(null);
    setSelectedRouteLeg(null);
    setGribStatus(nextSummary.status);

    if (!departureTime && nextSummary.timeline[0]?.valid) {
      const validDate = parseUtcDate(nextSummary.timeline[0].valid);
      if (validDate) setDepartureTime(formatDateTimeLocal(validDate));
    }
  }

  async function importGribFile(file: File | null) {
    if (!file) return;

    const lat = Number(sampleLat);
    const lon = Number(sampleLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setGribStatus("Enter a valid sample latitude and longitude before importing GRIB.");
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".grb") && !lowerName.endsWith(".grb2") && !lowerName.endsWith(".grib") && !lowerName.endsWith(".grib2")) {
      setGribStatus("Select a GRIB file ending in .grb, .grb2, .grib, or .grib2.");
      return;
    }

    try {
      setGribLoading(true);
      setGribStatus(`Loading ${file.name}`);

      const form = new FormData();
      form.append("file", file);
      form.append("lat", String(lat));
      form.append("lon", String(lon));

      const response = await fetch("/api/grib-summary", {
        method: "POST",
        body: form,
      });
      const responseText = await response.text();
      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        const plainText = responseText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(plainText ? plainText.slice(0, 180) : `GRIB parser returned ${response.status}.`);
      }

      if (!response.ok) throw new Error(data?.error || `GRIB parser returned ${response.status}.`);
      applyGribSummary(data, file.name, file.size);
    } catch (error) {
      setGribStatus(error instanceof Error ? error.message : "GRIB import failed.");
    } finally {
      setGribLoading(false);
    }
  }

  async function clearGribFile() {
    try {
      await fetch("/api/grib-summary", { method: "DELETE" });
    } catch {
      // Local display still clears even if file cleanup fails.
    }

    setGribSummary(null);
    setSelectedPoint(null);
    setSelectedRouteLeg(null);
    setSelectedIndex(0);
    setGribStatus("No GRIB file loaded");
  }

  function applyRouteState(data: any, fallbackName = "Loaded Route") {
    const waypoints = Array.isArray(data?.waypoints)
      ? data.waypoints
          .map((wp: any, index: number) => ({
            id: typeof wp?.id === "string" && wp.id.trim() ? wp.id : `WP${String(index + 1).padStart(2, "0")}`,
            name: typeof wp?.name === "string" && wp.name.trim() ? wp.name : `Waypoint ${index + 1}`,
            lat: Number(wp?.lat ?? wp?.latitude),
            lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
          }))
          .filter((wp: Waypoint) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon))
      : [];

    if (waypoints.length < 2) {
      setRouteState(null);
      setRouteStatus("No route loaded");
      return;
    }

    const routeName = typeof data?.routeName === "string" && data.routeName.trim() ? data.routeName.trim() : fallbackName;
    setRouteState({
      routeName,
      waypoints,
      activeWaypointIndex: Number.isFinite(Number(data?.activeWaypointIndex)) ? Number(data.activeWaypointIndex) : 1,
    });
    setRouteStatus(`${routeName} loaded - ${waypoints.length} waypoints`);
    if (gribSummary && !gribSummary.routeForecast?.routePoints?.length) {
      setGribStatus("Route loaded. Re-import GRIB to sample weather along this route.");
    }
  }

  async function mirrorRouteStateToLocalHost(data: any) {
    const waypoints = Array.isArray(data?.waypoints) ? data.waypoints : [];
    if (waypoints.length < 2) return;

    await fetch("/api/route-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "route-state",
        routeName: data?.routeName || "AIS Host Route",
        waypoints,
        activeWaypointIndex: Number.isFinite(Number(data?.activeWaypointIndex)) ? Number(data.activeWaypointIndex) : 1,
        savedAt: typeof data?.savedAt === "string" ? data.savedAt : new Date().toISOString(),
      }),
    }).catch(() => undefined);
  }

  async function loadSharedRoute(options: { preserveExisting?: boolean } = {}) {
    try {
      const response = await fetch("/api/route-state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Route state returned ${response.status}`);
      const data = await response.json();
      if (!data?.hasRoute) {
        if (!options.preserveExisting && !routeState) setRouteStatus("No local route is loaded. Waiting for AIS host route.");
        return;
      }
      applyRouteState(data, "Shared Route");
    } catch (error) {
      setRouteStatus(error instanceof Error ? error.message : "Could not load shared route");
    }
  }

  async function importRouteFile(file: File | null) {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseRtzRoute(text);
      applyRouteState({ routeName: parsed.routeName, waypoints: parsed.waypoints, activeWaypointIndex: 1 }, parsed.routeName);

      await fetch("/api/route-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "route-state",
          routeName: parsed.routeName,
          waypoints: parsed.waypoints,
          activeWaypointIndex: 1,
          savedAt: new Date().toISOString(),
        }),
      }).catch(() => undefined);
    } catch (error) {
      setRouteStatus(error instanceof Error ? error.message : "Could not import RTZ route");
    }
  }

  function setSampleFromAis() {
    if (!ownShip) {
      setAisStatus("AIS position is not available yet");
      return;
    }

    setSampleLat(ownShip.lat.toFixed(4));
    setSampleLon(ownShip.lon.toFixed(4));
  }

  function setSampleFromMapCenter() {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    setSampleLat(center.lat.toFixed(4));
    setSampleLon(center.lng.toFixed(4));
  }

  function setManualDepartureFromAis() {
    if (!ownShip) {
      setAisStatus("AIS position is not available yet");
      return;
    }

    setManualDepartureLat(ownShip.lat.toFixed(4));
    setManualDepartureLon(ownShip.lon.toFixed(4));
  }

  function setManualDepartureFromMapCenter() {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    setManualDepartureLat(center.lat.toFixed(4));
    setManualDepartureLon(center.lng.toFixed(4));
  }

  function setManualDepartureFromRouteStart() {
    const first = route[0];
    if (!first) return;
    setManualDepartureLat(first.lat.toFixed(4));
    setManualDepartureLon(first.lon.toFixed(4));
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        localStorage.setItem("navconsole-fullscreen", "true");
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        localStorage.setItem("navconsole-fullscreen", "false");
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } finally {
      setTimeout(() => mapRef.current?.resize(), 250);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      addMapLibreCss();
      const maplibreglModule = await import("maplibre-gl");

      if (cancelled || !mapElRef.current || mapRef.current) return;

      const maplibregl = maplibreglModule.default ?? maplibreglModule;
      maplibreRef.current = maplibregl;

      const map = new maplibregl.Map({
        container: mapElRef.current,
        center: [0, 0],
        zoom: 2,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "OpenStreetMap contributors",
            },
          },
          layers: [
            {
              id: "osm-base",
              type: "raster",
              source: "osm",
            },
          ],
        },
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.on("move", refreshProjectedSource);
      map.on("zoom", refreshProjectedSource);
      map.on("resize", refreshProjectedSource);
      window.addEventListener("scroll", refreshProjectedSource, { passive: true });
      window.addEventListener("resize", refreshProjectedSource);
      map.on("load", () => {
        setMapStatus("Map ready");
        setMapReady(true);
        refreshWxSource();
        refreshIsobarSource();
        refreshRouteSource();
        refreshRouteExposureSource();
        refreshOwnShipSource();
        refreshProjectedSource();
        map.resize();
      });

      mapRef.current = map;
      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapElRef.current);
      setTimeout(() => map.resize(), 250);
    }

    initializeMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", refreshProjectedSource);
      window.removeEventListener("resize", refreshProjectedSource);
      projectedRefreshTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      projectedRefreshTimersRef.current = [];
      if (mapRef.current) {
        projectedMarkerRef.current?.remove();
        projectedMarkerRef.current = null;
        projectedEdgeMarkerRef.current?.remove();
        projectedEdgeMarkerRef.current = null;
        mapRef.current.remove();
        mapRef.current = null;
        setMapReady(false);
        handlersBoundRef.current = false;
        routeExposureHandlersBoundRef.current = false;
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadSavedGrib() {
      try {
        const response = await fetch("/api/grib-summary", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (data?.hasGrib) applyGribSummary(data);
      } catch {
        // WX Routing remains available without a saved GRIB file.
      }
    }

    loadSavedGrib();
    loadSharedRoute({ preserveExisting: true });
  }, []);

  useEffect(() => {
    let closed = false;
    const ws = new WebSocket(getAisWebSocketUrl());

    ws.onopen = () => {
      if (!closed) setAisStatus("AIS websocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "status") {
          setAisStatus(msg.connected ? "AIS feed connected" : msg.lastError || "AIS feed waiting");
          return;
        }
        if (msg?.type === "route-state") {
          if (Array.isArray(msg.waypoints) && msg.waypoints.length >= 2) {
            applyRouteState(msg, "Shared Route");
            mirrorRouteStateToLocalHost(msg);
          }
          return;
        }
        if (msg?.type !== "nmea" || typeof msg.line !== "string") return;

        const decoded = decodeOwnShipPosition(msg.line);
        if (!decoded) return;

        setOwnShip(decoded);
        setAisStatus("AIS position live");
        if (useAisOrigin) {
          setSampleLat(decoded.lat.toFixed(4));
          setSampleLon(decoded.lon.toFixed(4));
        }
      } catch {
        // Keep the WX Routing page running if a websocket message is malformed.
      }
    };

    ws.onerror = () => {
      if (!closed) setAisStatus("AIS websocket error");
    };

    ws.onclose = () => {
      if (!closed) setAisStatus("AIS websocket disconnected");
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [useAisOrigin]);

  useEffect(() => {
    refreshWxSource();
    applyLayerVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapFeatures, nightMode]);

  useEffect(() => {
    refreshRouteSource();
    const refreshTimer = window.setTimeout(() => refreshRouteSource(), 500);
    return () => window.clearTimeout(refreshTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routeState, gribSummary?.routeForecast, nightMode]);

  useEffect(() => {
    refreshRouteExposureSource();
    const refreshTimer = window.setTimeout(() => refreshRouteExposureSource(), 500);
    return () => window.clearTimeout(refreshTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routeExposure.features, nightMode]);

  useEffect(() => {
    if (!selectedRouteLeg) return;
    const updatedLeg = routeExposure.legForecasts.find((leg) => leg.legLabel === selectedRouteLeg.legLabel);
    if (updatedLeg) setSelectedRouteLeg(updatedLeg);
  }, [routeExposure.legForecasts, selectedRouteLeg]);

  useEffect(() => {
    refreshIsobarSource();
    const refreshTimer = window.setTimeout(() => refreshIsobarSource(), 500);
    return () => window.clearTimeout(refreshTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, isobarFeatures, nightMode]);

  useEffect(() => {
    scheduleProjectedRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, projectionRefreshKey, planningSpeedKt, showProjectedPosition, nightMode]);

  useEffect(() => {
    refreshOwnShipSource();
    const refreshTimer = window.setTimeout(() => refreshOwnShipSource(), 500);
    return () => window.clearTimeout(refreshTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, ownShip, nightMode]);

  useEffect(() => {
    applyLayerVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showGribPointLayer, showRouteExposureLayer, showIsobarLayer, showWindLayer, showPositionLayer, showProjectedPosition]);

  useEffect(() => {
    if (!isPlaying || timeline.length <= 1) return;

    playTimerRef.current = window.setInterval(() => {
      setSelectedIndex((current) => (current + 1) % timeline.length);
    }, 1200);

    return () => {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    };
  }, [isPlaying, timeline.length]);

  useEffect(() => {
    const canvas = windCanvasRef.current;
    const map = mapRef.current;
    if (!canvas || !mapReady || !map || (!showWindLayer && !showIsobarLayer) || (!windFlowSamples.length && !isobarFeatures.length)) {
      const context = canvas?.getContext("2d");
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    const canvasEl = canvas;
    const ctx = context;

    let frameId = 0;
    let cancelled = false;
    const maxParticles = Math.min(620, Math.max(220, windFlowSamples.length * 14));

    function resizeCanvas() {
      const bounds = canvasEl.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      const height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      if (canvasEl.width !== width || canvasEl.height !== height) {
        canvasEl.width = width;
        canvasEl.height = height;
        windParticlesRef.current = [];
      }
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function seedParticle(width: number, height: number) {
      if (showWindLayer && windFlowSamples.length && Math.random() < 0.82) {
        const sample = windFlowSamples[Math.floor(Math.random() * windFlowSamples.length)];
        const point = map.project([sample.lon, sample.lat]);
        const x = Math.max(0, Math.min(width, point.x + (Math.random() - 0.5) * 360));
        const y = Math.max(0, Math.min(height, point.y + (Math.random() - 0.5) * 240));
        return {
          x,
          y,
          age: Math.floor(Math.random() * 70),
          life: 120 + Math.floor(Math.random() * 110),
        };
      }

      return {
        x: Math.random() * width,
        y: Math.random() * height,
        age: Math.floor(Math.random() * 80),
        life: 70 + Math.floor(Math.random() * 80),
      };
    }

    function nearestWindSample(x: number, y: number) {
      let best: { x: number; y: number; windKt: number; windDir: number } | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const sample of windFlowSamples) {
        const point = map.project([sample.lon, sample.lat]);
        const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x: point.x, y: point.y, windKt: sample.windKt, windDir: sample.windDir };
        }
      }

      return best && bestDistance < 420000 ? best : null;
    }

    function drawCanvasIsobars() {
      const lineFeatures = isobarFeatures.filter((feature) => feature?.geometry?.type === "LineString");
      const labelFeatures = isobarFeatures.filter((feature) => feature?.geometry?.type === "Point");
      if (!lineFeatures.length) return;

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const feature of lineFeatures) {
        const coordinates = feature.geometry.coordinates || [];
        if (coordinates.length < 2) continue;
        const projected = coordinates.map((coordinate: number[]) => {
          const point = map.project(coordinate);
          return {
            x: Math.round(point.x * 2) / 2,
            y: Math.round(point.y * 2) / 2,
          };
        });
        ctx.beginPath();
        ctx.moveTo(projected[0].x, projected[0].y);
        if (projected.length === 2) {
          ctx.lineTo(projected[1].x, projected[1].y);
        } else {
          for (let index = 0; index < projected.length - 1; index += 1) {
            const current = projected[index];
            const next = projected[index + 1];
            const controlBefore = projected[Math.max(0, index - 1)];
            const controlAfter = projected[Math.min(projected.length - 1, index + 2)];
            ctx.bezierCurveTo(
              current.x + (next.x - controlBefore.x) / 6,
              current.y + (next.y - controlBefore.y) / 6,
              next.x - (controlAfter.x - current.x) / 6,
              next.y - (controlAfter.y - current.y) / 6,
              next.x,
              next.y,
            );
          }
        }
        ctx.lineWidth = 4.2;
        ctx.strokeStyle = nightMode ? "rgba(2, 6, 23, 0.72)" : "rgba(255, 255, 255, 0.9)";
        ctx.stroke();
        ctx.lineWidth = 2.1;
        ctx.strokeStyle = nightMode ? "rgba(224, 242, 254, 0.98)" : "rgba(6, 78, 59, 0.94)";
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.font = "900 13px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const feature of labelFeatures.slice(0, 12)) {
        const coordinate = feature.geometry.coordinates;
        if (!coordinate) continue;
        const projectedLabel = map.project(coordinate);
        const point = {
          x: Math.round(projectedLabel.x),
          y: Math.round(projectedLabel.y),
        };
        const label = feature.properties?.pressure || "";
        if (!label) continue;
        const metrics = ctx.measureText(label);
        const padX = 6;
        const padY = 4;
        const labelWidth = Math.ceil(metrics.width + padX * 2);
        const labelHeight = 20 + padY * 2;
        ctx.fillStyle = nightMode ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)";
        ctx.fillRect(Math.round(point.x - labelWidth / 2), Math.round(point.y - labelHeight / 2), labelWidth, labelHeight);
        ctx.lineWidth = 2;
        ctx.strokeStyle = nightMode ? "rgba(2, 6, 23, 0.95)" : "rgba(255, 255, 255, 0.95)";
        ctx.strokeText(label, point.x, point.y);
        ctx.fillStyle = nightMode ? "rgba(226, 246, 255, 1)" : "rgba(5, 46, 22, 1)";
        ctx.fillText(label, point.x, point.y);
      }
      ctx.restore();
    }

    function draw() {
      if (cancelled) return;

      resizeCanvas();
      const width = canvasEl.clientWidth;
      const height = canvasEl.clientHeight;
      const particles = windParticlesRef.current;
      while (particles.length < maxParticles) particles.push(seedParticle(width, height));

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      if (showWindLayer && windFlowSamples.length) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (let index = 0; index < particles.length; index += 1) {
          const particle = particles[index];
          const sample = nearestWindSample(particle.x, particle.y);
          if (!sample || particle.age > particle.life || particle.x < -20 || particle.y < -20 || particle.x > width + 20 || particle.y > height + 20) {
            particles[index] = seedParticle(width, height);
            continue;
          }

          const towardDeg = sample.windDir + 180;
          const radians = toRad(towardDeg);
          const speed = Math.max(1.05, Math.min(5.6, sample.windKt / 5.8)) * (isPlaying ? 1.18 : 0.92);
          const nextX = particle.x + Math.sin(radians) * speed;
          const nextY = particle.y - Math.cos(radians) * speed;
          const tailX = particle.x - Math.sin(radians) * speed * 1.35;
          const tailY = particle.y + Math.cos(radians) * speed * 1.35;

          const alpha = Math.min(0.92, 0.34 + sample.windKt / 48);
          ctx.globalAlpha = alpha * 0.62;
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = nightMode ? "rgba(2, 6, 23, 0.68)" : "rgba(255, 255, 255, 0.78)";
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(nextX, nextY);
          ctx.stroke();

          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1.75;
          ctx.strokeStyle = nightMode ? "rgba(125, 211, 252, 0.88)" : "rgba(6, 95, 120, 0.82)";
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(nextX, nextY);
          ctx.stroke();

          particle.x = nextX;
          particle.y = nextY;
          particle.age += 1;
        }
      }
      ctx.globalAlpha = 1;
      if (showIsobarLayer) drawCanvasIsobars();

      frameId = window.requestAnimationFrame(draw);
    }

    map.on("move", resizeCanvas);
    map.on("resize", resizeCanvas);
    draw();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      map.off("move", resizeCanvas);
      map.off("resize", resizeCanvas);
    };
  }, [mapReady, windFlowSamples, isobarFeatures, isPlaying, nightMode, showWindLayer, showIsobarLayer]);

  return (
    <main className={pageClass}>
      <div className="mx-auto flex max-w-none flex-col gap-4 p-4 xl:min-h-[calc(100vh-73px)]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className={labelClass}>NavDash 1.3 Weather</div>
            <h1 className="text-3xl font-black uppercase tracking-wide">WX Routing</h1>
            <p className={`mt-1 text-sm ${mutedClass}`}>
              Planning Aid - Verify against official forecasts, approved charts, vessel limitations, and Master/bridge-team judgment.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["GRIB", "ROUTE", "STORM", "WHAT IF", "COMPARE", "LAYERS"] as WxRoutingPanel[]).map((item) => (
              <button
                key={item}
                type="button"
                className={activePanel === item ? activeButtonClass : buttonClass}
                onClick={() => setActivePanel(item)}
              >
                {item}
              </button>
            ))}
            <button type="button" className={buttonClass} onClick={toggleTheme}>
              {nightMode ? "Day Mode" : "Night Mode"}
            </button>
            <button type="button" className={buttonClass} onClick={toggleFullscreen}>
              {isFullscreen ? "Exit Full Screen" : "Full Screen"}
            </button>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[21rem_minmax(0,1fr)_22rem]">
          <aside className={`${panelClass} min-h-0 space-y-4 xl:overflow-auto`}>
            <div className={cardClass}>
              <div className={labelClass}>AIS Position</div>
              <div className={`mt-2 text-sm font-semibold ${ownShip ? "" : mutedClass}`}>{aisStatus}</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className={mutedClass}>Position</div>
                  <div className="font-black">
                    {ownShip ? `${formatLatLon(ownShip.lat, true)} / ${formatLatLon(ownShip.lon, false)}` : "--"}
                  </div>
                </div>
                <div>
                  <div className={mutedClass}>SOG / COG</div>
                  <div className="font-black">
                    {ownShip ? `${formatNumber(ownShip.sog, 1, " kt")} / ${formatDirection(ownShip.cog)}` : "--"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={!ownShip} onClick={setSampleFromAis}>
                  Use AIS Position
                </button>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={useAisOrigin} onChange={(event) => setUseAisOrigin(event.target.checked)} />
                  Use AIS as planning origin
                </label>
              </div>
            </div>

            <div>
              <div className={labelClass}>GRIB Forecast File</div>
              <div className={`mt-2 text-sm font-semibold ${gribSummary ? "" : mutedClass}`}>{gribStatus}</div>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Sample Center</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={`text-xs font-bold ${mutedClass}`}>Latitude</span>
                  <input
                    className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                    value={sampleLat}
                    onChange={(event) => setSampleLat(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className="block">
                  <span className={`text-xs font-bold ${mutedClass}`}>Longitude</span>
                  <input
                    className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                    value={sampleLon}
                    onChange={(event) => setSampleLon(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <button type="button" className={`${buttonClass} mt-3 w-full`} onClick={setSampleFromMapCenter}>
                Use Map Center
              </button>
              <p className={`mt-2 text-xs ${mutedClass}`}>
                GRIB import uses this point for the vessel forecast and samples the loaded route when one is available.
              </p>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Route</div>
              <div className={`mt-2 text-sm font-semibold ${routeState ? "" : mutedClass}`}>{routeStatus}</div>
              <div className={`mt-1 text-xs ${mutedClass}`}>
                {routeState ? `${formatNumber(routeDistanceNm, 1, " nm")} total` : "Load the shared NavDash route or import RTZ/XML."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => loadSharedRoute()}>
                  Load Shared Route
                </button>
                <label className={`${buttonClass} cursor-pointer`}>
                  Import RTZ
                  <input
                    type="file"
                    accept=".rtz,.xml"
                    className="hidden"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const file = event.target.files?.[0] || null;
                      importRouteFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Planning</div>
              <label className="mt-3 flex items-center justify-between gap-3 border border-slate-500/30 px-3 py-2 text-sm font-bold">
                <span>Projected Position</span>
                <input
                  type="checkbox"
                  checked={showProjectedPosition}
                  onChange={(event) => setShowProjectedPosition(event.target.checked)}
                  className="h-4 w-4 accent-[#c9a227]"
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={projectionOriginMode === "current" ? activeButtonClass : buttonClass}
                  onClick={() => setProjectionOriginMode("current")}
                >
                  Current / Now
                </button>
                <button
                  type="button"
                  className={projectionOriginMode === "manual" ? activeButtonClass : buttonClass}
                  onClick={() => {
                    setProjectionOriginMode("manual");
                    if (!departureTime) setDepartureTime(formatDateTimeLocal(new Date()));
                  }}
                >
                  Manual Depart
                </button>
              </div>
              <label className="mt-3 block">
                <span className={`text-xs font-bold ${mutedClass}`}>Planning Speed</span>
                <input
                  className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                  value={planningSpeed}
                  onChange={(event) => setPlanningSpeed(event.target.value)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
              {projectionOriginMode === "manual" ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={`text-xs font-bold ${mutedClass}`}>Departure Lat</span>
                      <input
                        className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                        value={manualDepartureLat}
                        onChange={(event) => setManualDepartureLat(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label className="block">
                      <span className={`text-xs font-bold ${mutedClass}`}>Departure Lon</span>
                      <input
                        className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                        value={manualDepartureLon}
                        onChange={(event) => setManualDepartureLon(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className={`text-xs font-bold ${mutedClass}`}>Departure Time</span>
                    <input
                      className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                      type="datetime-local"
                      value={departureTime}
                      onChange={(event) => setDepartureTime(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} disabled={!ownShip} onClick={setManualDepartureFromAis}>
                      Use AIS
                    </button>
                    <button type="button" className={buttonClass} onClick={setManualDepartureFromMapCenter}>
                      Use Map Center
                    </button>
                    <button type="button" className={buttonClass} disabled={!route.length} onClick={setManualDepartureFromRouteStart}>
                      Use Route Start
                    </button>
                  </div>
                </div>
              ) : (
                <p className={`mt-3 text-xs ${mutedClass}`}>
                  Projection starts from live current position at the current time.
                </p>
              )}
              <p className={`mt-2 text-xs ${mutedClass}`}>
                Use 0 kt to hold the planning vessel at the selected projection origin.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className={gribLoading ? `${buttonClass} cursor-not-allowed opacity-60` : `${buttonClass} cursor-pointer`}>
                {gribLoading ? "Loading GRIB" : "Import GRIB"}
                <input
                  type="file"
                  accept=".grb,.grb2,.grib,.grib2"
                  className="hidden"
                  disabled={gribLoading}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0] || null;
                    importGribFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button type="button" className={buttonClass} disabled={!gribSummary || gribLoading} onClick={clearGribFile}>
                Clear GRIB
              </button>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Weather Display</div>
              <p className={`mt-3 text-xs ${mutedClass}`}>
                Imported GRIB weather is displayed as route exposure, projected forecast values, flowing wind, and pressure isobars when data is available.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className={mutedClass}>Isobar Samples</div>
                <div className="text-right font-black">{gribSummary?.isobarGrid?.length || 0}</div>
              </div>
            </div>

            {gribSummary ? (
              <div className={cardClass}>
                <div className={labelClass}>Data Source</div>
                <div className="mt-2 text-sm font-black">{gribSummary.fileName}</div>
                <div className={`mt-1 text-xs ${mutedClass}`}>{formatFileSize(gribSummary.fileSize)}</div>
                <div className={`mt-3 text-xs ${mutedClass}`}>{gribSummary.sourceNotes}</div>
              </div>
            ) : null}
          </aside>

          <section className={`${panelClass} flex min-h-[34rem] flex-col p-3`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div>
                <div className={labelClass}>Map</div>
                <div className={`text-sm font-bold ${mutedClass}`}>{mapStatus}</div>
              </div>
              <div className="text-right">
                <div className={labelClass}>Valid Time</div>
                <div className="text-sm font-black">{selectedTime?.valid || "Import GRIB"}</div>
              </div>
            </div>
            <div className="relative h-[32rem] min-h-[24rem] flex-none overflow-hidden rounded-xl border border-white/10 bg-slate-900 xl:h-[min(52vh,34rem)]">
              <div className="absolute inset-0 z-0">
                <div ref={mapElRef} className="h-full w-full" />
              </div>
              <canvas ref={windCanvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" />
              <div ref={projectedOverlayRef} className="pointer-events-none absolute inset-0 z-20" />
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between gap-3 px-1">
                <div>
                  <div className={labelClass}>Route Weather Strip</div>
                  <div className={`text-xs ${mutedClass}`}>
                    {routeExposure.legForecasts.length
                      ? `${routeExposure.legForecasts.length} legs, weather matched to planned waypoint ETA`
                      : "Load a route and GRIB file to show leg-by-leg weather."}
                  </div>
                </div>
                <div className="text-right text-xs font-black">
                  {routeExposureSummary.topLevel}
                </div>
              </div>

              {routeExposure.legForecasts.length ? (
                <div className="mt-3 overflow-x-auto pb-1">
                  <div className="grid min-w-[52rem] gap-2" style={{ gridTemplateColumns: `repeat(${routeExposure.legForecasts.length}, minmax(12rem, 1fr))` }}>
                    {routeExposure.legForecasts.map((leg) => (
                      <button
                        key={leg.legLabel}
                        type="button"
                        className={`min-h-[10rem] border p-3 text-left transition hover:-translate-y-0.5 ${
                          dayMode ? "border-slate-300 bg-white hover:bg-slate-50" : "border-white/10 bg-black/25 hover:bg-white/10"
                        }`}
                        style={{ borderTopColor: leg.color, borderTopWidth: 4 }}
                        onClick={() => {
                          setSelectedRouteLeg(leg);
                          setSelectedPoint(null);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-black">{leg.legLabel}</div>
                            <div className={`mt-0.5 text-[0.68rem] font-bold uppercase ${mutedClass}`}>{leg.fromName} to {leg.toName}</div>
                          </div>
                          <div className="text-right text-xs font-black" style={{ color: leg.color }}>{leg.level}</div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className={mutedClass}>DTG</div>
                            <div className="font-black">{formatNumber(leg.distanceNm, 1, " nm")}</div>
                          </div>
                          <div>
                            <div className={mutedClass}>ETA WPT</div>
                            <div className="font-black">{leg.etaLabel}</div>
                          </div>
                          <div>
                            <div className={mutedClass}>WX Time</div>
                            <div className="font-black">{leg.weatherTimeLabel}</div>
                          </div>
                          <div>
                            <div className={mutedClass}>Wind</div>
                            <div className="font-black">{windLabel(leg.row)}</div>
                          </div>
                          <div>
                            <div className={mutedClass}>Seas</div>
                            <div className="font-black">{formatNumber(leg.row?.seasFt, 1, " ft")}</div>
                            {leg.seasSourcePoint ? (
                              <div className={`text-[0.65rem] font-bold ${mutedClass}`}>from {leg.seasSourcePoint}</div>
                            ) : null}
                          </div>
                          <div>
                            <div className={mutedClass}>Gust</div>
                            <div className="font-black">{formatNumber(leg.row?.gustKt, 1, " kt")}</div>
                          </div>
                          <div>
                            <div className={mutedClass}>MSLP</div>
                            <div className="font-black">{formatNumber(leg.row?.pressureHpa, 1, " hPa")}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex min-h-[1.6rem] flex-wrap gap-1">
                          {leg.risks.length ? (
                            leg.risks.map((risk) => (
                              <span
                                key={`${leg.legLabel}-${risk.label}`}
                                className="border px-1.5 py-0.5 text-[0.62rem] font-black"
                                style={{
                                  borderColor: risk.level === "HIGH" ? "#ef4444" : risk.level === "CAUTION" ? "#f59e0b" : "#22d3ee",
                                  color: risk.level === "HIGH" ? "#ef4444" : risk.level === "CAUTION" ? "#f59e0b" : "#0891b2",
                                }}
                              >
                                {risk.label}
                              </span>
                            ))
                          ) : (
                            <span className={`text-xs font-bold ${mutedClass}`}>No risk flags</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <aside className={`${panelClass} min-h-0 space-y-4 xl:overflow-auto`}>
            <div>
              <div className={labelClass}>Selected Forecast</div>
              <div className="mt-2 text-xl font-black">{selectedTime?.label || "--"}</div>
              <div className={`mt-1 text-sm ${mutedClass}`}>{selectedTime?.valid || "No forecast time selected"}</div>
            </div>

            {activePanel === "LAYERS" ? (
              <div className={cardClass}>
                <div className={labelClass}>Map Layers</div>
                <div className="mt-3 space-y-3 text-sm">
                  {[
                    {
                      label: "Wind Streamlines",
                      detail: `${windFlowSamples.length} wind samples`,
                      checked: showWindLayer,
                      setChecked: setShowWindLayer,
                    },
                    {
                      label: "Pressure Isobars",
                      detail: `${isobarFeatures.filter((feature) => feature?.geometry?.type === "LineString").length} contours`,
                      checked: showIsobarLayer,
                      setChecked: setShowIsobarLayer,
                    },
                    {
                      label: "Route Exposure",
                      detail: `${routeExposure.features.length} colored legs`,
                      checked: showRouteExposureLayer,
                      setChecked: setShowRouteExposureLayer,
                    },
                    {
                      label: "GRIB Sample Points",
                      detail: `${mapFeatures.length} map samples`,
                      checked: showGribPointLayer,
                      setChecked: setShowGribPointLayer,
                    },
                    {
                      label: "Position Markers",
                      detail: ownShip ? "Current ownship marker" : "Current ownship marker when AIS is available",
                      checked: showPositionLayer,
                      setChecked: setShowPositionLayer,
                    },
                    {
                      label: "Projected Position",
                      detail: showProjectedPosition ? "Planning overlay enabled" : "Planning overlay off",
                      checked: showProjectedPosition,
                      setChecked: setShowProjectedPosition,
                    },
                  ].map((layer) => (
                    <label
                      key={layer.label}
                      className={`flex items-start justify-between gap-3 border px-3 py-2 ${
                        dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-black/25"
                      }`}
                    >
                      <span>
                        <span className="block font-black">{layer.label}</span>
                        <span className={`block text-xs ${mutedClass}`}>{layer.detail}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={layer.checked}
                        onChange={(event) => layer.setChecked(event.target.checked)}
                        className="mt-1 h-4 w-4 accent-[#c9a227]"
                      />
                    </label>
                  ))}
                </div>
                <div className={`mt-3 border-t pt-3 text-xs ${dayMode ? "border-slate-300 text-slate-600" : "border-white/10 text-slate-400"}`}>
                  Layer changes affect the display only. They do not change the loaded route, GRIB file, or scenario calculations.
                </div>
              </div>
            ) : null}

            {activePanel === "STORM" ? (
              <div className={cardClass}>
                <div className={labelClass}>Storm Watch</div>
                {stormSummary.legs.length ? (
                  <div className="mt-3 space-y-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className={mutedClass}>Route status</span>
                      <span
                        className="font-black"
                        style={{
                          color:
                            stormSummary.status === "HIGH"
                              ? "#ef4444"
                              : stormSummary.status === "CAUTION"
                                ? "#f59e0b"
                                : stormSummary.status === "NORMAL"
                                  ? "#22d3ee"
                                  : undefined,
                        }}
                      >
                        {stormSummary.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className={mutedClass}>Peak Gust</div>
                        <div className="font-black">{formatNumber(stormSummary.worstGustLeg?.row?.gustKt ?? stormSummary.worstGustLeg?.row?.windKt, 1, " kt")}</div>
                        <div className={`text-xs ${mutedClass}`}>{stormSummary.worstGustLeg?.legLabel || "--"} / {stormSummary.worstGustLeg?.weatherTimeLabel || "--"}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Peak Seas</div>
                        <div className="font-black">{formatNumber(stormSummary.worstSeaLeg?.row?.seasFt, 1, " ft")}</div>
                        <div className={`text-xs ${mutedClass}`}>{stormSummary.worstSeaLeg?.legLabel || "--"} / {stormSummary.worstSeaLeg?.weatherTimeLabel || "--"}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Lowest MSLP</div>
                        <div className="font-black">{formatNumber(stormSummary.lowestPressureLeg?.row?.pressureHpa, 1, " hPa")}</div>
                        <div className={`text-xs ${mutedClass}`}>{stormSummary.lowestPressureLeg?.legLabel || "--"} / {stormSummary.lowestPressureLeg?.weatherTimeLabel || "--"}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Risk Legs</div>
                        <div className="font-black">{stormSummary.riskLegs.length}</div>
                        <div className={`text-xs ${mutedClass}`}>{routeExposureSummary.highCount} high / {routeExposureSummary.cautionCount} caution</div>
                      </div>
                    </div>

                    <div>
                      <div className={labelClass}>Watch Items</div>
                      <div className="mt-2 space-y-2">
                        {stormSummary.riskFlags.length ? (
                          stormSummary.riskFlags.slice(0, 8).map((risk, index) => (
                            <div
                              key={`${risk.legLabel}-${risk.label}-${index}`}
                              className={`border px-2 py-1.5 text-xs font-black ${
                                dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-black/25"
                              }`}
                              style={{
                                color: risk.level === "HIGH" ? "#ef4444" : risk.level === "CAUTION" ? "#f59e0b" : "#0891b2",
                              }}
                            >
                              {risk.legLabel} - {risk.label} - {risk.weatherTimeLabel}
                            </div>
                          ))
                        ) : (
                          <div className={`text-sm ${mutedClass}`}>No storm watch items for the currently matched route forecast.</div>
                        )}
                      </div>
                    </div>

                    <div className={`border-t pt-3 text-xs ${dayMode ? "border-slate-300 text-slate-600" : "border-white/10 text-slate-400"}`}>
                      Use this as GRIB model guidance only. Compare against official forecasts, barometer trend, radar/satellite when available, and bridge-team limits.
                    </div>
                  </div>
                ) : (
                  <p className={`mt-3 text-sm ${mutedClass}`}>
                    Load a route and import GRIB after the route is loaded to build a storm watch from route-matched forecast legs.
                  </p>
                )}
              </div>
            ) : null}

            {activePanel === "WHAT IF" ? (
              <div className={cardClass}>
                <div className={labelClass}>What If</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={`text-xs font-bold ${mutedClass}`}>Scenario Speed</span>
                    <input
                      className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                      value={whatIfSpeed}
                      onChange={(event) => setWhatIfSpeed(event.target.value)}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                    />
                  </label>
                  <label className="block">
                    <span className={`text-xs font-bold ${mutedClass}`}>Delay Hours</span>
                    <input
                      className="mt-1 w-full border border-slate-500/40 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                      value={whatIfDelayHours}
                      onChange={(event) => setWhatIfDelayHours(event.target.value)}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                    />
                  </label>
                </div>

                {whatIfSummary.legCount ? (
                  <div className="mt-4 space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className={mutedClass}>Route Time</div>
                        <div className="font-black">{formatDurationHours(whatIfRouteHours)}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Arrival Change</div>
                        <div className="font-black">{formatSignedDurationHours(arrivalDeltaHours)}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Max Wind/Gust</div>
                        <div className="font-black">{formatNumber(whatIfSummary.maxWind, 1, " kt")}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Max Seas</div>
                        <div className="font-black">{formatNumber(whatIfSummary.maxSeas, 1, " ft")}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Risk Legs</div>
                        <div className="font-black">{whatIfSummary.highCount + whatIfSummary.cautionCount}</div>
                      </div>
                      <div>
                        <div className={mutedClass}>Status</div>
                        <div className="font-black">{whatIfSummary.topLevel}</div>
                      </div>
                    </div>

                    <div>
                      <div className={labelClass}>First Affected Legs</div>
                      <div className="mt-2 space-y-2">
                        {whatIfLegForecasts.filter((leg) => leg.level === "HIGH" || leg.level === "CAUTION").slice(0, 4).map((leg) => (
                          <div key={`what-if-${leg.legLabel}`} className={`border px-2 py-1.5 text-xs ${dayMode ? "border-slate-300 bg-white" : "border-white/10 bg-black/25"}`}>
                            <div className="font-black" style={{ color: leg.color }}>{leg.legLabel} - {leg.level}</div>
                            <div className={mutedClass}>{leg.weatherTimeLabel} / {windLabel(leg.row)} / seas {formatNumber(leg.row?.seasFt, 1, " ft")}</div>
                          </div>
                        ))}
                        {!whatIfLegForecasts.some((leg) => leg.level === "HIGH" || leg.level === "CAUTION") ? (
                          <div className={`text-sm ${mutedClass}`}>No caution or high legs in this scenario.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className={`mt-3 text-sm ${mutedClass}`}>
                    Load a route and route-sampled GRIB to test alternate speed or departure delay.
                  </p>
                )}
              </div>
            ) : null}

            {activePanel === "COMPARE" ? (
              <div className={cardClass}>
                <div className={labelClass}>Compare Plan</div>
                {routeExposureSummary.legCount && whatIfSummary.legCount ? (
                  <div className="mt-3 space-y-4 text-sm">
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-xs font-black">
                      <div className={mutedClass}>Metric</div>
                      <div>Current</div>
                      <div>What If</div>
                    </div>
                    {[
                      ["Speed", formatNumber(planningSpeedKt, 1, " kt"), formatNumber(whatIfSpeedKt, 1, " kt")],
                      ["Route Time", formatDurationHours(baseRouteHours), formatDurationHours(whatIfRouteHours)],
                      ["Arrival", "Baseline", formatSignedDurationHours(arrivalDeltaHours)],
                      ["Max Wind", formatNumber(routeExposureSummary.maxWind, 1, " kt"), formatNumber(whatIfSummary.maxWind, 1, " kt")],
                      ["Max Seas", formatNumber(routeExposureSummary.maxSeas, 1, " ft"), formatNumber(whatIfSummary.maxSeas, 1, " ft")],
                      ["High Legs", String(routeExposureSummary.highCount), String(whatIfSummary.highCount)],
                      ["Caution Legs", String(routeExposureSummary.cautionCount), String(whatIfSummary.cautionCount)],
                    ].map(([metric, currentValue, scenarioValue]) => (
                      <div key={metric} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 border-t pt-2 text-xs ${dayMode ? "border-slate-300" : "border-white/10"}`}>
                        <div className={mutedClass}>{metric}</div>
                        <div className="font-black">{currentValue}</div>
                        <div className="font-black">{scenarioValue}</div>
                      </div>
                    ))}

                    <div className={`border-t pt-3 text-xs ${dayMode ? "border-slate-300 text-slate-600" : "border-white/10 text-slate-400"}`}>
                      Compare uses the same route-matched GRIB points as Route Exposure. It changes timing only; it does not alter the actual loaded route.
                    </div>
                  </div>
                ) : (
                  <p className={`mt-3 text-sm ${mutedClass}`}>
                    Load a route and route-sampled GRIB, then set a WHAT IF speed or delay to compare against the current plan.
                  </p>
                )}
              </div>
            ) : null}

            <div className={cardClass}>
              <div className={labelClass}>Route Exposure</div>
              {routeExposureSummary.legCount ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className={mutedClass}>Status</span>
                    <span className="font-black" style={{ color: exposureColor(routeExposure.legForecasts.find((leg) => leg.level === routeExposureSummary.topLevel)?.row || null) }}>
                      {routeExposureSummary.topLevel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className={mutedClass}>Max Wind/Gust</div>
                      <div className="font-black">{formatNumber(routeExposureSummary.maxWind, 1, " kt")}</div>
                    </div>
                    <div>
                      <div className={mutedClass}>{showProjectedPosition ? "Max Seas Incl. Projected" : "Max Seas"}</div>
                      <div className="font-black">{formatNumber(routeExposureSummary.maxSeas, 1, " ft")}</div>
                    </div>
                    <div>
                      <div className={mutedClass}>Caution Legs</div>
                      <div className="font-black">{routeExposureSummary.cautionCount}</div>
                    </div>
                    <div>
                      <div className={mutedClass}>High Legs</div>
                      <div className="font-black">{routeExposureSummary.highCount}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="border border-slate-500/30 px-2 py-1 text-[#22d3ee]">NORMAL</span>
                    <span className="border border-slate-500/30 px-2 py-1 text-[#f59e0b]">CAUTION</span>
                    <span className="border border-slate-500/30 px-2 py-1 text-[#ef4444]">HIGH</span>
                  </div>
                </div>
              ) : (
                <p className={`mt-3 text-sm ${mutedClass}`}>
                  {gribSummary
                    ? "This GRIB is loaded on the map as sample data. Load a route first, then import GRIB again to color route legs."
                    : "Load a route before importing GRIB to color route legs by forecast exposure."}
                </p>
              )}
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Projected Forecast</div>
              <div className={`mt-2 text-xs ${mutedClass}`}>
                {!showProjectedPosition
                  ? "Projected position is off."
                  : projectedForecast.usingRouteSample
                  ? `Nearest route sample: ${projectedForecast.source}${projectedForecast.distanceNm !== null ? ` (${projectedForecast.distanceNm.toFixed(1)} nm)` : ""}`
                  : `Using ${projectedForecast.source}. Import GRIB after loading a route for projected-route weather.`}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className={mutedClass}>Wind</div>
                  <div className="font-black">{windLabel(projectedForecast.row)}</div>
                </div>
                <div>
                  <div className={mutedClass}>Gust</div>
                  <div className="font-black">{formatNumber(projectedForecast.row?.gustKt, 1, " kt")}</div>
                </div>
                <div>
                  <div className={mutedClass}>Waves</div>
                  <div className="font-black">{formatNumber(projectedForecast.row?.seasFt, 1, " ft")}</div>
                </div>
                <div>
                  <div className={mutedClass}>Pressure</div>
                  <div className="font-black">{formatNumber(projectedForecast.row?.pressureHpa, 1, " hPa")}</div>
                </div>
              </div>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Projected Vessel</div>
              {projection ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-black">
                    {formatLatLon(projection.lat, true)} / {formatLatLon(projection.lon, false)}
                  </div>
                  <div className={mutedClass}>Planning position only - {projection.positionSource}</div>
                  <div>Route leg: <span className="font-bold">{projection.legIndex > 0 ? `${projection.legIndex}-${projection.legIndex + 1}` : "Stationary"}</span></div>
                  <div>Next waypoint: <span className="font-bold">{projection.legIndex > 0 ? `${projection.nextWaypoint.id} ${projection.nextWaypoint.name}` : "Hold position"}</span></div>
                  <div>DTG next: <span className="font-bold">{formatNumber(projection.distanceToNextNm, 1, " nm")}</span></div>
                  <div>Route made good: <span className="font-bold">{formatNumber(projection.distanceAlongNm, 1, " nm")}</span></div>
                  <div>Forecast lead: <span className="font-bold">{formatDurationHours(projection.forecastLeadHours)}</span></div>
                  <div>Planning speed: <span className="font-bold">{formatNumber(planningSpeedKt, 1, " kt")}</span></div>
                  <div>ETA remaining: <span className="font-bold">{formatDurationHours(projection.etaHours)}</span></div>
                </div>
              ) : (
                <p className={`mt-3 text-sm ${mutedClass}`}>
                  {!showProjectedPosition
                    ? "Projected position is switched off."
                    : projectionOriginMode === "manual" && (!manualDeparturePosition || !departureTime)
                      ? "Enter a manual departure position and departure time to show the projected vessel."
                      : "Load a route, load a GRIB timeline, and set planning speed to show the projected vessel."}
                </p>
              )}
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Route Leg</div>
              {selectedRouteLeg ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-black" style={{ color: selectedRouteLeg.color }}>
                    {selectedRouteLeg.legLabel} - {selectedRouteLeg.level}
                  </div>
                  <div className={mutedClass}>
                    {selectedRouteLeg.fromName} to {selectedRouteLeg.toName}
                  </div>
                  <div>Sample: <span className="font-bold">{selectedRouteLeg.sourcePoint}</span></div>
                  <div>Valid: <span className="font-bold">{selectedRouteLeg.row?.valid || selectedTime?.valid || "--"}</span></div>
                  <div>WX Time: <span className="font-bold">{selectedRouteLeg.weatherTimeLabel}</span></div>
                  <div>Wind: <span className="font-bold">{windLabel(selectedRouteLeg.row)}</span></div>
                  <div>Gust: <span className="font-bold">{formatNumber(selectedRouteLeg.row?.gustKt, 1, " kt")}</span></div>
                  <div>Seas: <span className="font-bold">{formatNumber(selectedRouteLeg.row?.seasFt, 1, " ft")}</span></div>
                  {selectedRouteLeg.seasSourcePoint ? (
                    <div>Seas source: <span className="font-bold">{selectedRouteLeg.seasSourcePoint}</span></div>
                  ) : null}
                  <div>Swell: <span className="font-bold">{formatNumber(selectedRouteLeg.row?.swellFt, 1, " ft")} / {formatNumber(selectedRouteLeg.row?.swellPeriod, 1, " sec")}</span></div>
                  <div>Bearing: <span className="font-bold">{formatDirection(selectedRouteLeg.bearingDeg)}</span></div>
                  <div>ETA WPT: <span className="font-bold">{selectedRouteLeg.etaLabel}</span></div>
                  <div>Match: <span className="font-bold">{selectedRouteLeg.etaMatched ? "ETA matched" : "Selected time"}</span></div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {selectedRouteLeg.risks.length ? (
                      selectedRouteLeg.risks.map((risk) => (
                        <span
                          key={`${selectedRouteLeg.legLabel}-detail-${risk.label}`}
                          className="border px-1.5 py-0.5 text-[0.62rem] font-black"
                          style={{
                            borderColor: risk.level === "HIGH" ? "#ef4444" : risk.level === "CAUTION" ? "#f59e0b" : "#22d3ee",
                            color: risk.level === "HIGH" ? "#ef4444" : risk.level === "CAUTION" ? "#f59e0b" : "#0891b2",
                          }}
                        >
                          {risk.label}
                        </span>
                      ))
                    ) : (
                      <span className={`text-xs font-bold ${mutedClass}`}>No risk flags</span>
                    )}
                  </div>
                </div>
              ) : selectedPoint ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-black">{selectedPoint.label}</div>
                  <div className={mutedClass}>
                    {formatLatLon(selectedPoint.lat, true)} / {formatLatLon(selectedPoint.lon, false)}
                  </div>
                  <div>Valid: <span className="font-bold">{selectedPoint.row.valid || selectedTime?.valid || "--"}</span></div>
                  <div>Wind: <span className="font-bold">{windLabel(selectedPoint.row)}</span></div>
                  <div>Gust: <span className="font-bold">{formatNumber(selectedPoint.row.gustKt, 1, " kt")}</span></div>
                  <div>Waves: <span className="font-bold">{formatNumber(selectedPoint.row.seasFt, 1, " ft")}</span></div>
                  <div>Swell: <span className="font-bold">{formatNumber(selectedPoint.row.swellFt, 1, " ft")} / {formatNumber(selectedPoint.row.swellPeriod, 1, " sec")}</span></div>
                  <div>MSLP: <span className="font-bold">{formatNumber(selectedPoint.row.pressureHpa, 1, " hPa")}</span></div>
                </div>
              ) : (
                <p className={`mt-3 text-sm ${mutedClass}`}>Click a colored route leg to inspect its forecast.</p>
              )}
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Operational Note</div>
              <p className={`mt-3 text-sm ${mutedClass}`}>
                NavDash shows what the imported model indicates at the selected time. It does not recommend a route or course.
              </p>
            </div>
          </aside>
        </section>

        <section className={panelClass}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={!timeline.length}
                onClick={() => setSelectedIndex((current) => Math.max(0, current - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className={isPlaying ? activeButtonClass : buttonClass}
                disabled={timeline.length <= 1}
                onClick={() => setIsPlaying((value) => !value)}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!timeline.length}
                onClick={() => setSelectedIndex((current) => Math.min(timeline.length - 1, current + 1))}
              >
                Next
              </button>
            </div>

            <input
              className="min-w-0 flex-1 accent-[#c9a227]"
              type="range"
              min={0}
              max={Math.max(0, timeline.length - 1)}
              value={selectedIndex}
              disabled={!timeline.length}
              onChange={(event) => {
                setIsPlaying(false);
                setSelectedIndex(Number(event.target.value));
              }}
            />

            <div className="min-w-[14rem] text-sm font-black">
              {selectedTime ? `${selectedTime.label} - ${selectedTime.valid}` : "No forecast timeline loaded"}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
