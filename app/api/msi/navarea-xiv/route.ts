import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCE_URL = "https://www.maritimenz.govt.nz/navigational-warnings/";

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, "-")
    .replace(/&mdash;|&#8212;/gi, "-")
    .replace(/&deg;|&#176;/gi, "°")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseWarnings(text: string) {
  const matches = Array.from(
    text.matchAll(/NAVAREA XIV WARNING\s+(\d+\/\d{2})\s*([\s\S]*?)(?=NAVAREA XIV WARNING\s+\d+\/\d{2}|NZ COASTAL WARNING|$)/gi)
  );

  return matches
    .map((match) => {
      const number = match[1];
      const body = `NAVAREA XIV WARNING ${number}\n${match[2]}`
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { number, body };
    })
    .filter((warning, index, list) =>
      list.findIndex((candidate) => candidate.number === warning.number) === index
    );
}

export async function GET() {
  try {
    const response = await fetch(SOURCE_URL, {
      cache: "no-store",
      headers: {
        "User-Agent": "NavDash/1.3 MSI supplemental display",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, source: SOURCE_URL, error: `Source returned HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const html = await response.text();
    const text = htmlToText(html);
    const warnings = parseWarnings(text);

    return NextResponse.json({
      ok: true,
      source: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE_URL,
        error: error instanceof Error ? error.message : "Unable to retrieve NAVAREA XIV warnings",
      },
      { status: 502 }
    );
  }
}
