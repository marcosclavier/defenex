import { describe, it, expect } from "vitest";
import { applyAllowlist, normalizeDomain, isSameOrSubdomain } from "../src/enrich/allowlist.js";
import type { ScanInput, SearchResult } from "@defenex/shared";

const input: ScanInput = {
  brand: "Acme Tools",
  domain: "acmetools.com",
  industry: "electronics",
  aliases: [],
  allowlistDomains: ["authorized-reseller.com"],
};

const result = (url: string): SearchResult => ({
  url,
  title: "t",
  snippet: "s",
  displayLink: "d",
  sourceQuery: "q",
});

describe("normalizeDomain", () => {
  it.each([
    ["https://WWW.Acme.com/path?x=1", "acme.com"],
    ["http://shop.acme.com:8080/", "shop.acme.com"],
    ["acme.com.", "acme.com"],
  ])("normalizes %s", (input_, expected) => {
    expect(normalizeDomain(input_)).toBe(expected);
  });
});

describe("isSameOrSubdomain", () => {
  it("matches subdomains but not lookalikes", () => {
    expect(isSameOrSubdomain("shop.acme.com", "acme.com")).toBe(true);
    expect(isSameOrSubdomain("acme.com", "acme.com")).toBe(true);
    // The critical case: notacme.com must NOT match acme.com.
    expect(isSameOrSubdomain("notacme.com", "acme.com")).toBe(false);
    expect(isSameOrSubdomain("acme.com.evil.net", "acme.com")).toBe(false);
  });
});

describe("applyAllowlist", () => {
  it("drops first-party, allowlisted, and reference sites", () => {
    const { kept, dropped } = applyAllowlist(
      [
        result("https://acmetools.com/products"),
        result("https://shop.acmetools.com/x"),
        result("https://authorized-reseller.com/acme"),
        result("https://en.wikipedia.org/wiki/Acme"),
        result("https://dhgate.com/replica-acme"),
      ],
      input,
    );

    expect(kept.map((k) => k.url)).toEqual(["https://dhgate.com/replica-acme"]);
    expect(dropped.map((d) => d.reason)).toEqual([
      "first_party",
      "first_party",
      "allowlisted",
      "reference_site",
    ]);
  });

  it("deduplicates the same URL surfaced by different queries", () => {
    const { kept, dropped } = applyAllowlist(
      [result("https://dhgate.com/x"), result("https://dhgate.com/x")],
      input,
    );
    expect(kept).toHaveLength(1);
    expect(dropped[0]?.reason).toBe("duplicate_url");
  });

  it("drops corporate SaaS portals that carry the brand name by design", () => {
    const { kept, dropped } = applyAllowlist(
      [
        result("https://acme.my.site.com/support"),
        result("https://acmecorp.wd5.myworkdayjobs.com/careers"),
        result("https://acme.greenhouse.io/jobs"),
      ],
      input,
    );
    expect(kept).toHaveLength(0);
    expect(dropped.every((d) => d.reason === "corporate_saas")).toBe(true);
  });

  it("keeps marketplaces — they host both genuine and counterfeit goods", () => {
    const { kept } = applyAllowlist([result("https://www.ebay.com/itm/123")], input);
    expect(kept).toHaveLength(1);
  });
});
