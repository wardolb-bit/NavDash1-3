import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type DeckLogEntry = {
  id: string;
  timeUtc: string;
  timeLocal: string;
  category: string;
  text: string;
  author: string;
  createdAt: string;
};

function deckLogFilePath() {
  return path.join(process.env.NAVDASH_DATA_DIR || path.join(process.cwd(), "data"), "deck-log.json");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function deckLogJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...(init?.headers || {}),
    },
  });
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2000) : fallback;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function formatHostLocalTime(date: Date) {
  return [
    `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`,
    `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`,
    "Local",
  ].join(" ");
}

function parseEntryTime(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeEntry(entry: any): DeckLogEntry | null {
  const text = cleanText(entry?.text);
  if (!text) return null;

  const createdAt = cleanText(entry?.createdAt, new Date().toISOString());
  const timeUtc = cleanText(entry?.timeUtc, createdAt);
  const localFromUtc = formatHostLocalTime(new Date(timeUtc));

  return {
    id: cleanText(entry?.id, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    timeUtc,
    timeLocal: cleanText(entry?.timeLocal, localFromUtc),
    category: cleanText(entry?.category, "Deck"),
    text,
    author: cleanText(entry?.author, "iPad"),
    createdAt,
  };
}

async function readEntries(): Promise<DeckLogEntry[]> {
  try {
    const raw = await fs.readFile(deckLogFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.entries)) return [];

    return parsed.entries
      .map(normalizeEntry)
      .filter((entry: DeckLogEntry | null): entry is DeckLogEntry => Boolean(entry));
  } catch {
    return [];
  }
}

async function writeEntries(entries: DeckLogEntry[]) {
  const filePath = deckLogFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ entries }, null, 2), "utf8");
}

export async function GET() {
  const entries = await readEntries();
  return deckLogJson({ entries });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const now = new Date();
    const entryTime = parseEntryTime(payload?.timeUtc || payload?.createdAt, now);
    const entryUtc = entryTime.toISOString();
    const entry = normalizeEntry({
      ...payload,
      timeUtc: entryUtc,
      timeLocal: formatHostLocalTime(entryTime),
      createdAt: entryUtc,
    });

    if (!entry) {
      return deckLogJson({ ok: false, error: "Deck log entry text is required." }, { status: 400 });
    }

    const entries = await readEntries();
    const existing = entries.find((savedEntry) => savedEntry.id === entry.id);
    if (existing) {
      return deckLogJson({ ok: true, entry: existing, entries });
    }

    const updated = [entry, ...entries].slice(0, 1000);
    await writeEntries(updated);

    return deckLogJson({ ok: true, entry, entries: updated });
  } catch {
    return deckLogJson({ ok: false, error: "Could not save deck log entry." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return deckLogJson({ ok: false, error: "Entry id is required." }, { status: 400 });
  }

  const entries = await readEntries();
  const updated = entries.filter((entry: DeckLogEntry) => entry.id !== id);
  await writeEntries(updated);

  return deckLogJson({ ok: true, entries: updated });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
