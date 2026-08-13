import { z } from "zod";

/**
 * Fail fast and loudly at boot. A worker that starts with a missing key and
 * only discovers it three minutes into a scan wastes the whole job.
 */
const Env = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().default(8080),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  YEPAPI_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1).optional(),

  // Shared secret with the Vercel app. Without it the API is unauthenticated,
  // so the server refuses to start rather than exposing an open endpoint.
  WORKER_API_SECRET: z.string().min(24),

  CLOUDFLARE_BUCKET_S3_ENDPOINT: z.string().optional(),
  CLOUDFLARE_BUCKET_S3_ACCESS_KEY_ID: z.string().optional(),
  CLOUDFLARE_BUCKET_S3_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("defenex"),

  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  SCAN_QUERY_BUDGET: z.coerce.number().default(15),
  SEARCH_DEPTH: z.coerce.number().default(50),
  SEARCH_DAILY_CAP: z.coerce.number().default(5000),
  /**
   * Paid stealth calls per scan, by tier. Anonymous scans get a small
   * allowance so they still return something useful on bot-blocked
   * marketplaces, without letting an unidentified visitor spend $0.30 a click.
   */
  STEALTH_BUDGET_ANON: z.coerce.number().default(2),
  STEALTH_BUDGET_IDENTIFIED: z.coerce.number().default(8),
  SCAN_CONCURRENCY: z.coerce.number().default(2),
  REPORT_CONCURRENCY: z.coerce.number().default(3),
});

function load() {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid worker environment:\n${missing.join("\n")}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
export const hasStorage = Boolean(
  env.CLOUDFLARE_BUCKET_S3_ENDPOINT &&
    env.CLOUDFLARE_BUCKET_S3_ACCESS_KEY_ID &&
    env.CLOUDFLARE_BUCKET_S3_SECRET_ACCESS_KEY,
);
