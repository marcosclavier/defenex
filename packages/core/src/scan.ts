import {
  DEFAULT_SCAN_QUERY_BUDGET,
  type Finding,
  type ScanInput,
  type ScanResult,
  type SearchResult,
} from "@defenex/shared";
import type { CseClient } from "./cse/client.js";
import type { Classifier } from "./classify/gemini.js";
import type { PageFetcher } from "./enrich/fetch.js";
import { applyAllowlist, normalizeDomain } from "./enrich/allowlist.js";
import { buildQueries, type QueryKind } from "./queries/templates.js";
import { priorScore, severityFor } from "./score/index.js";
import { silentLogger, type Logger } from "./ports.js";

export interface RunScanOptions {
  cse: CseClient;
  classifier: Classifier;
  fetcher: PageFetcher;
  logger?: Logger;
  /** Pages actually fetched. Bounds both wall-clock and cost. */
  maxEnrich?: number;
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
  let costMicros = 0;

  const searchOutcomes = await mapLimit(plan, opts.searchConcurrency ?? 5, async (p, i) => {
    const outcome = await opts.cse.search(p.q, p.gl ? { gl: p.gl } : {});
    queriesRun += outcome.queriesSpent;
    costMicros += outcome.costMicros;
    progress(`searching (${i + 1}/${plan.length})`, 5 + Math.round((i / plan.length) * 25));
    return outcome;
  });

  const raw: SearchResult[] = searchOutcomes.flatMap((o) => o.results);
  log.info("search complete", { queries: plan.length, apiCalls: queriesRun, results: raw.length });

  // ---- 2. drop what cannot be infringement --------------------------------
  const { kept, dropped } = applyAllowlist(raw, input);
  log.info("allowlist applied", { kept: kept.length, dropped: dropped.length });
  progress("filtering", 32);

  // ---- 3. fetch the most promising pages ----------------------------------
  const ranked = kept
    .map((r) => ({ r, prior: priorScore(r, kindByQuery.get(r.sourceQuery) ?? "counterfeit_terms", input.brand) }))
    .sort((a, b) => b.prior - a.prior)
    .slice(0, maxEnrich)
    .map((x) => x.r);

  progress(`analyzing ${ranked.length} results`, 35);
  const enriched = await opts.fetcher.fetchMany(ranked, opts.fetchConcurrency ?? 6);
  const fetchFailures = enriched.filter((e) => e.fetchError).length;
  log.info("enrichment complete", { fetched: enriched.length, failures: fetchFailures });
  progress("capturing evidence", 65);

  // ---- 4. classify --------------------------------------------------------
  // Pages that could not be fetched have no verifiable evidence, so they cannot
  // become findings; excluding them here saves the model call entirely.
  const classifiable = enriched.filter((e) => (e.pageText ?? "").length > 0);
  const { byIndex, rejectedForBadEvidence } = await opts.classifier.classify(classifiable, input);
  progress("scoring", 88);

  // ---- 5. score and assemble ----------------------------------------------
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
      severity: severityFor(classification, url),
      evidenceQuote: classification.evidenceQuote,
      reasoning: classification.reasoning,
      sourceQuery: item.sourceQuery,
      screenshot: item.screenshot,
    });
  }

  findings.sort((a, b) => b.severity - a.severity);
  progress("done", 100);

  return {
    input,
    findings,
    stats: {
      queriesRun,
      resultsSeen: raw.length,
      resultsAfterAllowlist: kept.length,
      resultsEnriched: enriched.length,
      findingsPublished: findings.length,
      rejectedForBadEvidence,
      costMicros,
      durationMs: Date.now() - started,
    },
  };
}
