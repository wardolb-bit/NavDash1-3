import { createHash, createHmac } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICE = "s3";
const REGION = "auto";

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodePath(path: string) {
  return path.split("/").map(part => encodeURIComponent(part)).join("/");
}

async function signedR2Request(method: "PUT" | "GET" | "DELETE", key: string, body = "") {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing one or more R2 environment variables.");
  }

  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.host;
  const basePath = endpointUrl.pathname.replace(/\/$/, "");
  const canonicalUri = `${basePath}/${encodePath(bucket)}/${encodePath(key)}` || "/";
  const now = new Date();
  const timestamp = amzDate(now);
  const dateStamp = timestamp.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(new URL(canonicalUri, `${endpointUrl.protocol}//${host}`).toString(), {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
    },
    body: method === "PUT" ? body : undefined,
    cache: "no-store",
  });
}

export async function GET() {
  const key = "health/navdash-r2-test.json";
  const marker = JSON.stringify({ service: "NavDash", purpose: "R2 health check", timestamp: new Date().toISOString() });

  try {
    const put = await signedR2Request("PUT", key, marker);
    if (!put.ok) throw new Error(`R2 write failed: ${put.status} ${await put.text()}`);

    const get = await signedR2Request("GET", key);
    const returned = await get.text();
    if (!get.ok) throw new Error(`R2 read failed: ${get.status} ${returned}`);
    if (returned !== marker) throw new Error("R2 read-back did not match the object that was written.");

    const del = await signedR2Request("DELETE", key);
    if (!del.ok) throw new Error(`R2 cleanup failed: ${del.status} ${await del.text()}`);

    return NextResponse.json({ ok: true, bucket: process.env.R2_BUCKET_NAME, write: true, read: true, cleanup: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "R2 health check failed." }, { status: 500 });
  }
}
