import { describe, it, expect, vi } from "vitest";
import { runScan } from "../src/scan.js";
import type { SearchOutcome, SearchProvider } from "../src/search/types.js";
import type { Classifier } from "../src/classify/gemini.js";
import type { PageFetcher } from "../src/enrich/fetch.js";
import type { ScanInput } from "@defenex/shared";

const input: ScanInput = {
  brand: "YETI",
  domain: "yeti.com",
  industry: "generic",
  aliases: [],
  allowlistDomains: [],
  queryBudget: 6,
};

const emptyOutcome = (): SearchOutcome => ({ results: [], callsSpent: 1, costMicros: 10_000, fromCache: false });

/** Nothing gets past the allowlist, so classification and fetching never run. */
const idleClassifier: Classifier = { classify: async () => ({ byIndex: new Map(), rejectedForBadEvidence: 0 }) };
const idleFetcher = {
  fetchMany: async () => ({ results: [], stealthCallsUsed: 0, stealthCostMicros: 0 }),
} as unknown as PageFetcher;

function providerThatFails(failFor: (q: string, n: number) => boolean): SearchProvider {
  let n = 0;
  return {
    name: "flaky",
    search: async (q) => {
      const i = n++;
      if (failFor(q, i)) throw new Error("upstream 502");
      return emptyOutcome();
    },
  };
}

async function scan(search: SearchProvider) {
  return runScan(input, { search, classifier: idleClassifier, fetcher: idleFetcher, searchConcurrency: 2 });
}

describe("a failed query costs its own results, not the scan's", () => {
  // The original behaviour: one rejection out of fifteen aborted runScan and
  // discarded everything the other fourteen had found.
  it("completes when some queries fail", async () => {
    const result = await scan(providerThatFails((_q, i) => i % 2 === 0));
    expect(result.stats.queriesFailed).toBeGreaterThan(0);
    expect(result.stats.queriesFailed).toBeLessThan(result.stats.queriesPlanned);
  });

  it("counts what it planned and what it lost", async () => {
    const result = await scan(providerThatFails((_q, i) => i === 0));
    expect(result.stats.queriesPlanned).toBe(6);
    expect(result.stats.queriesFailed).toBe(1);
    // Only the surviving queries were billed.
    expect(result.stats.queriesRun).toBe(5);
  });

  it("reports zero failures on a clean run", async () => {
    const result = await scan({ name: "ok", search: async () => emptyOutcome() });
    expect(result.stats.queriesFailed).toBe(0);
    expect(result.stats.queriesRun).toBe(6);
  });

  // Total failure is an outage, not partial coverage — there is nothing to report.
  it("still throws when every query fails", async () => {
    await expect(scan(providerThatFails(() => true))).rejects.toThrow(/every search query failed/);
  });

  it("does not bill for a query that threw", async () => {
    const result = await scan(providerThatFails((_q, i) => i < 4));
    expect(result.stats.searchCostMicros).toBe(2 * 10_000);
  });

  it("logs the degradation rather than passing it over in silence", async () => {
    const warn = vi.fn();
    await runScan(input, {
      search: providerThatFails((_q, i) => i === 0),
      classifier: idleClassifier,
      fetcher: idleFetcher,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).toHaveBeenCalledWith("search partially degraded", expect.objectContaining({ failed: 1 }));
  });
});
