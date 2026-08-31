import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message" || !Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY is not configured on the NavDash server." },
        { status: 503 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const contextRaw = form.get("context");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No PDF was uploaded." }, { status: 400 });
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ ok: false, error: "AMI weather brief accepts PDF files only." }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "PDF exceeds the 20 MB NavDash upload limit." }, { status: 413 });
    }

    let context: any = {};
    if (typeof contextRaw === "string" && contextRaw.trim()) {
      try {
        context = JSON.parse(contextRaw);
      } catch {
        context = {};
      }
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;
    const model = process.env.OPENAI_WEATHER_MODEL || "gpt-5.6-terra";

    const prompt = `You are the AI weather-brief assistant inside NavDash, a professional maritime bridge support application.

Analyze the attached AMI route-weather PDF for bridge use. Treat the PDF as the primary source. NavDash vessel/weather context below is supplemental and may be stale or unavailable. Do not invent values that are not present. If the report and NavDash context conflict, explicitly state the conflict and defer to the report for what the report actually says.

NAVDASH CONTEXT:
${JSON.stringify(context, null, 2)}

Return a concise operational brief in plain text using exactly these headings:
AMI ROUTE FORECAST SUMMARY
VALID / ROUTE
WIND
SEAS
WORST PERIOD
TROPICAL / SIGNIFICANT SYSTEMS
ROUTING IMPACT
BRIDGE TAKEAWAY
VERIFY IN SOURCE REPORT

Rules:
- Winds in knots.
- Wave/seas heights in feet. Convert from meters if necessary and note that a conversion was made.
- Preserve forecast timing and time zones exactly as stated in the report. If time zone is unclear, say so.
- Identify the period/location of strongest winds and highest seas when available.
- Mention tropical systems, fronts, lows, warnings, gale/storm conditions, or route hazards that materially affect the vessel.
- Use current position/COG/SOG only to explain likely encounter timing or relative operational impact when the supplied context is sufficient.
- Never present an AI routing suggestion as an order. Say whether the report appears to support maintaining route, closer monitoring, or review by the bridge team.
- Keep it suitable for a morning meeting: concise, specific, and operational.
- End VERIFY IN SOURCE REPORT with 2-5 items that the bridge team should confirm directly in the PDF before acting.`;

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: file.name,
                file_data: fileData,
              },
              {
                type: "input_text",
                text: prompt,
              },
            ],
          },
        ],
        max_output_tokens: 1800,
      }),
      cache: "no-store",
    });

    const payload = await openAiResponse.json();

    if (!openAiResponse.ok) {
      const message = payload?.error?.message || `OpenAI request failed with ${openAiResponse.status}.`;
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const summary = extractOutputText(payload);
    if (!summary) {
      return NextResponse.json({ ok: false, error: "OpenAI returned no weather brief text." }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      summary,
      model: payload?.model || model,
      generatedAt: new Date().toISOString(),
      sourceName: file.name,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI weather brief failed." },
      { status: 500 },
    );
  }
}
