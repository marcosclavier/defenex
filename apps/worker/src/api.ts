import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ScanInput } from "@defenex/shared";
import { severityLabel } from "@defenex/core";
import {
  brands, createScan, getDb, getReportByToken, getScan, listFindings, upsertBrand,
} from "@defenex/db";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { scanJobId, scanQueue } from "./queues.js";
import { signedUrlFor } from "./storage/r2.js";

/** Constant-time compare so the secret cannot be recovered by timing the endpoint. */
function secretMatches(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.WORKER_API_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createApi(): Hono {
  const app = new Hono();

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

    return c.json({
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

  app.route("/api", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    logger.error({ err: err.message, path: c.req.path }, "unhandled api error");
    // Never leak internals to the caller.
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
