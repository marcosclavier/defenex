import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ScanInput } from "@defenex/shared";
import { severityLabel } from "@defenex/core";
import {
  brands, claimBrand, claimStripeEvent, countOpenFindings, createScan, decideRightsClaim,
  getCustomer, getDb, getReportByScanId, getReportByToken, getScan, getUserById,
  listBrandsForUser, listFindings, listPendingRights, listRightsForBrand, listScansForBrand,
  setMonitoringPaused, submitRightsClaim, upsertBrand, upsertCustomer,
} from "@defenex/db";
import { render } from "@react-email/render";
import { MagicLink } from "@defenex/emails";
import { Resend } from "resend";
import { createAuth } from "./auth.js";
import { UsptoClient, RightsLookupError } from "@defenex/core";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { redisClient, scanQueue } from "./queues.js";
import { createRateLimiter } from "./rate-limit.js";
import { scanJobId } from "./job-ids.js";
import { signedUrlFor } from "./storage/r2.js";

/** Constant-time compare so the secret cannot be recovered by timing the endpoint. */
function secretMatches(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.WORKER_API_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export function createApi(): Hono {
  const app = new Hono();
  const checkRateLimit = createRateLimiter(redisClient);
  const auth = createAuth(redisClient);

  // Public: reports only that the process is alive. Deliberately reveals
  // nothing about databases or queues — a health check that fails on a
  // transient dependency blip causes restart loops.
  app.get("/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

  const api = new Hono();

  api.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : c.req.header("x-worker-secret") ?? "";
    if (!token || !secretMatches(token)) {
      logger.warn({ path: c.req.path, ip: c.req.header("x-forwarded-for") }, "unauthorized api request");
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  const CreateScanBody = ScanInput.extend({
    email: z.email().optional(),
    trigger: z.enum(["user", "scheduled", "outreach"]).default("user"),
  });

  api.post("/scan", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateScanBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        400,
      );
    }
    const input = parsed.data;

    // Scheduled and outreach scans are ours, not public traffic.
    if (input.trigger === "user") {
      const ip = c.req.header("x-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const limit = await checkRateLimit(input.domain, ip);
      if (!limit.allowed) {
        logger.info({ domain: input.domain, scope: limit.scope }, "rate limited");
        return c.json(
          { error: "rate_limited", scope: limit.scope },
          429,
          { "retry-after": String(Math.max(limit.retryAfterSeconds ?? 3600, 60)) },
        );
      }
    }

    const brand = await upsertBrand({
      name: input.brand,
      domain: input.domain.toLowerCase(),
      industry: input.industry,
      aliases: input.aliases,
      allowlistDomains: input.allowlistDomains,
    });

    const scan = await createScan({
      brandId: brand.id,
      trigger: input.trigger,
      requestedByEmail: input.email ?? null,
    });

    await scanQueue.add(
      "scan",
      {
        scanId: scan.id,
        brandId: brand.id,
        brand: input.brand,
        domain: input.domain,
        industry: input.industry,
        aliases: input.aliases,
        allowlistDomains: input.allowlistDomains,
        requestedByEmail: input.email ?? null,
        // Gating: the paid tier is reserved for requesters who identify
        // themselves. An anonymous scan still runs, just shallower on sites
        // that block an ordinary browser.
        stealthBudget: input.email ? env.STEALTH_BUDGET_IDENTIFIED : env.STEALTH_BUDGET_ANON,
        // Only scheduled scans raise alerts; a user watching their own scan
        // finish does not need an email about it.
        scheduled: input.trigger === "scheduled",
        ...(input.queryBudget !== undefined ? { queryBudget: input.queryBudget } : {}),
      },
      // Deterministic id: a double submit must not bill the search API twice.
      { jobId: scanJobId(scan.id) },
    );

    logger.info({ scanId: scan.id, brand: input.brand }, "scan enqueued");
    return c.json({ scanId: scan.id, status: scan.status }, 202);
  });

  api.get("/scan/:id", async (c) => {
    const scan = await getScan(c.req.param("id"));
    if (!scan) return c.json({ error: "not_found" }, 404);

    // Present only once the report row exists, which is how the progress page
    // knows where to send the visitor.
    const report = scan.status === "completed" || scan.status === "partial"
      ? await getReportByScanId(scan.id)
      : null;

    return c.json({
      reportToken: report?.publicToken ?? null,
      scanId: scan.id,
      status: scan.status,
      stage: scan.progressStage,
      percent: scan.progressPercent,
      findingsCount: scan.findingsCount,
      resultsSeen: scan.resultsSeen,
      error: scan.error,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
    });
  });

  /**
   * Report payload for the web app to render. Screenshot URLs are minted here
   * as short-lived signed links, so R2 credentials never reach Vercel and the
   * bucket stays private.
   */
  api.get("/report/:token", async (c) => {
    const report = await getReportByToken(c.req.param("token"));
    if (!report) return c.json({ error: "not_found" }, 404);

    const scan = await getScan(report.scanId);
    if (!scan) return c.json({ error: "not_found" }, 404);

    const brand = await getDb().query.brands.findFirst({ where: eq(brands.id, scan.brandId) });
    const rows = await listFindings(report.scanId);

    const findings = await Promise.all(
      rows.map(async (f) => ({
        url: f.url,
        domain: f.domain,
        title: f.title,
        category: f.category,
        severity: f.severity,
        severityLabel: severityLabel(f.severity),
        confidence: f.confidence,
        evidenceQuote: f.evidenceQuote,
        reasoning: f.reasoning,
        evidenceSource: f.evidenceSource,
        firstSeenAt: f.firstSeenAt,
        screenshotUrl: f.screenshotKey ? await signedUrlFor(f.screenshotKey) : null,
      })),
    );

    return c.json({
      brand: brand ? { name: brand.name, domain: brand.domain, industry: brand.industry } : null,
      scan: { id: scan.id, finishedAt: scan.finishedAt, resultsSeen: scan.resultsSeen },
      findings,
    });
  });

  // ------------------------------------------------------------ accounts

  api.post("/auth/request", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ email: z.email(), callbackUrl: z.string().optional() }).safeParse(body);
    // Always report success: a different answer for known and unknown
    // addresses turns this endpoint into an account-enumeration oracle.
    if (!parsed.success) return c.json({ ok: true });

    const email = parsed.data.email.toLowerCase().trim();
    const ip = c.req.header("x-client-ip") ?? "unknown";
    const throttleKey = `auth-throttle-${email}`;
    const attempts = await redisClient.incr(throttleKey);
    if (attempts === 1) await redisClient.expire(throttleKey, 15 * 60);
    if (attempts > 5) {
      logger.warn({ ip }, "magic link throttled");
      return c.json({ ok: true });
    }

    const token = await auth.issue(email);
    const url = `${env.NEXT_PUBLIC_APP_URL}/login/verify?token=${encodeURIComponent(token)}`;

    if (resend) {
      const html = await render(MagicLink({ url }));
      const { error } = await resend.emails.send({
        from: `Defenex <login@${env.RESEND_FROM_DOMAIN}>`,
        to: email,
        subject: "Your Defenex sign-in link",
        html,
      });
      if (error) logger.error({ err: error.message }, "magic link send failed");
      // Logged on success too: the endpoint always answers ok:true to avoid
      // leaking whether an account exists, so without this a broken mail
      // pipeline is indistinguishable from a working one.
      else logger.info({ domain: env.RESEND_FROM_DOMAIN }, "magic link sent");
    } else {
      logger.warn("RESEND_API_KEY not set; magic link not sent");
    }

    return c.json({ ok: true });
  });

  api.post("/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ token: z.string().min(20) }).safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_token" }, 400);

    const user = await auth.verify(parsed.data.token);
    if (!user) return c.json({ error: "invalid_token" }, 401);

    logger.info({ userId: user.id }, "user signed in");
    return c.json({ user });
  });

  api.get("/dashboard/:userId", async (c) => {
    const userId = c.req.param("userId");
    const owned = await listBrandsForUser(userId);

    const brandsWithState = await Promise.all(
      owned.map(async (b) => ({
        id: b.id,
        name: b.name,
        domain: b.domain,
        industry: b.industry,
        monitoringPaused: b.monitoringPaused,
        findings: await countOpenFindings(b.id),
        scans: (await listScansForBrand(b.id, 5)).map((s) => ({
          id: s.id,
          status: s.status,
          findingsCount: s.findingsCount,
          createdAt: s.createdAt,
          finishedAt: s.finishedAt,
        })),
      })),
    );

    const customer = await getCustomer(userId);
    return c.json({
      brands: brandsWithState,
      plan: customer?.plan ?? "free",
      subscription: customer
        ? {
            status: customer.status,
            currentPeriodEnd: customer.currentPeriodEnd,
            enforcementsIncluded: customer.enforcementsIncluded,
            enforcementsUsed: customer.enforcementsUsed,
          }
        : null,
    });
  });

  api.post("/brands/claim", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ domain: z.string().min(4), userId: z.uuid() }).safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const result = await claimBrand(parsed.data.domain, parsed.data.userId);
    if (!result.ok) {
      return c.json({ error: result.reason }, result.reason === "not_found" ? 404 : 409);
    }
    logger.info({ userId: parsed.data.userId, domain: parsed.data.domain }, "brand claimed");
    return c.json({ brand: { id: result.brand.id, name: result.brand.name, domain: result.brand.domain } });
  });

  api.post("/brands/:id/monitoring", async (c) => {
    const parsed = z
      .object({ userId: z.uuid(), paused: z.boolean() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    // Scoped to the owner: setMonitoringPaused matches on brand AND user, so a
    // valid session cannot pause someone else's monitoring.
    const ok = await setMonitoringPaused(c.req.param("id"), parsed.data.userId, parsed.data.paused);
    if (!ok) return c.json({ error: "not_found" }, 404);

    logger.info({ brandId: c.req.param("id"), paused: parsed.data.paused }, "monitoring toggled");
    return c.json({ paused: parsed.data.paused });
  });

  // ------------------------------------------------------------ rights

  /**
   * Admin checks are re-verified here against the database rather than trusted
   * from the caller. The web app is the only client and already checks the
   * session, but an authorisation decision should not rest on a single layer.
   */
  async function requireAdmin(userId: string): Promise<boolean> {
    const user = await getUserById(userId);
    return Boolean(user?.isAdmin);
  }

  api.post("/brands/:id/rights", async (c) => {
    const parsed = z
      .object({
        userId: z.uuid(),
        regNumber: z.string().min(4).max(20),
        jurisdiction: z.string().min(2).max(8).default("US"),
        documentKey: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const input = parsed.data;

    const brand = await getDb().query.brands.findFirst({ where: eq(brands.id, c.req.param("id")) });
    if (!brand || brand.ownerUserId !== input.userId) return c.json({ error: "not_found" }, 404);

    // Advisory lookup. A failure here must not block submission — the human
    // review is the authoritative step, and USPTO is frequently unavailable.
    let snapshot: Record<string, unknown> | null = null;
    let registryUrl: string | null = null;
    let lookupError: string | null = null;

    if (input.jurisdiction.toUpperCase() === "US" && env.USPTO_API_KEY) {
      try {
        const record = await new UsptoClient({ apiKey: env.USPTO_API_KEY }).lookup(input.regNumber);
        snapshot = {
          markText: record.markText,
          ownerName: record.ownerName,
          statusText: record.statusText,
          isLive: record.isLive,
          registrationDate: record.registrationDate,
          checkedAt: new Date().toISOString(),
        };
        registryUrl = record.registryUrl;
      } catch (err) {
        lookupError = err instanceof RightsLookupError ? err.message : "registry lookup failed";
        logger.warn({ err: lookupError }, "rights lookup failed");
      }
    }

    const claim = await submitRightsClaim({
      brandId: brand.id,
      regNumber: input.regNumber,
      jurisdiction: input.jurisdiction.toUpperCase(),
      submittedByUserId: input.userId,
      registryUrl,
      documentKey: input.documentKey ?? null,
      registrySnapshot: snapshot,
    });

    logger.info({ brandId: brand.id, regNumber: input.regNumber }, "rights claim submitted");
    return c.json({ claim: { id: claim.id, status: claim.status }, registry: snapshot, lookupError });
  });

  api.get("/brands/:id/rights", async (c) => {
    const rows = await listRightsForBrand(c.req.param("id"));
    return c.json({
      rights: rows.map((r) => ({
        id: r.id,
        regNumber: r.regNumber,
        jurisdiction: r.jurisdiction,
        status: r.status,
        registryUrl: r.registryUrl,
        registrySnapshot: r.registrySnapshot,
        rejectedReason: r.rejectedReason,
        createdAt: r.createdAt,
      })),
    });
  });

  api.get("/admin/rights", async (c) => {
    const userId = c.req.query("userId") ?? "";
    if (!(await requireAdmin(userId))) return c.json({ error: "not_found" }, 404);
    return c.json({ pending: await listPendingRights() });
  });

  api.post("/admin/rights/:id/decide", async (c) => {
    const parsed = z
      .object({ userId: z.uuid(), verified: z.boolean(), reason: z.string().max(500).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    if (!(await requireAdmin(parsed.data.userId))) return c.json({ error: "not_found" }, 404);

    const row = await decideRightsClaim(c.req.param("id"), {
      verified: parsed.data.verified,
      adminUserId: parsed.data.userId,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    if (!row) return c.json({ error: "not_found" }, 404);

    logger.info(
      { rightsId: row.id, verified: parsed.data.verified, by: parsed.data.userId },
      "rights decision recorded",
    );
    return c.json({ status: row.status });
  });

  api.post("/billing/sync", async (c) => {
    const parsed = z
      .object({
        eventId: z.string().min(1),
        eventType: z.string().min(1),
        userId: z.uuid(),
        stripeCustomerId: z.string().min(1),
        stripeSubscriptionId: z.string().min(1),
        plan: z.enum(["free", "monitor", "protect", "managed"]),
        status: z.string().min(1),
        currentPeriodEnd: z.string().nullable(),
        enforcementsIncluded: z.number().int().min(0),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const p = parsed.data;

    // Stripe retries deliveries; without this a retry double-applies.
    const fresh = await claimStripeEvent(p.eventId, p.eventType);
    if (!fresh) {
      logger.info({ eventId: p.eventId }, "stripe event already processed");
      return c.json({ applied: false });
    }

    const status = ["active", "trialing", "past_due", "canceled", "incomplete"].includes(p.status)
      ? (p.status as "active" | "trialing" | "past_due" | "canceled" | "incomplete")
      : "incomplete";

    await upsertCustomer(p.userId, {
      stripeCustomerId: p.stripeCustomerId,
      stripeSubscriptionId: p.stripeSubscriptionId,
      plan: p.plan,
      status,
      currentPeriodEnd: p.currentPeriodEnd ? new Date(p.currentPeriodEnd) : null,
      enforcementsIncluded: p.enforcementsIncluded,
    });

    logger.info({ userId: p.userId, plan: p.plan, status }, "billing synced");
    return c.json({ applied: true });
  });

  app.route("/api", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    logger.error({ err: err.message, path: c.req.path }, "unhandled api error");
    // Never leak internals to the caller.
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
