import type { Job } from "bullmq";
import {
  GeminiClassifier,
  YepApiClient,
  normalizeDomain,
  runScan,
} from "@defenex/core";
import { SEARCH_CACHE_TTL_MS, ScanInput } from "@defenex/shared";
import { listFindings, reconcileFindings, updateScanProgress } from "@defenex/db";
import { env } from "../env.js";
import { coreLogger, logger } from "../logger.js";
import { dbCache, dbQuota } from "../ports.js";
import { getFetcher } from "../browser.js";
import { putObject, screenshotKey } from "../storage/r2.js";
import { reportQueue, type ScanJobData } from "../queues.js";
import { urlHashOf } from "../url.js";

export async function processScan(job: Job<ScanJobData>): Promise<void> {
  const { scanId, brandId } = job.data;
  const log = logger.child({ scanId, brand: job.data.brand });
  const startedAt = new Date();

  const parsed = ScanInput.safeParse({
    brand: job.data.brand,
    domain: job.data.domain,
    industry: job.data.industry,
    aliases: job.data.aliases,
    allowlistDomains: job.data.allowlistDomains,
    queryBudget: env.SCAN_QUERY_BUDGET,
  });
  if (!parsed.success) {
    await updateScanProgress(scanId, {
      status: "failed",
      error: `invalid scan input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      finishedAt: new Date(),
    });
    return;
  }

  await updateScanProgress(scanId, { status: "running", startedAt, progressStage: "starting", progressPercent: 1 });

  const search = new YepApiClient({
    apiKey: env.YEPAPI_API_KEY,
    dailyCap: env.SEARCH_DAILY_CAP,
    defaultDepth: env.SEARCH_DEPTH,
    cache: dbCache(SEARCH_CACHE_TTL_MS),
    quota: dbQuota("yepapi"),
    logger: coreLogger,
  });

  try {
    const result = await runScan(parsed.data, {
      search,
      classifier: new GeminiClassifier({ apiKey: env.GEMINI_API_KEY, logger: coreLogger }),
      fetcher: getFetcher(),
      logger: coreLogger,
      depth: env.SEARCH_DEPTH,
      onProgress: (stage, percent) => {
        // Fire-and-forget: a progress write must never fail the scan.
        void updateScanProgress(scanId, { progressStage: stage, progressPercent: percent }).catch(
          (err) => log.warn({ err: String(err) }, "progress update failed"),
        );
      },
    });

    // Evidence first: upload screenshots before writing rows that reference them.
    const rows = await Promise.all(
      result.findings.map(async (f) => {
        let key: string | null = null;
        if (f.screenshot) {
          key = await putObject(screenshotKey(scanId, f.url), f.screenshot, "image/jpeg");
        }
        return {
          brandId,
          scanId,
          url: f.url,
          urlHash: urlHashOf(f.url),
          domain: normalizeDomain(f.url),
          category: f.category,
          severity: f.severity,
          confidence: f.confidence,
          title: f.title.slice(0, 500),
          evidenceQuote: f.evidenceQuote,
          reasoning: f.reasoning,
          sourceQuery: f.sourceQuery,
          screenshotKey: key,
          evidenceSource: f.evidenceSource,
        };
      }),
    );

    const diff = await reconcileFindings(brandId, scanId, rows);

    await updateScanProgress(scanId, {
      status: "completed",
      progressStage: "done",
      progressPercent: 100,
      queriesRun: result.stats.queriesRun,
      resultsSeen: result.stats.resultsSeen,
      findingsCount: result.findings.length,
      costMicros: result.stats.costMicros,
      finishedAt: new Date(),
    });

    log.info(
      {
        findings: result.findings.length,
        new: diff.created,
        reappeared: diff.reappeared,
        removed: diff.removed,
        costUsd: (result.stats.costMicros / 1e6).toFixed(3),
        durationSec: Math.round(result.stats.durationMs / 1000),
        stealthCalls: result.stats.stealthCallsUsed,
      },
      "scan complete",
    );

    await reportQueue.add(
      "report",
      { scanId, email: job.data.requestedByEmail ?? null },
      { jobId: `report:${scanId}` },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "scan failed");

    // Partial results are still worth keeping: a quota trip mid-scan should not
    // discard findings already written.
    const existing = await listFindings(scanId).catch(() => []);
    await updateScanProgress(scanId, {
      status: existing.length > 0 ? "partial" : "failed",
      error: message.slice(0, 1000),
      finishedAt: new Date(),
    });
    throw err;
  }
}
