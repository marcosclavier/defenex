import {
  DEFAULT_SCAN_QUERY_BUDGET,
  type ClassifyStatus,
  type Finding,
  type PageDiagnostic,
  type ScanInput,
  type ScanResult,
  type SearchResult,
} from "@defenex/shared";
import type { SearchProvider } from "./search/types.js";
import type { Classifier, ClassifyOutcome } from "./classify/gemini.js";
import type { PageFetcher } from "./enrich/fetch.js";
import { applyAllowlist, normalizeDomain } from "./enrich/allowlist.js";
import { buildQueries, type QueryKind } from "./queries/templates.js";
import { priorScore, severityFor } from "./score/index.js";
import { silentLogger, type Logger } from "./ports.js";

/**
 * Turn one classifier outcome into something a diagnostic row can state.
 *
 * A page with no verdict is not one situation. It may never have been sent, or
 * been sent and skipped, or answered with a quote that failed verification, or
 * been in a batch the API lost — and the last of those is an incident rather
 * than a result, so collapsing them all into `NOT_CLASSIFIED` hid the only one
 * worth paging about.
 */
function readOutcome(
  outcome: ClassifyOutcome | undefined,
  wasSent: boolean,
): { status: ClassifyStatus; detail?: string } {
  if (!wasSent) return { status: "not_fetched" };
  if (!outcome) return { status: "model_omitted" };

  switch (outcome.status) {
    case "classified":
      return { status: "classified" };
    case "evidence_rejected":
      return { status: "evidence_rejected", detail: `${outcome.category}: ${outcome.reason}` };
    case "batch_failed":
      return { status: "batch_failed", detail: outcome.error };
    default:
      return { status: "model_omitted" };
  }
}

export interface RunScanOptions {
  search: SearchProvider;
  classifier: Classifier;
  fetcher: PageFetcher;
  logger?: Logger;
  /** Results requested per query. Billed per call, so depth is nearly free. */
  depth?: number;
  /** Pages actually fetched. Bounds both wall-clock and cost. */
  maxEnrich?: number;
  /** Paid stealth calls allowed for THIS scan. Zero disables the paid tier. */
  stealthBudget?: number;
  fetchConcurrency?: number;
  searchConcurrency?: number;
  onProgress?: (stage: string, percent: number) => void;
}

/** Run `tasks` with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Full detection pipeline: search -> filter -> fetch -> classify -> score.
 *
 * Only pages we actually fetched are classified. Claiming a page infringes on
 * the strength of a search snippet alone produces confident nonsense, and the
 * report is read by people who will click the link.
 */
