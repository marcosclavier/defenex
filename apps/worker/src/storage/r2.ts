import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, hasStorage } from "../env.js";
import { logger } from "../logger.js";

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: env.CLOUDFLARE_BUCKET_S3_ENDPOINT!,
      credentials: {
        accessKeyId: env.CLOUDFLARE_BUCKET_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.CLOUDFLARE_BUCKET_S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

/** Content-addressed key so re-running a scan does not duplicate identical images. */
export function screenshotKey(scanId: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return `screenshots/${scanId}/${hash}.jpg`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string | null> {
  if (!hasStorage) {
    logger.warn({ key }, "object storage not configured; skipping upload");
    return null;
  }
  try {
    await s3().send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  } catch (err) {
    logger.error({ key, err: String(err) }, "upload failed");
    return null;
  }
}

/**
 * Short-lived signed URL. The bucket stays private: report screenshots and PDFs
 * contain customer data, and a public bucket is an enumeration vulnerability.
 */
export async function signedUrlFor(key: string, expiresIn = 900): Promise<string | null> {
  if (!hasStorage) return null;
  try {
    return await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
      { expiresIn },
    );
  } catch (err) {
    logger.error({ key, err: String(err) }, "presign failed");
    return null;
  }
}
