import { getR2Object } from "../../../../lib/r2Storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { photo: string } }) {
  // Only these eight originals are public; never accept an arbitrary bucket key.
  if (!/^0[1-8]\.jpg$/.test(params.photo)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const object = await getR2Object(`wardlab/homepage/${params.photo}`);
    if (!object.ok) {
      return new Response("Photo unavailable", {
        status: object.status === 404 ? 404 : 502,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
        ...(object.headers.get("etag") ? { ETag: object.headers.get("etag")! } : {}),
      },
    });
  } catch {
    return new Response("Photo unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
