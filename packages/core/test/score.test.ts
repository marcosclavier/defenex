import { describe, it, expect } from "vitest";
import { severityFor, severityLabel, priorScore } from "../src/score/index.js";
import type { Classification, SearchResult } from "@defenex/shared";

const cls = (over: Partial<Classification> = {}): Classification => ({
  category: "COUNTERFEIT",
  confidence: "high",
  evidenceQuote: "q",
  reasoning: "r",
  ...over,
});

describe("severityFor", () => {
  it("scores LEGITIMATE at zero", () => {
    expect(severityFor(cls({ category: "LEGITIMATE" }), "https://x.com")).toBe(0);
  });

  it("ranks phishing above counterfeit above unauthorized resale", () => {
    const p = severityFor(cls({ category: "PHISHING" }), "https://x.test");
    const c = severityFor(cls({ category: "COUNTERFEIT" }), "https://x.test");
    const u = severityFor(cls({ category: "UNAUTHORIZED_RESALE" }), "https://x.test");
    expect(p).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(u);
  });

  it("discounts lower confidence", () => {
    expect(severityFor(cls({ confidence: "high" }), "https://x.test")).toBeGreaterThan(
      severityFor(cls({ confidence: "low" }), "https://x.test"),
    );
  });

  it("boosts high-reach enforceable hosts", () => {
    expect(severityFor(cls(), "https://www.aliexpress.com/item/1")).toBeGreaterThan(
      severityFor(cls(), "https://tiny-shop.test/item/1"),
    );
  });

  it("stays within 0-100", () => {
    const s = severityFor(cls({ category: "PHISHING" }), "https://www.amazon.com/x");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("severityLabel", () => {
  it.each([
    [95, "critical"], [80, "critical"], [79, "high"], [60, "high"],
    [59, "medium"], [35, "medium"], [34, "low"], [0, "low"],
  ])("labels %i as %s", (score, label) => {
    expect(severityLabel(score)).toBe(label);
  });
});

describe("priorScore", () => {
  const base: SearchResult = {
    url: "https://shop.test/x", title: "", snippet: "",
    displayLink: "", sourceQuery: "q",
  };

  it("ranks marketplace hits above social hits", () => {
    expect(priorScore(base, "marketplace", "Acme")).toBeGreaterThan(
      priorScore(base, "social", "Acme"),
    );
  });

  it("boosts infringement vocabulary in the snippet", () => {
    const loud = { ...base, snippet: "cheap replica wholesale discount" };
    expect(priorScore(loud, "marketplace", "Acme")).toBeGreaterThan(
      priorScore(base, "marketplace", "Acme"),
    );
  });

  it("boosts the brand name appearing inside the hostname", () => {
    const squat = { ...base, url: "https://acmetools-outlet.test/x" };
    expect(priorScore(squat, "social", "acmetools")).toBeGreaterThan(
      priorScore(base, "social", "acmetools"),
    );
  });
});
