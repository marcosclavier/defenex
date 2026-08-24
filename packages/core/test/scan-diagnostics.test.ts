import { describe, it, expect } from "vitest";
import type { EnrichedResult, ScanInput } from "@defenex/shared";
import { runScan } from "../src/scan.js";
import type { Classifier } from "../src/classify/gemini.js";
import type { PageFetcher } from "../src/enrich/fetch.js";
import type { SearchProvider } from "../src/search/types.js";

/**
 * The scan summary used to report every page without a category as
 * `NOT_CLASSIFIED`, so "we never asked", "the model skipped it" and "the API
 * dropped ten of them" all looked like the same thing — and the last one looked
 * like a quiet scan rather than a lost quarter of one.
 */

const input: ScanInput = {
  brand: "YETI",
  domain: "yeti.com",
  industry: "generic",
  aliases: [],
  allowlistDomains: [],
  queryBudget: 6,
};

const search: SearchProvider = {
  name: "stub",
  search: async () => ({ results: [], callsSpent: 1, costMicros: 0, fromCache: false }),
};

function fetched(n: number, pageText: string | null): EnrichedResult {
  return {
    url: `https://shop.example/${n}`,
    title: `listing ${n}`,
    snippet: "",
    sourceQuery: "yeti replica",
    resultType: "organic",
    position: n,
    finalUrl: `https://shop.example/${n}`,
    httpStatus: pageText ? 200 : 403,
    pageTitle: `listing ${n}`,
    pageText,
    screenshot: null,
    fetchError: pageText ? null : "page returned 0 characters (status 403)",
    evidenceSource: pageText ? "browser" : null,
  };
}

// Four pages with text, one defeated fetch. Order matters: the classifier is
// handed only the four, and the diagnostics must map back onto all five.
const pages = [
  fetched(0, "Replica YETI Rambler, AAA quality."),
  fetched(1, "Some other listing."),
  fetched(2, "A third listing."),
  fetched(3, "A fourth listing."),
  fetched(4, null),
];

const fetcher = {
  fetchMany: async () => ({ results: pages, stealthCallsUsed: 0, stealthCostMicros: 0 }),
} as unknown as PageFetcher;

const classifier: Classifier = {
  classify: async () => ({
    byIndex: new Map([
      [0, { category: "COUNTERFEIT" as const, confidence: "high" as const, evidenceQuote: "Replica YETI Rambler", reasoning: "r" }],
    ]),
    outcomes: new Map([
      [0, { status: "classified" as const, classification: { category: "COUNTERFEIT" as const, confidence: "high" as const, evidenceQuote: "Replica YETI Rambler", reasoning: "r" } }],
      [1, { status: "model_omitted" as const }],
      [2, { status: "batch_failed" as const, error: "503 Service Unavailable" }],
      [3, { status: "evidence_rejected" as const, category: "COUNTERFEIT" as const, reason: "quote_not_probative" }],
    ]),
    rejectedForBadEvidence: 1,
  }),
};

async function scan() {
  return runScan(input, { search, classifier, fetcher });
}

describe("a page without a category says why", () => {
  it("gives every fetched page a status", async () => {
    const { diagnostics } = await scan();
    const byUrl = new Map(diagnostics.map((d) => [d.url, d]));

    expect(byUrl.get("https://shop.example/0")?.classifyStatus).toBe("classified");
    expect(byUrl.get("https://shop.example/1")?.classifyStatus).toBe("model_omitted");
    expect(byUrl.get("https://shop.example/2")?.classifyStatus).toBe("batch_failed");
    expect(byUrl.get("https://shop.example/3")?.classifyStatus).toBe("evidence_rejected");
    // Never sent, because there was no text to send.
    expect(byUrl.get("https://shop.example/4")?.classifyStatus).toBe("not_fetched");
  });

  it("carries the reason a verdict was thrown away", async () => {
    const { diagnostics } = await scan();
    const byUrl = new Map(diagnostics.map((d) => [d.url, d]));

    expect(byUrl.get("https://shop.example/3")?.classifyDetail).toBe("COUNTERFEIT: quote_not_probative");
    expect(byUrl.get("https://shop.example/2")?.classifyDetail).toBe("503 Service Unavailable");
    expect(byUrl.get("https://shop.example/0")?.classifyDetail).toBeUndefined();
  });

  it("counts the unjudged pages apart from the judged ones", async () => {
    const { stats } = await scan();

    expect(stats.categoryCounts).toEqual({
      COUNTERFEIT: 1,
      MODEL_OMITTED: 1,
      BATCH_FAILED: 1,
      EVIDENCE_REJECTED: 1,
      NOT_FETCHED: 1,
    });
    expect(stats.classifierOmitted).toBe(1);
    expect(stats.classifierBatchFailures).toBe(1);
  });

  it("still publishes the finding it did verify", async () => {
    const result = await scan();
    expect(result.findings.map((f) => f.category)).toEqual(["COUNTERFEIT"]);
    expect(result.stats.rejectedForBadEvidence).toBe(1);
  });

  it("reports no batch failures on a clean run", async () => {
    const clean: Classifier = {
      classify: async () => ({ byIndex: new Map(), outcomes: new Map(), rejectedForBadEvidence: 0 }),
    };
    const { stats } = await runScan(input, { search, classifier: clean, fetcher });

    expect(stats.classifierBatchFailures).toBe(0);
    // An outcome map that says nothing about a page it was given still means
    // the page went unjudged, so it counts as omitted rather than vanishing.
    expect(stats.classifierOmitted).toBe(4);
  });
});
