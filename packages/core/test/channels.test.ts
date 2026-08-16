import { describe, it, expect } from "vitest";
import { resolveChannel, noticeKindFor, knownPlatforms } from "../src/takedown/channels.js";

describe("noticeKindFor", () => {
  // The distinction the whole notice rests on: the DMCA is copyright law, and
  // a counterfeit cooler has no §512 hook at all.
  it.each([
    ["COUNTERFEIT", "trademark"],
    ["TRADEMARK_MISUSE", "trademark"],
    ["IMPERSONATION", "trademark"],
    ["DOMAIN_SQUAT", "trademark"],
    ["UNAUTHORIZED_RESALE", "trademark"],
    ["PIRACY", "copyright"],
    ["PHISHING", "phishing_abuse"],
  ] as const)("%s is a %s matter", (category, kind) => {
    expect(noticeKindFor(category)).toBe(kind);
  });

  it("never routes a counterfeit through copyright", () => {
    expect(noticeKindFor("COUNTERFEIT")).not.toBe("copyright");
  });
});

const rdap = {
  registrarAbuseEmail: "abuse@registrar.example",
  registrarName: "Example Registrar",
  hostAbuseEmail: "abuse@host.example",
  hostOperator: "Example Hosting",
};

describe("resolveChannel — marketplaces", () => {
  it.each([
    ["https://www.amazon.com/dp/B08XYZ", "amazon"],
    ["https://www.ebay.co.uk/itm/12345", "ebay_vero"],
    ["https://www.aliexpress.com/item/1005.html", "alibaba_ipp"],
    ["https://www.dhgate.com/wholesale/replica+yeti+cooler.html", "dhgate"],
    ["https://www.etsy.com/listing/999", "etsy"],
    ["https://coolerstore.myshopify.com/products/x", "shopify"],
    ["https://www.instagram.com/fakebrand", "meta"],
    ["https://www.tiktok.com/@fake/video/1", "tiktok"],
  ])("%s routes to %s", (url, channel) => {
    const decision = resolveChannel({ url, category: "COUNTERFEIT", ...rdap });
    expect(decision.channel).toBe(channel);
    expect(decision.method).toBe("portal");
    expect(decision.destination).toMatch(/^https:\/\//);
  });

  // The host of a marketplace is a datacentre that will not remove one product
  // page, and its registrar can only suspend the whole of amazon.com.
  it("prefers the marketplace over the host even when both are known", () => {
    const decision = resolveChannel({ url: "https://www.amazon.com/dp/B1", category: "COUNTERFEIT", ...rdap });
    expect(decision.channel).toBe("amazon");
    expect(decision.rationale).toContain("only party that can remove it");
  });

  it("matches subdomains of a platform", () => {
    expect(resolveChannel({ url: "https://smile.amazon.com/dp/B1", category: "COUNTERFEIT" }).channel).toBe("amazon");
  });

  it("does not match a lookalike domain that merely contains the name", () => {
    const decision = resolveChannel({ url: "https://amazon-deals.example.com/x", category: "COUNTERFEIT", ...rdap });
    expect(decision.channel).not.toBe("amazon");
  });

  it("flags a portal that does not take this kind of report", () => {
    const decision = resolveChannel({ url: "https://www.etsy.com/listing/1", category: "PHISHING" });
    expect(decision.blockers.join(" ")).toContain("does not accept");
  });
});

describe("resolveChannel — hosts and registrars", () => {
  it("asks the host first for page-level infringement", () => {
    const decision = resolveChannel({ url: "https://fakestore.example/x", category: "COUNTERFEIT", ...rdap });
    expect(decision.channel).toBe("host_abuse");
    expect(decision.destination).toBe("abuse@host.example");
    expect(decision.method).toBe("email");
    // The registrar is the escalation, not the first stop.
    expect(decision.alternatives[0]?.channel).toBe("registrar_abuse");
  });

  // A squatted domain is the domain; only the registrar can suspend it.
  it.each([["DOMAIN_SQUAT"], ["PHISHING"]] as const)("asks the registrar first for %s", (category) => {
    const decision = resolveChannel({ url: "https://yeti-outlet.example/", category, ...rdap });
    expect(decision.channel).toBe("registrar_abuse");
    expect(decision.destination).toBe("abuse@registrar.example");
  });

  it("falls back to whichever contact exists", () => {
    const hostOnly = resolveChannel({ url: "https://x.example/", category: "DOMAIN_SQUAT", hostAbuseEmail: "a@h.example" });
    expect(hostOnly.channel).toBe("host_abuse");
  });

  // Unroutable is a state for a human to resolve, never a reason to guess.
  it("refuses to invent a recipient when RDAP published none", () => {
    const decision = resolveChannel({ url: "https://x.example/", category: "COUNTERFEIT" });
    expect(decision.channel).toBe("manual");
    expect(decision.destination).toBeNull();
    expect(decision.blockers).toHaveLength(1);
  });

  it("always offers search delisting as an additional route", () => {
    for (const category of ["COUNTERFEIT", "PIRACY", "PHISHING"] as const) {
      const decision = resolveChannel({ url: "https://x.example/", category, ...rdap });
      const delist = decision.alternatives.find((a) => a.channel === "google_delist");
      expect(delist?.destination).toMatch(/^https:\/\//);
    }
  });

  it("points piracy and trademark at different Google forms", () => {
    const copyright = resolveChannel({ url: "https://x.example/", category: "PIRACY", ...rdap });
    const trademark = resolveChannel({ url: "https://x.example/", category: "COUNTERFEIT", ...rdap });
    const a = copyright.alternatives.find((r) => r.channel === "google_delist")?.destination;
    const b = trademark.alternatives.find((r) => r.channel === "google_delist")?.destination;
    expect(a).not.toBe(b);
  });
});

describe("platform registry", () => {
  it("gives every platform a portal URL", () => {
    for (const p of knownPlatforms()) expect(p.portal).toMatch(/^https:\/\//);
  });
});
