import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCE_URL = "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A";

function normalizeYear(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length === 4 ? text.slice(-2) : text;
}

export async function GET(request: NextRequest) {
  try {
    const area = (request.nextUrl.searchParams.get("area") || "XII").trim().toUpperCase();
    const response = await fetch(SOURCE_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 NavDash/1.3 MSI supplemental display",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, source: SOURCE_URL, area, error: `NGA returned HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawWarnings = Array.isArray(data) ? data : Array.isArray(data?.broadcast_warn) ? data.broadcast_warn : [];

    const warnings = rawWarnings
      .filter((warning: Record<string, unknown>) => {
        const navArea = String(warning.navArea ?? "").toUpperCase();
        const text = String(warning.text ?? "").toUpperCase();
        return !area || navArea.includes(area) || text.includes(`NAVAREA ${area}`) || text.includes(area);
      })
      .map((warning: Record<string, unknown>) => {
        const navArea = String(warning.navArea ?? area).trim() || area;
        const number = String(warning.msgNumber ?? "").trim();
        const year = normalizeYear(warning.msgYear);
        return {
          id: `${navArea}-${year}-${number}`,
          area: navArea,
          number: number && year ? `${number}/${year}` : number || "UNNUMBERED",
          body: String(warning.text ?? "").trim(),
          issueDate: String(warning.issueDate ?? "").trim(),
          authority: String(warning.authority ?? "NGA").trim() || "NGA",
          subregion: String(warning.subregion ?? "").trim(),
        };
      })
      .filter((warning: { body: string }) => warning.body.length > 0);

    return NextResponse.json({
      ok: true,
      source: SOURCE_URL,
      area,
      fetchedAt: new Date().toISOString(),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE_URL,
        error: error instanceof Error ? error.message : "Unable to retrieve NGA warnings",
      },
      { status: 502 }
    );
  }
}
