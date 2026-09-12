import { NextRequest, NextResponse } from "next/server";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 30 * 1024 * 1024;

type ParsedWaypoint = {
  number: number;
  name: string;
  lat?: number;
  lon?: number;
  courseDeg?: number;
  legDistanceNm?: number;
  plannedSpeedKt?: number;
  etaLocal?: string;
  xtdStbdNm?: number;
  xtdPortNm?: number;
  turnRadiusNm?: number;
  references?: string[];
  remarks?: string;
};

function clean(value: string | undefined | null) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function first(text: string, re: RegExp) {
  const match = text.match(re);
  return clean(match?.[1]);
}

function section(text: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(text);
  if (!startMatch) return "";
  const rest = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

function dmToDecimal(value: string, isLat: boolean) {
  const match = value.match(/(\d{1,3})°\s*(\d+(?:\.\d+)?)['’]?\s*([NSEW])/i);
  if (!match) return undefined;
  const deg = Number(match[1]);
  const min = Number(match[2]);
  let result = deg + min / 60;
  const hemi = match[3].toUpperCase();
  if (hemi === "S" || hemi === "W") result *= -1;
  if (!Number.isFinite(result) || (isLat ? Math.abs(result) > 90 : Math.abs(result) > 180)) return undefined;
  return result;
}

function numberedBlocks(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const blocks: Array<{ number: number; lines: string[] }> = [];
  let current: { number: number; lines: string[] } | null = null;
  for (const line of lines) {
    if (/^\d{1,3}$/.test(line)) {
      const number = Number(line);
      if (number >= 1 && number <= 999) {
        if (current) blocks.push(current);
        current = { number, lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

function parsePartA(text: string) {
  const part = section(text, /Passage Plan, part A:[\s\S]*?Navigational & Scheduling information/i, /Passage Plan, part B:/i);
  const map = new Map<number, ParsedWaypoint>();
  for (const block of numberedBlocks(part)) {
    if (block.number > 200) continue;
    const body = block.lines.filter(Boolean).join("\n");
    const latRaw = body.match(/\d{1,2}°\s*\d+(?:\.\d+)?['’]?\s*[NS]/i)?.[0];
    const lonRaw = body.match(/\d{1,3}°\s*\d+(?:\.\d+)?['’]?\s*[EW]/i)?.[0];
    if (!latRaw || !lonRaw) continue;
    const name = clean(block.lines.find(line => line && !/^(Coastal|Ocean|Pilotage|fairway|channel)$/i.test(line) && !/[°]/.test(line) && !/^(WP|Passage|Position|Course|Steering|DTG|Leg|TTG|Security|Hardening|Nav\.|ER)/i.test(line)) || `Waypoint ${block.number}`);
    const course = body.match(/(\d+(?:\.\d+)?)°\s*RL/i);
    const leg = body.match(/(\d+(?:\.\d+)?)\s*NM\s+(\d+(?:\.\d+)?)\s*kn/i);
    const local = body.match(/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})\s*(?=\n|$)/g);
    map.set(block.number, {
      number: block.number,
      name,
      lat: dmToDecimal(latRaw, true),
      lon: dmToDecimal(lonRaw, false),
      courseDeg: course ? Number(course[1]) : undefined,
      legDistanceNm: leg ? Number(leg[1]) : undefined,
      plannedSpeedKt: leg ? Number(leg[2]) : undefined,
      etaLocal: local?.length ? local[local.length - 1] : undefined,
    });
  }
  return map;
}

function parsePartC(text: string, waypoints: Map<number, ParsedWaypoint>) {
  const part = section(text, /Passage Plan, part C:[\s\S]*?Position references\/Parallel Indexing/i, /Passage Plan, part D:/i);
  for (const block of numberedBlocks(part)) {
    const wp = waypoints.get(block.number);
    if (!wp) continue;
    const body = block.lines.filter(Boolean).join("\n");
    const radius = body.match(/(\d+(?:\.\d+)?)\s*NM\s+\d+(?:\.\d+)?°\/min/i);
    if (radius) wp.turnRadiusNm = Number(radius[1]);
    const refs = block.lines.filter(line => /light/i.test(line) && !/^WP/i.test(line)).map(clean);
    if (refs.length) wp.references = Array.from(new Set(refs));
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripPartDTechnicalText(value: string, names: string[]) {
  let text = value;
  for (const name of names) text = text.replace(new RegExp(escapeRegExp(name), "ig"), " ");
  return clean(text
    .replace(/\b(?:Coastal|Ocean|Pilotage|fairway|channel)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*NM\b/gi, " ")
    .replace(/^\s*\d{1,3}\s+/, " ")
    .replace(/\bPage\s+\d+\b/gi, " "));
}

function isPartDProse(value: string) {
  const text = clean(value);
  if (!text || text.split(/\s+/).length < 4) return false;
  if (!/[a-z]{3}/i.test(text)) return false;
  return !/(?:Passage Plan|Leg safety parameters|Remarks\/Notes|Navigational warnings|traffic density|prevailing weather|local restrictions|Date prepared|Date approved|Last revision|WP No|WP Name|Passage type|XTD|Stbd|Port|CPA|TCPA|Anti-grounding|Look ahead|MB480|Pearl Harbor to Big Island)/i.test(text);
}

function mergeRemark(wp: ParsedWaypoint, value: string) {
  const remark = clean(value);
  if (!isPartDProse(remark)) return;
  if (!wp.remarks) wp.remarks = remark;
  else if (!wp.remarks.includes(remark) && !remark.includes(wp.remarks)) wp.remarks = clean(`${wp.remarks} ${remark}`);
}

function parsePartDNavStation(text: string, waypoints: Map<number, ParsedWaypoint>) {
  const part = section(text, /Passage Plan, part D:[\s\S]*?Leg safety parameters\/Remarks/i, /Passage Plan, part E:/i);
  if (!part) return;

  const lines = part.split(/\r?\n/).map(line => line.trim());
  const entries = Array.from(waypoints.values()).sort((a, b) => a.number - b.number);
  const names = entries.map(wp => wp.name).filter(Boolean);
  const anchors = new Map<number, number>();

  for (const wp of entries) {
    const target = clean(wp.name).toLowerCase();
    const lineIndex = lines.findIndex(line => clean(line).toLowerCase() === target || clean(line).toLowerCase().includes(target));
    if (lineIndex >= 0) anchors.set(wp.number, lineIndex);
  }

  // NavStation Part D uses a fixed waypoint-name / XTD / remarks layout. Recover XTDs
  // from the few lines around each waypoint name instead of trying to parse the whole PDF table.
  for (const wp of entries) {
    const anchor = anchors.get(wp.number);
    if (anchor == null) continue;
    const nearby = lines.slice(Math.max(0, anchor - 2), Math.min(lines.length, anchor + 4)).join(" ");
    const xtd = Array.from(nearby.matchAll(/(\d+(?:\.\d+)?)\s*NM/gi)).map(match => Number(match[1])).filter(Number.isFinite);
    if (xtd.length >= 2) {
      wp.xtdStbdNm = xtd[0];
      wp.xtdPortNm = xtd[1];
    }
  }

  // Remarks can appear before, beside, or after the waypoint name in NavStation's PDF text layer.
  // Keep only prose lines and attach each one to the closest waypoint-name line.
  let previousAssignment: { wp: ParsedWaypoint; lineIndex: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const candidate = stripPartDTechnicalText(lines[i], names);
    const wordCount = candidate.split(/\s+/).filter(Boolean).length;
    const prose = isPartDProse(candidate);
    const continuation = previousAssignment && i - previousAssignment.lineIndex <= 2 && wordCount >= 3 && /[a-z]{3}/i.test(candidate) && !/\bNM\b/i.test(lines[i]);
    if (!prose && !continuation) continue;

    let bestWp: ParsedWaypoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const wp of entries) {
      const anchor = anchors.get(wp.number);
      if (anchor == null) continue;
      const distance = Math.abs(anchor - i);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestWp = wp;
      }
    }
    if (!bestWp || bestDistance > 3) continue;

    mergeRemark(bestWp, candidate);
    previousAssignment = { wp: bestWp, lineIndex: i };
  }
}

function parsePassagePlan(text: string, fileName: string) {
  const voyageNumber = first(text, /Voyage number:\s*([^\n]+?)(?=\s+Route name:)/i) || first(text, /Voyage No\.:\s*([^,\n]+)/i);
  const routeName = first(text, /Route name:\s*([^\n]+)/i) || first(text, /Voyage No\.:\s*[^,]+,\s*([^\)\n]+)/i);
  const totalDistanceNm = Number(first(text, /Total distance:\s*([\d.]+)\s*NM/i));
  const averageSpeedKt = Number(first(text, /Average speed:\s*([\d.]+)\s*kn/i));
  const etdLocal = first(text, /ETD LT:\s*([^\n]+)/i);
  const etaLocal = first(text, /ETA LT:\s*([^\n]+)/i);
  const portMatches = Array.from(text.matchAll(/Port name:\s*([^\n]+?)(?=\s+Country:)/gi)).map(match => clean(match[1]));

  const waypoints = parsePartA(text);
  parsePartC(text, waypoints);
  parsePartDNavStation(text, waypoints);

  return {
    sourceFile: fileName,
    voyageNumber,
    routeName,
    departurePort: portMatches[0] || "",
    destinationPort: portMatches[1] || "",
    etdLocal,
    etaLocal,
    totalDistanceNm: Number.isFinite(totalDistanceNm) ? totalDistanceNm : undefined,
    averageSpeedKt: Number.isFinite(averageSpeedKt) ? averageSpeedKt : undefined,
    waypoints: Array.from(waypoints.values()).sort((a, b) => a.number - b.number),
  };
}

export async function POST(request: NextRequest) {
  let parser: PDFParse | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No NavStation passage-plan PDF was uploaded." }, { status: 400 });
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      return NextResponse.json({ ok: false, error: "NavStation passage-plan import accepts PDF files only." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: "PDF exceeds the 30 MB NavDash upload limit." }, { status: 413 });

    parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    const extracted = await parser.getText();
    const passage = parsePassagePlan(extracted.text, file.name);
    if (!passage.routeName && passage.waypoints.length < 2) throw new Error("This PDF does not look like the supported NavStation passage-plan format.");
    return NextResponse.json({ ok: true, passage });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "NavStation passage plan could not be read." }, { status: 422 });
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
