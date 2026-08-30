import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCE_BASE = "https://msi.nga.mil/api/publications/broadcast-warn";

function normalizeYear(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length === 4 ? text.slice(-2) : text;
}

function normalizeArea(area: string) {
  if (area === "XII" || area === "IV") return `NAVAREA ${area}`;
  return area;
}

function extractWarnings(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];

  const record = data as Record<string, unknown>;
  const known = [record.broadcast_warn, record.broadcastWarn, record.broadcastWarnings, record.warnings, record.results, record.data];
  for (const value of known) {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }

  return [];
}

export async function GET(request: NextRequest) {
  try {
    const area = (request.nextUrl.searchParams.get("area") || "XII").trim().toUpperCase();
    const ngaArea = normalizeArea(area);
    const sourceUrl = `${SOURCE_BASE}?output=json&status=active&navArea=${encodeURIComponent(ngaArea)}`;

    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 NavDash/1.3 MSI supplemental display",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, source: sourceUrl, area, error: `NGA returned HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawWarnings = extractWarnings(data);

    const warnings = rawWarnings
      .map((warning) => {
        const navArea = String(warning.navArea ?? warning.navarea ?? ngaArea).trim() || ngaArea;
        const number = String(warning.msgNumber ?? warning.messageNumber ?? warning.number ?? "").trim();
        const year = normalizeYear(warning.msgYear ?? warning.messageYear ?? warning.year);
        const body = String(warning.text ?? warning.message ?? warning.warningText ?? warning.body ?? "").trim();
        return {
          id: `${navArea}-${year}-${number || body.slice(0, 24)}`,
          area: navArea,
          number: number && year ? `${number}/${year}` : number || "UNNUMBERED",
          body,
          issueDate: String(warning.issueDate ?? warning.issue_date ?? warning.date ?? "").trim(),
          authority: String(warning.authority ?? "NGA").trim() || "NGA",
          subregion: String(warning.subregion ?? warning.subRegion ?? "").trim(),
        };
      })
      .filter((warning) => warning.body.length > 0);

    return NextResponse.json({
      ok: true,
      source: sourceUrl,
      area,
      fetchedAt: new Date().toISOString(),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE_BASE,
        error: error instanceof Error ? error.message : "Unable to retrieve NGA warnings",
      },
      { status: 502 }
    );
  }
}
