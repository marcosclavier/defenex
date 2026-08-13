import { describe, it, expect } from "vitest";
import { urlHashOf } from "../src/url.js";

describe("urlHashOf", () => {
  it("treats tracking-parameter variants as the same finding", () => {
    // Marketplaces append srsltid/utm on every visit. Without normalization a
    // weekly rescan would report the same listing as new, forever.
    const base = "https://dhgate.com/product/fake-thing.html";
    const tracked = "https://dhgate.com/product/fake-thing.html?srsltid=AfmBOoq123&utm_source=google";
    expect(urlHashOf(tracked)).toBe(urlHashOf(base));
  });

  it.each([
    ["https://shop.test/x", "https://www.shop.test/x", "www prefix"],
    ["https://shop.test/x", "https://shop.test/x#reviews", "fragment"],
    ["https://shop.test/x", "https://SHOP.TEST/x", "host case"],
    ["https://shop.test/x", "https://shop.test/x/", "trailing slash"],
  ])("ignores %s vs %s (%s)", (a, b) => {
    expect(urlHashOf(a)).toBe(urlHashOf(b));
  });

  it("keeps meaningful query parameters distinct", () => {
    // skuId selects a different product; collapsing these would merge findings.
    expect(urlHashOf("https://dhgate.com/p.html?skuId=1")).not.toBe(
      urlHashOf("https://dhgate.com/p.html?skuId=2"),
    );
  });

  it("distinguishes different paths and hosts", () => {
    expect(urlHashOf("https://a.test/x")).not.toBe(urlHashOf("https://b.test/x"));
    expect(urlHashOf("https://a.test/x")).not.toBe(urlHashOf("https://a.test/y"));
  });

  it("does not throw on malformed input", () => {
    expect(() => urlHashOf("not a url")).not.toThrow();
    expect(urlHashOf("not a url")).toHaveLength(64);
  });
});
