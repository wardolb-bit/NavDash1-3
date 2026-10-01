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
  note?: string;
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

function waypointIdPattern(number: number) {
  return new RegExp(`^(?:WP|WPT)0*${number}\\b\\s*`, "i");
}

function parsePartA(text: string) {
  const part = section(text, /Passage Plan, part A:[\s\S]*?Navigational & Scheduling information/i, /Passage Plan, part B:/i);
  const map = new Map<number, ParsedWaypoint>();

  for (const block of numberedBlocks(part)) {
    if (block.number > 200) continue;
    const lines = block.lines.map(clean).filter(Boolean);
    const body = lines.join("\n");
    const latRaw = body.match(/\d{1,2}°\s*\d+(?:\.\d+)?['’]?\s*[NS]/i)?.[0];
    const lonRaw = body.match(/\d{1,3}°\s*\d+(?:\.\d+)?['’]?\s*[EW]/i)?.[0];
    if (!latRaw || !lonRaw) continue;

    const idPattern = waypointIdPattern(block.number);
    const waypointLine = lines.find(line => idPattern.test(line));
    const name = clean(waypointLine?.replace(idPattern, "")) || `Waypoint ${block.number}`;
    const course = body.match(/(\d+(?:\.\d+)?)°\s*(?:RL|GC)/i);
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
    const lines = block.lines.map(clean).filter(Boolean);
    const body = lines.join("\n");
    const radius = body.match(/(\d+(?:\.\d+)?)\s*NM\s+\d+(?:\.\d+)?°\/min/i);
    if (radius) wp.turnRadiusNm = Number(radius[1]);

    const idPattern = waypointIdPattern(block.number);
    const waypointLineIndex = lines.findIndex(line => idPattern.test(line));
    if (waypointLineIndex < 0) continue;

    let waypointPayload = clean(lines[waypointLineIndex].replace(idPattern, ""));
    if (wp.name && !/^Waypoint \d+$/i.test(wp.name) && waypointPayload.toLowerCase().startsWith(wp.name.toLowerCase())) {
      waypointPayload = clean(waypointPayload.slice(wp.name.length));
    }

    const referenceNames: string[] = [];
    const inlineNumericIndex = waypointPayload.search(/\d+(?:\.\d+)?\s*°/);
    const firstReferenceName = clean(inlineNumericIndex >= 0 ? waypointPayload.slice(0, inlineNumericIndex) : waypointPayload);
    if (firstReferenceName) referenceNames.push(firstReferenceName);

    let numericStartLine = waypointLineIndex + 1;
    if (inlineNumericIndex < 0) {
      for (let index = waypointLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/\d+(?:\.\d+)?\s*°/.test(line) || /^\d+(?:\.\d+)?\s*NM\b/i.test(line) || /^(?:Coastal|Ocean|Pilotage(?:\/fairway\/channel)?|fairway|channel)$/i.test(line)) {
          numericStartLine = index;
          break;
        }
        if (/^(?:Lt|Light)$/i.test(line) && referenceNames.length) referenceNames[referenceNames.length - 1] = `${referenceNames[referenceNames.length - 1]} ${line}`;
        else referenceNames.push(line);
        numericStartLine = index + 1;
      }
    }

    if (!referenceNames.length) continue;

    const numericText = [
      inlineNumericIndex >= 0 ? waypointPayload.slice(inlineNumericIndex) : "",
      ...lines.slice(numericStartLine),
    ].filter(Boolean).join("\n");
    const bearings = Array.from(numericText.matchAll(/(\d+(?:\.\d+)?)\s*°/g)).map(match => Number(match[1]));
    const distances = Array.from(numericText.matchAll(/(\d+(?:\.\d+)?)\s*NM\b/gi)).map(match => Number(match[1]));

    if (bearings.length < referenceNames.length || distances.length < referenceNames.length) continue;
    wp.references = referenceNames.map((name, index) => `${name} · ${bearings[index].toFixed(1)}° · ${distances[index].toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} NM`);
  }
}

function parsePartD(text: string, waypoints: Map<number, ParsedWaypoint>) {
  const part = section(text, /Passage Plan, part D:[\s\S]*?Leg safety parameters\/Remarks/i, /Passage Plan, part E:/i);

  for (const block of numberedBlocks(part)) {
    const wp = waypoints.get(block.number);
    if (!wp) continue;
    const lines = block.lines.map(clean).filter(Boolean);
    const body = lines.join("\n");
    const xtd = body.match(/(\d+(?:\.\d+)?)\s*NM\s+(\d+(?:\.\d+)?)\s*NM/i);
    if (xtd) {
      wp.xtdStbdNm = Number(xtd[1]);
      wp.xtdPortNm = Number(xtd[2]);
    }

    const note = lines.filter(line =>
      !/^(?:WP|WPT)\d+\b/i.test(line)
      && !/^(?:Coastal|Ocean|Pilotage(?:\/fairway\/channel)?|fairway|channel)$/i.test(line)
      && !/^(?:\d+(?:\.\d+)?\s*(?:NM|min)\s*)+$/i.test(line)
    ).join(" ").trim();
    if (note) wp.note = note;
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
  parsePartD(text, waypoints);

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

    if (!passage.routeName && passage.waypoints.length < 2) throw new Error("This PDF does not look like a NavStation passage plan.");
    return NextResponse.json({ ok: true, passage });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "NavStation passage plan could not be read." }, { status: 422 });
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
