import { NextRequest, NextResponse } from "next/server";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
    const refs: string[] = [];
    for (const line of block.lines) {
      if (/light/i.test(line) && !/^WP/i.test(line)) refs.push(clean(line));
    }
    if (refs.length) wp.references = Array.from(new Set(refs));
  }
}

function looksLikeRemark(value: string) {
  const text = clean(value);
  if (!text || text.split(/\s+/).length < 4) return false;
  return !/(?:Passage Plan|Leg safety parameters|Remarks\/Notes|Navigational warnings|Date prepared|Date approved|Last revision|WP No|WP Name|Passage type|XTD|CPA|TCPA|Anti-grounding|Look ahead|MB480)/i.test(text);
}

function mergeRemark(wp: ParsedWaypoint, value: string) {
  const remark = clean(value);
  if (!looksLikeRemark(remark)) return;
  if (!wp.remarks || !looksLikeRemark(wp.remarks)) {
    wp.remarks = remark;
    return;
  }
  if (!wp.remarks.includes(remark) && !remark.includes(wp.remarks)) wp.remarks = clean(`${wp.remarks} ${remark}`);
}

function parsePartD(text: string, waypoints: Map<number, ParsedWaypoint>) {
  const part = section(text, /Passage Plan, part D:[\s\S]*?Leg safety parameters\/Remarks/i, /Passage Plan, part E:/i);
  for (const block of numberedBlocks(part)) {
    const wp = waypoints.get(block.number);
    if (!wp) continue;
    const body = block.lines.filter(Boolean).join("\n");
    const xtd = body.match(/(\d+(?:\.\d+)?)\s*NM\s+(\d+(?:\.\d+)?)\s*NM/i);
    if (xtd) {
      wp.xtdStbdNm = Number(xtd[1]);
      wp.xtdPortNm = Number(xtd[2]);
    }
  }
}

type PositionedText = { str: string; x: number; y: number };

async function parsePartDByPosition(data: Uint8Array, waypoints: Map<number, ParsedWaypoint>) {
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PositionedText[] = (content.items as any[])
        .filter(item => typeof item?.str === "string" && Array.isArray(item?.transform))
        .map(item => ({ str: clean(item.str), x: Number(item.transform[4]), y: Number(item.transform[5]) }))
        .filter(item => item.str && Number.isFinite(item.x) && Number.isFinite(item.y));

      const pageText = clean(items.map(item => item.str).join(" "));
      if (!/Passage Plan, part D:/i.test(pageText) || !/Leg safety parameters\/Remarks/i.test(pageText)) continue;

      const remarkHeader = items.find(item => /Remarks\/Notes:/i.test(item.str));
      if (!remarkHeader) continue;
      const remarkX = remarkHeader.x;

      const entries = Array.from(waypoints.values()).sort((a, b) => a.number - b.number);
      const anchors: Array<{ wp: ParsedWaypoint; y: number }> = [];

      for (const wp of entries) {
        const exact = items.find(item => clean(item.str).toLowerCase() === clean(wp.name).toLowerCase() && item.x < remarkX);
        const contains = exact || items.find(item => item.x < remarkX && clean(item.str).toLowerCase().includes(clean(wp.name).toLowerCase()));
        if (contains) anchors.push({ wp, y: contains.y });
      }

      anchors.sort((a, b) => b.y - a.y);
      if (!anchors.length) continue;

      for (let i = 0; i < anchors.length; i += 1) {
        const current = anchors[i];
        const prevY = i === 0 ? current.y + 16 : (anchors[i - 1].y + current.y) / 2;
        const nextY = i === anchors.length - 1 ? current.y - 16 : (current.y + anchors[i + 1].y) / 2;

        const remarkItems = items
          .filter(item => item.x >= remarkX - 3 && item.y <= prevY && item.y > nextY)
          .sort((a, b) => {
            if (Math.abs(a.y - b.y) > 1.5) return b.y - a.y;
            return a.x - b.x;
          });

        const lines: Array<{ y: number; text: string }> = [];
        for (const item of remarkItems) {
          let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= 1.5);
          if (!line) {
            line = { y: item.y, text: "" };
            lines.push(line);
          }
          line.text = clean(`${line.text} ${item.str}`);
        }
        lines.sort((a, b) => b.y - a.y);
        const remark = clean(lines.map(line => line.text).join(" "));
        mergeRemark(current.wp, remark);
      }

      // XTD values are easier to recover from geometry than from flattened column-order text.
      for (const { wp, y } of anchors) {
        const rowItems = items
          .filter(item => item.x < remarkX && Math.abs(item.y - y) <= 5)
          .sort((a, b) => a.x - b.x);
        const rowText = clean(rowItems.map(item => item.str).join(" "));
        const xtd = Array.from(rowText.matchAll(/(\d+(?:\.\d+)?)\s*NM/gi)).map(match => Number(match[1])).filter(Number.isFinite);
        if (xtd.length >= 2) {
          wp.xtdStbdNm = xtd[0];
          wp.xtdPortNm = xtd[1];
        }
      }

      break;
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
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
  const departurePort = portMatches[0] || "";
  const destinationPort = portMatches[1] || "";

  const waypoints = parsePartA(text);
  parsePartC(text, waypoints);
  parsePartD(text, waypoints);

  return {
    sourceFile: fileName,
    voyageNumber,
    routeName,
    departurePort,
    destinationPort,
    etdLocal,
    etaLocal,
    totalDistanceNm: Number.isFinite(totalDistanceNm) ? totalDistanceNm : undefined,
    averageSpeedKt: Number.isFinite(averageSpeedKt) ? averageSpeedKt : undefined,
    waypoints,
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

    const data = new Uint8Array(await file.arrayBuffer());
    parser = new PDFParse({ data });
    const extracted = await parser.getText();
    const passage = parsePassagePlan(extracted.text, file.name);
    await parsePartDByPosition(data, passage.waypoints);

    const response = {
      sourceFile: passage.sourceFile,
      voyageNumber: passage.voyageNumber,
      routeName: passage.routeName,
      departurePort: passage.departurePort,
      destinationPort: passage.destinationPort,
      etdLocal: passage.etdLocal,
      etaLocal: passage.etaLocal,
      totalDistanceNm: passage.totalDistanceNm,
      averageSpeedKt: passage.averageSpeedKt,
      waypoints: Array.from(passage.waypoints.values()).sort((a, b) => a.number - b.number),
    };

    if (!response.routeName && response.waypoints.length < 2) throw new Error("This PDF does not look like a NavStation passage plan.");
    return NextResponse.json({ ok: true, passage: response });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "NavStation passage plan could not be read." }, { status: 422 });
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
