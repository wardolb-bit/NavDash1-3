import { NextRequest, NextResponse } from "next/server";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { parseAmiRouteForecast } from "../../../lib/amiRouteForecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let parser: PDFParse | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No PDF was uploaded." }, { status: 400 });
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      return NextResponse.json({ ok: false, error: "AMI chart overlay accepts PDF files only." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: "PDF exceeds the 20 MB NavDash upload limit." }, { status: 413 });

    parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    const extracted = await parser.getText();
    const forecast = parseAmiRouteForecast(extracted.text, file.name);
    return NextResponse.json({ ok: true, forecast });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AMI route forecast could not be read." }, { status: 422 });
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
