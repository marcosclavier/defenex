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

  it("boosts findings Google itself flagged as malicious", () => {
    const plain = severityFor(cls({ category: "PHISHING" }), "https://x.test");
    const flagged = severityFor(cls({ category: "PHISHING" }), "https://x.test", {
      flaggedMalicious: true,
    });
    expect(flagged).toBeGreaterThan(plain);
  });

  it("boosts live product listings over ordinary pages", () => {
    expect(
      severityFor(cls(), "https://x.test", { resultType: "product" }),
    ).toBeGreaterThan(severityFor(cls(), "https://x.test", { resultType: "organic" }));
  });

  it("stays within 0-100", () => {
    const s = severityFor(cls({ category: "PHISHING" }), "https://www.amazon.com/x", {
      flaggedMalicious: true, resultType: "product", position: 1,
    });
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

  it("does not promote a brand's own properties on hostname alone", () => {
    // Regression: an earlier version ranked yeti.ca, yeti.my.site.com and the
    // brand's Workday careers site above real counterfeit listings.
    const ownSite = { ...base, url: "https://yeti.ca/login", title: "Sign in", snippet: "Account login" };
    const counterfeit = {
      ...base, url: "https://dhgate.com/x",
      title: "Replica Yeti Cooler", snippet: "cheap wholesale replica",
    };
    expect(priorScore(counterfeit, "marketplace", "yeti")).toBeGreaterThan(
      priorScore(ownSite, "domain_abuse", "yeti"),
    );
  });

  it("ranks a brand-named credential-harvest page highly", () => {
    // Regression: a uniform /login penalty dropped yeti-login.webflow.io — a
    // real phishing page and the single highest-severity finding — out of the
    // candidate set entirely.
    const phish = {
      ...base, url: "https://acme-login.webflow.io/",
      title: "Acme Login", snippet: "Email Address Password",
    };
    const ordinary = { ...base, url: "https://unrelated.test/page" };
    expect(priorScore(phish, "domain_abuse", "acme")).toBeGreaterThan(
      priorScore(ordinary, "domain_abuse", "acme") + 30,
    );
  });

  it("still penalises login paths on hosts unrelated to the brand", () => {
    const unrelatedLogin = { ...base, url: "https://randomsite.test/account/login" };
    const unrelatedPlain = { ...base, url: "https://randomsite.test/product/1" };
    expect(priorScore(unrelatedPlain, "marketplace", "acme")).toBeGreaterThan(
      priorScore(unrelatedLogin, "marketplace", "acme"),
    );
  });

  it("penalises login, careers and support paths", () => {
    const plain = { ...base, url: "https://shop.test/product/1" };
    const login = { ...base, url: "https://shop.test/account/login" };
    expect(priorScore(plain, "marketplace", "Acme")).toBeGreaterThan(
      priorScore(login, "marketplace", "Acme"),
    );
  });

  it("ranks infringement vocabulary above a bare brand mention", () => {
    const loud = { ...base, snippet: "cheap replica wholesale" };
    const quiet = { ...base, snippet: "official product information" };
    expect(priorScore(loud, "marketplace", "Acme")).toBeGreaterThan(
      priorScore(quiet, "marketplace", "Acme") + 20,
    );
  });

  it("prioritises SERP-flagged malicious results for fetching", () => {
    expect(priorScore({ ...base, flaggedMalicious: true }, "social", "Acme")).toBeGreaterThan(
      priorScore(base, "social", "Acme"),
    );
  });

  it("boosts a brand-named host only when infringement signals are present", () => {
    const squatWithSignal = {
      ...base, url: "https://acmetools-outlet.test/x", snippet: "cheap replica",
    };
    const squatNoSignal = { ...base, url: "https://acmetools-outlet.test/x" };
    expect(priorScore(squatWithSignal, "social", "acmetools")).toBeGreaterThan(
      priorScore(squatNoSignal, "social", "acmetools"),
    );
  });
});
