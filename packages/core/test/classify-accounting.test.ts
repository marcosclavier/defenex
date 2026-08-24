import { describe, it, expect } from "vitest";
import type { EnrichedResult, ScanInput } from "@defenex/shared";
import { GeminiClassifier, type ModelCall } from "../src/classify/gemini.js";

/**
 * A page with no verdict used to be a single indistinguishable state. These
 * tests pin the four things that can actually have happened, because the scan
 * summary now reports them separately and one of them is an incident.
 */

const input: ScanInput = {
  brand: "YETI",
  domain: "yeti.com",
  industry: "generic",
  aliases: [],
  allowlistDomains: [],
  queryBudget: 6,
};

function page(n: number, text: string): EnrichedResult {
  return {
    url: `https://shop.example/${n}`,
    title: `listing ${n}`,
    snippet: "",
    sourceQuery: "yeti replica",
    resultType: "organic",
    position: n,
    finalUrl: `https://shop.example/${n}`,
    httpStatus: 200,
    pageTitle: `listing ${n}`,
    pageText: text,
    screenshot: null,
    fetchError: null,
    evidenceSource: "browser",
  };
}

const REPLICA = "Replica YETI Rambler tumbler, AAA quality, ships worldwide.";

function verdict(index: number, category: string, quote: string) {
  return { index, category, confidence: "high", evidenceQuote: quote, reasoning: "because" };
}

function respondWith(...results: unknown[]): ModelCall {
  return async () => JSON.stringify({ results });
}

function classifier(modelCall: ModelCall, batchSize = 10) {
  return new GeminiClassifier({ apiKey: "test-key", batchSize, modelCall });
}

describe("the classifier says what happened to every page it was given", () => {
  it("records a verified verdict as classified", async () => {
    const items = [page(1, REPLICA)];
    const out = await classifier(respondWith(verdict(0, "COUNTERFEIT", "Replica YETI Rambler"))).classify(
      items,
      input,
    );

    expect(out.byIndex.get(0)?.category).toBe("COUNTERFEIT");
    expect(out.outcomes.get(0)).toMatchObject({ status: "classified" });
    expect(out.rejectedForBadEvidence).toBe(0);
  });

  it("distinguishes a page the model never mentioned", async () => {
    const items = [page(1, REPLICA), page(2, REPLICA)];
    const out = await classifier(respondWith(verdict(0, "COUNTERFEIT", "Replica YETI Rambler"))).classify(
      items,
      input,
    );

    expect(out.outcomes.get(0)).toMatchObject({ status: "classified" });
    expect(out.outcomes.get(1)).toEqual({ status: "model_omitted" });
    expect(out.byIndex.has(1)).toBe(false);
  });

  it("names the rule a rejected quote failed", async () => {
    // On the page, but boilerplate: it neither names the brand nor accuses.
    const items = [page(1, `${REPLICA} Free shipping on all orders over fifty dollars.`)];
    const out = await classifier(
      respondWith(verdict(0, "COUNTERFEIT", "Free shipping on all orders")),
    ).classify(items, input);

    expect(out.outcomes.get(0)).toEqual({
      status: "evidence_rejected",
      category: "COUNTERFEIT",
      reason: "quote_not_probative",
    });
    expect(out.byIndex.has(0)).toBe(false);
    expect(out.rejectedForBadEvidence).toBe(1);
  });

  it("records a rejected LEGITIMATE quote without counting it as a lost finding", async () => {
    // Nothing was accused, so nothing was lost — but the page still went
    // unjudged, and the count that feeds the report must not imply otherwise.
    const items = [page(1, "An authorised stockist page with ordinary retail copy.")];
    const out = await classifier(
      respondWith(verdict(0, "LEGITIMATE", "a quote that is not on the page at all")),
    ).classify(items, input);

    expect(out.outcomes.get(0)).toMatchObject({
      status: "evidence_rejected",
      category: "LEGITIMATE",
      reason: "quote_not_in_source",
    });
    expect(out.rejectedForBadEvidence).toBe(0);
  });

  it("marks every page in a dropped batch, with the error that dropped it", async () => {
    const items = [page(1, REPLICA), page(2, REPLICA)];
    const out = await classifier(async () => {
      throw new Error("503 Service Unavailable");
    }).classify(items, input);

    for (const i of [0, 1]) {
      expect(out.outcomes.get(i)).toEqual({ status: "batch_failed", error: "503 Service Unavailable" });
    }
    expect(out.byIndex.size).toBe(0);
  });

  it("treats an unparseable response as a dropped batch, not an empty one", async () => {
    const items = [page(1, REPLICA)];
    const out = await classifier(async () => "not json at all").classify(items, input);

    const outcome = out.outcomes.get(0);
    expect(outcome?.status).toBe("batch_failed");
    // The distinction the old code lost: a parse failure and a model that found
    // nothing both produced zero results.
    expect(out.byIndex.size).toBe(0);
  });

  it("loses only the batch that failed", async () => {
    const items = [page(1, REPLICA), page(2, REPLICA), page(3, REPLICA), page(4, REPLICA)];
    let call = 0;
    const out = await classifier(async () => {
      call += 1;
      // Two attempts per batch, so the first batch's two calls both fail.
      if (call <= 2) throw new Error("500");
      return JSON.stringify({ results: [verdict(0, "COUNTERFEIT", "Replica YETI Rambler")] });
    }, 2).classify(items, input);

    expect(out.outcomes.get(0)?.status).toBe("batch_failed");
    expect(out.outcomes.get(1)?.status).toBe("batch_failed");
    expect(out.outcomes.get(2)?.status).toBe("classified");
    expect(out.outcomes.get(3)?.status).toBe("model_omitted");
  });

  it("retries once before giving up on a batch", async () => {
    const items = [page(1, REPLICA)];
    let call = 0;
    const out = await classifier(async () => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return JSON.stringify({ results: [verdict(0, "COUNTERFEIT", "Replica YETI Rambler")] });
    }).classify(items, input);

    expect(call).toBe(2);
    expect(out.outcomes.get(0)?.status).toBe("classified");
  });

  it("indexes outcomes across batch boundaries", async () => {
    const items = [page(1, REPLICA), page(2, REPLICA), page(3, REPLICA)];
    // Each batch reports its own index 0, which must land at the global offset.
    const out = await classifier(
      respondWith(verdict(0, "COUNTERFEIT", "Replica YETI Rambler")),
      1,
    ).classify(items, input);

    expect([...out.byIndex.keys()].sort()).toEqual([0, 1, 2]);
    expect(out.outcomes.size).toBe(3);
  });

  it("leaves an out-of-range index omitted rather than throwing", async () => {
    const items = [page(1, REPLICA)];
    const out = await classifier(respondWith(verdict(7, "COUNTERFEIT", "Replica YETI Rambler"))).classify(
      items,
      input,
    );

    expect(out.outcomes.get(0)).toEqual({ status: "model_omitted" });
    expect(out.outcomes.has(7)).toBe(false);
  });

  it("accounts for every item it was given", async () => {
    const items = [page(1, REPLICA), page(2, REPLICA), page(3, REPLICA)];
    const out = await classifier(respondWith(verdict(1, "COUNTERFEIT", "Replica YETI Rambler")), 2).classify(
      items,
      input,
    );

    expect(out.outcomes.size).toBe(items.length);
  });
});
