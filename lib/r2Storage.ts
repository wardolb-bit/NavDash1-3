import { createHash, createHmac } from "crypto";

const SERVICE = "s3";
const REGION = "auto";

type R2Body = string | Uint8Array | Buffer;

function sha256(value: R2Body) {
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

function config() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing one or more R2 environment variables.");
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

export async function r2Request(
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body: R2Body = "",
  contentType?: string,
) {
  const { endpoint, accessKeyId, secretAccessKey, bucket } = config();
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
      ...(method === "PUT" && contentType ? { "content-type": contentType } : {}),
    },
    body: method === "PUT" ? body : undefined,
    cache: "no-store",
  });
}

export async function putR2Object(key: string, body: R2Body, contentType?: string) {
  const response = await r2Request("PUT", key, body, contentType);
  if (!response.ok) throw new Error(`R2 write failed: ${response.status} ${await response.text()}`);
  return response;
}

export async function getR2Object(key: string) {
  return r2Request("GET", key);
}

export async function deleteR2Object(key: string) {
  const response = await r2Request("DELETE", key);
  if (!response.ok) throw new Error(`R2 delete failed: ${response.status} ${await response.text()}`);
  return response;
}
