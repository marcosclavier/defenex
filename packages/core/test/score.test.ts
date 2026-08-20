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

describe("priorScore — candidate selection regressions", () => {
  const base: SearchResult = {
    url: "https://shop.test/x", title: "", snippet: "",
    displayLink: "", sourceQuery: "q",
  };

  it("does not treat an unrelated company's login page as credential harvest", () => {
    // A YETI scan spent eight of forty fetch slots on the login pages of
    // yetiairlines.com, yeticycles.com, checkyeti.com and importyeti.com. Each
    // one only matched because the brand is a substring of an unrelated
    // company's name and `/login` is ordinary furniture on any company site.
    const offBrand = { ...base, url: "https://yetiairlines.test/login" };
    const listing = { ...base, url: "https://dhgate.test/wholesale/yeti-cooler", snippet: "replica" };
    expect(priorScore(listing, "marketplace", "yeti")).toBeGreaterThan(
      priorScore(offBrand, "domain_abuse", "yeti"),
    );
  });

  it("still ranks a lookalike whose hostname carries the auth word", () => {
    // yeti-login.webflow.io: a real phishing page and the highest-severity
    // finding of the gate. The tightening above must not cost us this.
    const phish = { ...base, url: "https://yeti-login.webflow.io/" };
    const offBrand = { ...base, url: "https://yetiairlines.test/login" };
    expect(priorScore(phish, "domain_abuse", "yeti")).toBeGreaterThan(
      priorScore(offBrand, "domain_abuse", "yeti") + 30,
    );
  });

  it("ranks a brand-named page on free hosting that asks for a password", () => {
    // The lookalike does not have to encode the word when the domain was never
    // the brand's: acmestore.webflow.io/signin is the same attack.
    const onDisposable = { ...base, url: "https://acmestore.webflow.io/signin" };
    const onOwnDomain = { ...base, url: "https://acmestore.test/signin" };
    expect(priorScore(onDisposable, "domain_abuse", "acme")).toBeGreaterThan(
      priorScore(onOwnDomain, "domain_abuse", "acme"),
    );
  });

  it("ranks a page selling fakes above one writing about them", () => {
    // Commentary uses the vocabulary more explicitly than sellers do, so it
    // outranked the real thing: nine of forty fetched YETI pages were articles,
    // forum threads and videos about counterfeits, all classified LEGITIMATE.
    const selling = {
      ...base, url: "https://dhgate.test/wholesale/acme-cooler",
      title: "Acme Cooler Wholesale", snippet: "replica acme cooler in bulk",
    };
    for (const commentary of [
      { title: "How to spot a fake Acme cooler", snippet: "" },
      { title: "Real vs fake Acme: we tested both", snippet: "" },
      { title: "Acme is accusing two residents of selling counterfeits", snippet: "" },
      { title: "Recruitment scam warning", snippet: "" },
    ]) {
      const page = { ...base, url: "https://dhgate.test/wholesale/acme-cooler", ...commentary };
      expect(priorScore(selling, "marketplace", "Acme")).toBeGreaterThan(
        priorScore(page, "marketplace", "Acme"),
      );
    }
  });

  it("demotes discussion surfaces even on an enforceable marketplace host", () => {
    // community.ebay.com threads took three slots and yielded nothing: eBay's
    // forum is people asking about fakes, not anyone selling them.
    const thread = { ...base, url: "https://community.ebay.com/t5/Ask-a-Mentor/Fake-Acme/td-p/1" };
    const listing = { ...base, url: "https://www.ebay.com/itm/226150735475" };
    expect(priorScore(listing, "marketplace", "Acme")).toBeGreaterThan(
      priorScore(thread, "marketplace", "Acme"),
    );
  });

  it("reads commentary out of the URL path when the snippet is empty", () => {
    const inPath = { ...base, url: "https://tiktok.test/discover/how-to-know-if-my-acme-cooler-is-fake" };
    const plain = { ...base, url: "https://tiktok.test/@seller/video/7342016435155209473" };
    expect(priorScore(plain, "social", "Acme")).toBeGreaterThan(priorScore(inPath, "social", "Acme"));
  });
});

describe("priorScore — malformed input", () => {
  const base: SearchResult = {
    url: "https://shop.test/x", title: "", snippet: "",
    displayLink: "", sourceQuery: "q",
  };

  it("survives a URL path with a malformed percent escape", () => {
    // decodeURIComponent throws on these, and this runs over every search
    // result: one bad URL in five hundred would fail the whole scan.
    expect(() => priorScore({ ...base, url: "https://shop.test/100%-yeti" }, "marketplace", "yeti"))
      .not.toThrow();
  });

  it("survives a url that is not a URL at all", () => {
    expect(() => priorScore({ ...base, url: "not a url" }, "marketplace", "acme")).not.toThrow();
  });
});
