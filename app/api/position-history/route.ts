import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type PositionHistoryEntry = {
  lat: number;
  lon: number;
  timestamp: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  receivedAt?: string;
};

const MAX_AGE_MS = 36 * 60 * 60 * 1000;

function historyFilePath() {
  return path.join(process.env.NAVDASH_DATA_DIR || path.join(process.cwd(), "data"), "position-history.json");
}

function normalizeEntry(entry: any): PositionHistoryEntry | null {
  const lat = Number(entry?.lat);
  const lon = Number(entry?.lon);
  const timestamp = Number(entry?.timestamp);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) return null;

  return {
    lat,
    lon,
    timestamp,
    sog: Number.isFinite(Number(entry?.sog)) ? Number(entry.sog) : null,
    cog: Number.isFinite(Number(entry?.cog)) ? Number(entry.cog) : null,
    heading: Number.isFinite(Number(entry?.heading)) ? Number(entry.heading) : null,
    receivedAt: typeof entry?.receivedAt === "string" ? entry.receivedAt : new Date(timestamp).toISOString(),
  };
}

async function readHistory() {
  try {
    const raw = await fs.readFile(historyFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
    const now = Date.now();

    return rawEntries
      .map(normalizeEntry)
      .filter((entry: PositionHistoryEntry | null): entry is PositionHistoryEntry => Boolean(entry))
      .filter((entry: PositionHistoryEntry) => now - entry.timestamp <= MAX_AGE_MS)
      .sort((a: PositionHistoryEntry, b: PositionHistoryEntry) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export async function GET() {
  const entries = await readHistory();
  return NextResponse.json({
    entries,
    sampleCount: entries.length,
    oldestTimestamp: entries[0]?.timestamp ?? null,
    newestTimestamp: entries[entries.length - 1]?.timestamp ?? null,
  });
}
