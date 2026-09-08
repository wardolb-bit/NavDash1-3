import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getR2Object, putR2Object } from "../../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOAA_URL = "https://charts.noaa.gov/ENCs/HI_ENCs.zip";
const OBJECT_KEY = "noaa/enc/state/HI/HI_ENCs.zip";
const CATALOG_KEY = "noaa/catalog.json";

type ChartEntry = {
  id: string;
  name: string;
  region: string;
  format: string;
  source: string;
  sourceUrl: string;
  objectKey: string;
  bytes: number;
  sha256: string;
  cachedAt: string;
  sourceLastModified: string | null;
};

async function readCatalog(): Promise<{ charts: ChartEntry[] }> {
  const response = await getR2Object(CATALOG_KEY);
  if (response.status === 404) return { charts: [] };
  if (!response.ok) throw new Error(`R2 catalog read failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function GET() {
  try {
    const source = await fetch(NOAA_URL, { cache: "no-store" });
    if (!source.ok) throw new Error(`NOAA download failed: ${source.status} ${source.statusText}`);

    const bytes = new Uint8Array(await source.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    await putR2Object(OBJECT_KEY, bytes, "application/zip");

    const catalog = await readCatalog();
    const entry: ChartEntry = {
      id: "NOAA-ENC-HI",
      name: "NOAA ENC Hawaii State Package",
      region: "Hawaii",
      format: "S-57 ENC ZIP",
      source: "NOAA Office of Coast Survey",
      sourceUrl: NOAA_URL,
      objectKey: OBJECT_KEY,
      bytes: bytes.byteLength,
      sha256: digest,
      cachedAt: new Date().toISOString(),
      sourceLastModified: source.headers.get("last-modified"),
    };

    const charts = catalog.charts.filter(chart => chart.id !== entry.id);
    charts.push(entry);
    await putR2Object(CATALOG_KEY, JSON.stringify({ charts }, null, 2), "application/json");

    return NextResponse.json({ ok: true, chart: entry });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "NOAA chart sync failed." }, { status: 500 });
  }
}
