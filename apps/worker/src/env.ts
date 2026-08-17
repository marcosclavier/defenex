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
  /**
   * Serper.dev — the failover SERP provider. Optional: without it the search
   * tier is single-vendor again, which is the state this replaced.
   */
  SERPER_DEV_API_KEY: z.string().optional(),
  /**
   * Price of one Serper credit in millionths of a dollar. Depends on the active
   * plan, and it feeds both the spend circuit breaker and the cost reported to
   * customers, so a wrong value is wrong in two places.
   */
  SERPER_COST_MICROS_PER_CALL: z.coerce.number().default(500),
  /**
   * Pages per query on the fallback. Serper ignores `num` and returns about ten
   * organic results per call, billing each page separately — so unlike the
   * primary, depth costs money here. Five pages is roughly SEARCH_DEPTH.
   */
  SERPER_MAX_PAGES: z.coerce.number().min(1).max(10).default(5),
  /**
   * Which SERP provider the scanner uses.
   *
   * `chain` tries the primary and falls back. Pinning a single provider is the
   * revert path: this choice decides what the classifier is given to read, so
   * changing it must not need a deploy.
   */
  SEARCH_PROVIDER: z.enum(["chain", "yepapi", "serper"]).default("chain"),
  /**
   * spider.cloud. Roughly a fortieth of the price of the YepAPI stealth tier
   * and several times faster, and it returns page HTML, which is what lets
   * evidence capture photograph a site that refuses our own browser.
   */
  SPIDER_CLOUD_API_KEY: z.string().optional(),

  /**
   * The paid fetch tier.
   *
   * `chain` — spider first, YepAPI where spider was defeated. The default,
   * because measured head to head neither provider wins outright: spider reads
   * DHgate, which YepAPI and our own browser both get a 403 from, and costs a
   * fortieth as much; YepAPI reads Etsy, which spider gets a consistent 403
   * from. Chaining takes the union of their coverage while the bill stays close
   * to spider's, since the fallback only fires where the first failed.
   *
   * `spider` or `yepapi` pin a single provider. Kept as an escape hatch: this
   * choice decides what text the classifier reads and therefore what counts as
   * a finding, so reverting must not need a deploy.
   */
  SCAN_FETCH_PROVIDER: z.enum(["yepapi", "spider", "chain"]).default("chain"),
  GEMINI_API_KEY: z.string().min(1),
  /**
   * USPTO TSDR key for the advisory rights pre-check. Optional: without it the
   * admin can still verify a registration manually against the public register,
   * which is the authoritative step regardless.
   */
  USPTO_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * Sending domain for transactional mail. Must be verified in Resend or every
   * send fails silently from the user's point of view.
   *
   * Defaults to defenex.ca because that is what is verified today. defenex.com
   * was the intended transactional domain, with .ca reserved for cold outreach
   * so that outreach complaints could never poison report delivery. Verify
   * defenex.com in Resend and set this to it to restore that separation.
   */
  RESEND_FROM_DOMAIN: z.string().default("defenex.ca"),

  /**
   * Identity that appears on the notices we file. This is the party a provider
   * writes back to and, if a notice is disputed, the party answering for it —
   * so it is configuration, not a literal buried in a template.
   */
  NOTICE_FROM_EMAIL: z.string().default("notices@defenex.com"),
  NOTICE_ORGANISATION: z.string().default("Defenex"),
  NOTICE_AGENT_TITLE: z.string().default("Brand Protection Agent"),
  NOTICE_AGENT_PHONE: z.string().optional(),
  NOTICE_AGENT_ADDRESS: z.string().optional(),

  /**
   * Error reporting. Optional so a missing DSN degrades to logs rather than
   * refusing to boot — but a system that files legal notices should have one set.
   */
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

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
  /** Separate cap: the two vendors are priced an order of magnitude apart. */
  SERPER_DAILY_CAP: z.coerce.number().default(5000),
  /**
   * Paid fetch calls per scan, by tier. Anonymous scans get a small allowance
   * so they still return something useful on bot-blocked marketplaces, without
   * letting an unidentified visitor run up the bill.
   *
   * Raised from 2 and 8 when the tier moved to spider: at roughly $0.0007 a
   * call rather than $0.03, thirty calls costs about two cents and latency
   * becomes the binding constraint rather than money. Lower these if the
   * provider falls back to YepAPI.
   */
  STEALTH_BUDGET_ANON: z.coerce.number().default(6),
  STEALTH_BUDGET_IDENTIFIED: z.coerce.number().default(30),
  SCAN_CONCURRENCY: z.coerce.number().default(2),
  /** Brands enqueued per scheduler tick. Caps the spend a single tick can cause. */
  SCHEDULE_BATCH_SIZE: z.coerce.number().default(25),
  /** How often the scheduler looks for due rescans. */
  SCHEDULE_INTERVAL_MINUTES: z.coerce.number().default(60),
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