export async function runScan(input: ScanInput, opts: RunScanOptions): Promise<ScanResult> {
  const log = opts.logger ?? silentLogger;
  const started = Date.now();
  const budget = input.queryBudget ?? DEFAULT_SCAN_QUERY_BUDGET;
  const maxEnrich = opts.maxEnrich ?? 40;
  const progress = opts.onProgress ?? (() => {});

  // ---- 1. plan and run searches -------------------------------------------
  const plan = buildQueries(input, budget);
  const kindByQuery = new Map<string, QueryKind>(plan.map((p) => [p.q, p.kind]));
  progress("searching", 5);

  let queriesRun = 0;
  let searchCostMicros = 0;
  const searchFailures: string[] = [];
  // Which provider each query actually came from, when the tier is a chain.
  const answeredBy = new Set<string>();

  /**
   * A failed query costs its own results, not the scan's.
   *
   * This used to throw straight out of `runScan`: one provider hiccup out of
   * fifteen queries discarded everything the other fourteen had found, and the
   * runners still in flight kept billing for results nobody would see. A scan
   * that covers most of the ground is worth far more than no scan, so long as
   * it says which ground it missed — which `queriesFailed` is for.
   */
  const searchOutcomes = await mapLimit(plan, opts.searchConcurrency ?? 5, async (p, i) => {
    progress(`searching (${i + 1}/${plan.length})`, 5 + Math.round((i / plan.length) * 25));
    try {
      const outcome = await opts.search.search(p.q, {
        ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
        ...(p.gl ? { gl: p.gl } : {}),
      });
      queriesRun += outcome.callsSpent;
      searchCostMicros += outcome.costMicros;
      if (outcome.provider) answeredBy.add(outcome.provider);
      if (outcome.stale) answeredBy.add("stale-cache");
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      searchFailures.push(`${p.q}: ${message}`);
      log.warn("search query failed", { query: p.q, error: message });
      return null;
    }
  });

  // Every query failing is a different thing from some of them failing: there
  // is no partial coverage to report, only an outage.
  if (searchFailures.length === plan.length) {
    throw new Error(
      `every search query failed (${plan.length}) — ${searchFailures.slice(0, 3).join("; ")}`,
    );
  }

  const raw: SearchResult[] = searchOutcomes
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .flatMap((o) => o.results);

  if (searchFailures.length > 0) {
    log.warn("search partially degraded", {
      failed: searchFailures.length,
      planned: plan.length,
      reasons: searchFailures.slice(0, 3),
    });
  }
  log.info("search complete", {
    provider: opts.search.name,
    queries: plan.length,
    queriesFailed: searchFailures.length,
    apiCalls: queriesRun,
    results: raw.length,
  });

  // ---- 2. drop what cannot be infringement --------------------------------
  const { kept, dropped } = applyAllowlist(raw, input);
  log.info("allowlist applied", { kept: kept.length, dropped: dropped.length });
  progress("filtering", 32);

  // ---- 3. fetch the most promising pages ----------------------------------
  const rankedWithPrior = kept
    .map((r) => ({
      r,
      prior: priorScore(r, kindByQuery.get(r.sourceQuery) ?? "counterfeit_terms", input.brand),
    }))
    .sort((a, b) => b.prior - a.prior)
    .slice(0, maxEnrich);
  const priorByUrl = new Map(rankedWithPrior.map((x) => [x.r.url, x.prior]));
  const ranked = rankedWithPrior.map((x) => x.r);

  progress(`analyzing ${ranked.length} results`, 35);
  const fetch = await opts.fetcher.fetchMany(ranked, {
    concurrency: opts.fetchConcurrency ?? 6,
    ...(opts.stealthBudget !== undefined ? { stealthBudget: opts.stealthBudget } : {}),
  });
  const enriched = fetch.results;
  const fetchFailures = enriched.filter((e) => e.fetchError).length;
  log.info("enrichment complete", {
    fetched: enriched.length,
    failures: fetchFailures,
    viaStealth: fetch.stealthCallsUsed,
  });
  progress("capturing evidence", 65);

  // ---- 4. classify --------------------------------------------------------
  // Pages that could not be fetched have no verifiable evidence, so they cannot
  // become findings; excluding them here saves the model call entirely.
  const classifiable = enriched.filter((e) => (e.pageText ?? "").length > 0);
  const indexOfItem = new Map(classifiable.map((item, i) => [item, i]));
  const { byIndex, outcomes, rejectedForBadEvidence } = await opts.classifier.classify(
    classifiable,
    input,
  );
  progress("scoring", 88);

  // ---- 5. score and assemble ----------------------------------------------
  const categoryCounts: Record<string, number> = {};
  let classifierOmitted = 0;
  let classifierBatchFailures = 0;

  const diagnostics: PageDiagnostic[] = enriched.map((item) => {
    const idx = indexOfItem.get(item);
    const c = idx === undefined ? undefined : byIndex.get(idx);
    const { status, detail } = readOutcome(idx === undefined ? undefined : outcomes.get(idx), idx !== undefined);

    if (status === "model_omitted") classifierOmitted += 1;
    if (status === "batch_failed") classifierBatchFailures += 1;

    // Keyed by category when there is one and by the reason there isn't
    // otherwise, so the summary distinguishes pages judged unremarkable from
    // pages that were never judged.
    const countKey = c ? c.category : status.toUpperCase();
    categoryCounts[countKey] = (categoryCounts[countKey] ?? 0) + 1;

    return {
      url: item.url,
      prior: priorByUrl.get(item.url) ?? 0,
      evidenceSource: item.evidenceSource,
      textChars: (item.pageText ?? "").length,
      httpStatus: item.httpStatus,
      fetchError: item.fetchError,
      category: c?.category ?? "NOT_CLASSIFIED",
      classifyStatus: status,
      ...(detail !== undefined ? { classifyDetail: detail } : {}),
      confidence: c?.confidence ?? null,
    };
  });

  const findings: Finding[] = [];
  for (const [index, classification] of byIndex) {
    const item = classifiable[index];
    if (!item || classification.category === "LEGITIMATE") continue;

    const url = item.finalUrl || item.url;
    findings.push({
      url,
      domain: normalizeDomain(url),
      title: item.pageTitle ?? item.title,
      category: classification.category,
      confidence: classification.confidence,
      severity: severityFor(classification, url, item),
      evidenceQuote: classification.evidenceQuote,
      reasoning: classification.reasoning,
      sourceQuery: item.sourceQuery,
      screenshot: item.screenshot,
      evidenceSource: item.evidenceSource,
    });
  }

  findings.sort((a, b) => b.severity - a.severity);
  progress("done", 100);

  return {
    input,
    findings,
    diagnostics,
    stats: {
      queriesRun,
      queriesPlanned: plan.length,
      queriesFailed: searchFailures.length,
      searchProvider: answeredBy.size > 0 ? [...answeredBy].sort().join("+") : opts.search.name,
      resultsSeen: raw.length,
      resultsAfterAllowlist: kept.length,
      resultsEnriched: enriched.length,
      fetchFailures,
      stealthCallsUsed: fetch.stealthCallsUsed,
      findingsPublished: findings.length,
      rejectedForBadEvidence,
      classifierOmitted,
      classifierBatchFailures,
      searchCostMicros,
      stealthCostMicros: fetch.stealthCostMicros,
      costMicros: searchCostMicros + fetch.stealthCostMicros,
      durationMs: Date.now() - started,
      categoryCounts,
    },
  };
}
