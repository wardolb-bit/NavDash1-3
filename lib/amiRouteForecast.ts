export type AmiForecastPoint = {
  validAt: string;
  lat: number;
  lon: number;
  windDirectionDeg: number;
  windSpeedKt: number;
  wind50mKt: number;
  gustKt: number;
  significantWaveM: number;
  significantWavePeriodSec: number;
  maximumWaveM: number;
  windWaveDirectionDeg: number;
  windWaveHeightM: number;
  windWavePeriodSec: number;
  swellDirectionDeg: number;
  swellHeightM: number;
  swellPeriodSec: number;
  conditions: string;
  airTemperatureC: number;
  seaTemperatureC: number;
  cloudOctas: number;
  cloudBaseM: number;
  visibilityKm: number;
  confidence: string;
};

export type AmiCyclonePoint = {
  validAt: string;
  lat: number;
  lon: number;
  maximumWindKt: number;
  radius34KtNm: number;
  radius50KtNm: number | null;
};

export type AmiRouteForecast = {
  version: 1;
  sourceName: string;
  referenceId: string;
  issuedAt: string;
  vessel: string;
  routeDescription: string;
  synopticDiscussion: string;
  warnings: string;
  forecastPoints: AmiForecastPoint[];
  cyclone: {
    name: string;
    summary: string;
    track: AmiCyclonePoint[];
  } | null;
  skippedLocationRows: number;
};

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseCoordinate(value: string) {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d+)?)([NSEW])$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  return ["S", "W"].includes(match[2].toUpperCase()) ? -magnitude : magnitude;
}

function section(text: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(text);
  if (!startMatch) return "";
  const remainder = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(remainder);
  return (endMatch ? remainder.slice(0, endMatch.index) : remainder).replace(/\s+/g, " ").trim();
}

function isoUtc(year: number, month: number, day: number, hour: number) {
  return new Date(Date.UTC(year, month, day, hour, 0, 0)).toISOString();
}

export function parseAmiRouteForecast(text: string, sourceName: string): AmiRouteForecast {
  const normalized = text.replace(/\r/g, "").replace(/\u00a0/g, " ");
  const issued = normalized.match(/Issued\s+[A-Za-z]{3}\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s+GMT/i);
  if (!issued || MONTHS[issued[2]] === undefined) throw new Error("AMI issue date was not found in the PDF.");
  const issuedAt = new Date(Date.UTC(Number(issued[3]), MONTHS[issued[2]], Number(issued[1]), Number(issued[4]), Number(issued[5]))).toISOString();

  const title = normalized.match(/MARINE WEATHER FORECAST FOR:\s*\n?([^\n]+)\n/i);
  const titleParts = (title?.[1] || "").split(",").map((part) => part.trim());
  const referenceId = normalized.match(/Ref Id\.\s*([^\s]+)/i)?.[1] || "";
  const tableStart = normalized.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+([A-Za-z]{3})\s+(\d{2})\s+\d{2}:\d{2}\s+Expected/i);
  const startMonth = tableStart && MONTHS[tableStart[1]] !== undefined ? MONTHS[tableStart[1]] : MONTHS[issued[2]];
  let year = tableStart ? 2000 + Number(tableStart[2]) : Number(issued[3]);
  let month = startMonth;
  let previousDay = 0;
  let skippedLocationRows = 0;
  const forecastPoints: AmiForecastPoint[] = [];

  const rowPattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2})\s*\/\s*(\d{2})\s+(\S+)\s+(\d{1,3})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d{1,3})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d{1,3})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.+?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(High|Mod(?:erate)?|Low)\s*$/i;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    const row = line.match(rowPattern);
    if (!row) continue;
    const day = Number(row[1]);
    const hour = Number(row[2]);
    if (previousDay && day < previousDay) {
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
    previousDay = day;
    const coordinate = row[3].match(/^(\d{1,3}(?:\.\d+)?[NS])\/(\d{1,3}(?:\.\d+)?[EW])$/i);
    if (!coordinate) { skippedLocationRows += 1; continue; }
    const lat = parseCoordinate(coordinate[1]);
    const lon = parseCoordinate(coordinate[2]);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    forecastPoints.push({
      validAt: isoUtc(year, month, day, hour), lat, lon,
      windDirectionDeg: Number(row[4]), windSpeedKt: Number(row[5]), wind50mKt: Number(row[6]), gustKt: Number(row[7]),
      significantWaveM: Number(row[8]), significantWavePeriodSec: Number(row[9]), maximumWaveM: Number(row[10]),
      windWaveDirectionDeg: Number(row[11]), windWaveHeightM: Number(row[12]), windWavePeriodSec: Number(row[13]),
      swellDirectionDeg: Number(row[14]), swellHeightM: Number(row[15]), swellPeriodSec: Number(row[16]),
      conditions: row[17].trim(), airTemperatureC: Number(row[18]), seaTemperatureC: Number(row[19]),
      cloudOctas: Number(row[20]), cloudBaseM: Number(row[21]), visibilityKm: Number(row[22]), confidence: row[23],
    });
  }

  const cycloneSummary = normalized.match(/(?:\u00ff\u00fe)?(HURRICANE|TROPICAL STORM|TYPHOON|TROPICAL DEPRESSION)\s+([^\n]+)/i);
  const cycloneTrack: AmiCyclonePoint[] = [];
  const cyclonePattern = /^(\d{2})\/(\d{2})Z\s+(\d{1,3}(?:\.\d+)?[NS])\s+(\d{1,3}(?:\.\d+)?[EW])\s+(\d+)\s+KTS\s+(\d+)\s+NM(?:\s+(\d+)\s+NM)?/i;
  month = MONTHS[issued[2]];
  year = Number(issued[3]);
  previousDay = 0;
  for (const rawLine of normalized.split("\n")) {
    const match = rawLine.trim().replace(/\s+/g, " ").match(cyclonePattern);
    if (!match) continue;
    const day = Number(match[1]);
    if (previousDay && day < previousDay) { month += 1; if (month > 11) { month = 0; year += 1; } }
    previousDay = day;
    const lat = parseCoordinate(match[3]);
    const lon = parseCoordinate(match[4]);
    if (lat === null || lon === null) continue;
    cycloneTrack.push({ validAt: isoUtc(year, month, day, Number(match[2])), lat, lon, maximumWindKt: Number(match[5]), radius34KtNm: Number(match[6]), radius50KtNm: match[7] ? Number(match[7]) : null });
  }

  if (!forecastPoints.length) throw new Error("No coordinate-based AMI forecast rows were found. NavDash did not create an overlay.");

  return {
    version: 1, sourceName, referenceId, issuedAt,
    vessel: titleParts[0] || "", routeDescription: titleParts.slice(1).join(", "),
    synopticDiscussion: section(normalized, /SYNOPTIC DISCUSSION[^\n]*\n/i, /WARNINGS VALID|TROPICAL CYCLONE WARNING|WIND AND WAVE FORECAST/i),
    warnings: section(normalized, /WARNINGS VALID[^\n]*\n/i, /TROPICAL CYCLONE WARNING|WIND AND WAVE FORECAST/i),
    forecastPoints,
    cyclone: cycloneSummary && cycloneTrack.length ? { name: cycloneSummary[2].split(",")[0].trim(), summary: `${cycloneSummary[1]} ${cycloneSummary[2]}`.replace(/\s+/g, " ").trim(), track: cycloneTrack } : null,
    skippedLocationRows,
  };
}
