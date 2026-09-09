import { createHash, createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getHomepagePhoto(photo: string) {
  const { R2_ENDPOINT: endpoint, R2_BUCKET_NAME: bucket, R2_ACCESS_KEY_ID: accessKey, R2_SECRET_ACCESS_KEY: secret } = process.env;
  if (!endpoint || !bucket || !accessKey || !secret) throw new Error("R2 is not configured");

  // Dashboard uploads sit directly in the bucket. The existing chart helper
  // also includes the endpoint pathname, which can duplicate the bucket prefix.
  const url = new URL(endpoint);
  url.pathname = `/${encodeURIComponent(bucket)}/wardlab/homepage/${photo}`;
  url.search = "";
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
  const payloadHash = hash("");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const canonicalRequest = ["GET", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(["AWS4-HMAC-SHA256", timestamp, scope, hash(canonicalRequest)].join("\n")).digest("hex");
  return fetch(url, {
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
    },
    cache: "no-store",
  });
}

export async function GET(_request: Request, { params }: { params: { photo: string } }) {
  // Only these eight originals are public; never accept an arbitrary bucket key.
  if (!/^0[1-8]\.jpg$/.test(params.photo)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const object = await getHomepagePhoto(params.photo);
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

