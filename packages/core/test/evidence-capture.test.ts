import { describe, it, expect, vi } from "vitest";
import type { Browser } from "playwright";
import { capturePage, artifactOf, jsonArtifact, sha256Of, withBaseHref } from "../src/evidence/capture.js";

/** A browser that explodes if touched — the guard must refuse before this matters. */
const unusableBrowser = {
  newContext: () => {
    throw new Error("browser must not be reached for a blocked url");
  },
} as unknown as Browser;

describe("capturePage SSRF guard", () => {
  // Takedowns can be requested for any finding, and findings come from the open
  // web. The guard has to hold here as well as in the scanner, and it has to
  // hold for every fetch route rather than only the browser.
  it.each([
    ["http://127.0.0.1:8080/admin"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://10.0.0.5/internal"],
    ["http://[::1]/"],
    ["file:///etc/passwd"],
  ])("refuses %s before opening a browser context", async (url) => {
    const result = await capturePage({ url, browser: unusableBrowser });
    expect(result.ok).toBe(false);
    expect(result.failure).toBeTruthy();
    expect(result.artifacts).toEqual([]);
  });

  it("reports the capture time even when the url is refused", async () => {
    const before = Date.now();
    const result = await capturePage({ url: "http://127.0.0.1/", browser: unusableBrowser });
    expect(new Date(result.capturedAt).getTime()).toBeGreaterThanOrEqual(before - 1);
  });

  it("logs the refusal rather than swallowing it", async () => {
    const warn = vi.fn();
    await capturePage({
      url: "http://169.254.169.254/",
      browser: unusableBrowser,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(warn).toHaveBeenCalledWith("evidence url blocked", expect.objectContaining({ url: "http://169.254.169.254/" }));
  });
});

describe("artifact hashing", () => {
  it("hashes the exact bytes archived", () => {
    const bytes = Buffer.from("evidence");
    const a = artifactOf("page.txt", "text/plain", bytes);
    expect(a.sha256).toBe(sha256Of(bytes));
    expect(a.bytes).toBe(bytes);
  });

  it("serialises json artifacts deterministically", () => {
    const a = jsonArtifact("x.json", { b: 1, a: 2 });
    const b = jsonArtifact("x.json", { b: 1, a: 2 });
    expect(a.sha256).toBe(b.sha256);
    // Key order is part of the bytes, so a reordered object is a different artifact.
    expect(jsonArtifact("x.json", { a: 2, b: 1 }).sha256).not.toBe(a.sha256);
  });
});

describe("withBaseHref", () => {
  // Without this the page's relative asset URLs resolve to nothing and the
  // screenshot is an unstyled skeleton.
  it("points relative assets back at the origin", () => {
    const out = withBaseHref("<html><head><meta charset=utf-8></head><body>x</body></html>", "https://www.dhgate.com/a/b.html");
    expect(out).toContain('<base href="https://www.dhgate.com/">');
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<meta"));
  });

  it("copes with a head that carries attributes", () => {
    expect(withBaseHref('<html><head lang="en">x</head>', "https://a.example/")).toContain('<head lang="en"><base');
  });

  it("still emits a base when the document has no head", () => {
    expect(withBaseHref("<body>x</body>", "https://a.example/p")).toMatch(/^<base href="https:\/\/a\.example\/">/);
  });

  it("leaves the markup alone when the URL is unparseable", () => {
    expect(withBaseHref("<html>x</html>", "not a url")).toBe("<html>x</html>");
  });
});

describe("capturePage proxy fallback", () => {
  const provider = (over: Partial<{ statusCode: number; text: string; html: string }> = {}) => ({
    name: "test-proxy",
    scrape: async () => ({
      statusCode: 200,
      text: "x".repeat(400),
      title: "Listing",
      finalUrl: "https://blocked.example/item",
      costMicros: 700,
      html: "<html><head><title>Listing</title></head><body>ok</body></html>",
      ...over,
    }),
  });

  // The guard runs before either tier, so a refused URL must not reach the
  // proxy either — otherwise the fallback is an SSRF bypass.
  it("never reaches the proxy for a blocked url", async () => {
    let called = false;
    const result = await capturePage({
      url: "http://169.254.169.254/latest/meta-data/",
      browser: unusableBrowser,
      scraper: {
        name: "test-proxy",
        scrape: async () => {
          called = true;
          throw new Error("must not be called");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it.each([
    ["http://127.0.0.1/x"],
    ["http://10.0.0.5/internal"],
    ["http://169.254.169.254/latest/meta-data/"],
  ])("refuses %s by every route, not merely the browser", async (url) => {
    let proxied = false;
    const result = await capturePage({
      url,
      browser: unusableBrowser,
      scraper: {
        name: "test-proxy",
        scrape: async () => {
          proxied = true;
          throw new Error("must not be called");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(proxied).toBe(false);
    expect(result.artifacts).toEqual([]);
  });
});
