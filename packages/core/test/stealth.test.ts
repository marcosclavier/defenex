import { describe, it, expect, vi } from "vitest";
import { StealthScraper } from "../src/enrich/stealth.js";
import { SearchConfigError } from "../src/errors.js";

const scraper = (fetchImpl: typeof fetch) =>
  new StealthScraper({ apiKey: "k", fetchImpl });

const body = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, data }), { status });

describe("StealthScraper", () => {
  it("returns cleaned text, title and the per-call cost", async () => {
    const s = scraper(
      vi.fn(async () =>
        body({
          url: "https://x.test/final",
          statusCode: 200,
          content: "<html><head><title>Replica Shop</title></head><body><p>AAA quality replica goods</p></body></html>",
        }),
      ) as unknown as typeof fetch,
    );

    const out = await s.scrape("https://x.test/");
    expect(out.title).toBe("Replica Shop");
    expect(out.text).toContain("AAA quality replica goods");
    expect(out.text).not.toContain("<p>");
    expect(out.finalUrl).toBe("https://x.test/final");
    expect(out.costMicros).toBe(30_000); // $0.03
  });

  it("strips markup even though markdown was requested", async () => {
    // The vendor accepts format:"markdown" but was observed returning HTML,
    // so conversion must not be delegated.
    const s = scraper(
      vi.fn(async () => body({ statusCode: 200, content: "<div><b>bold</b> text</div>" })) as unknown as typeof fetch,
    );
    expect((await s.scrape("https://x.test/")).text).toBe("bold text");
  });

  it("fails fast on credential and credit errors", async () => {
    for (const status of [401, 403, 402]) {
      const spy = vi.fn(async () => new Response("nope", { status }));
      await expect(scraper(spy as unknown as typeof fetch).scrape("https://x.test/")).rejects.toBeInstanceOf(
        SearchConfigError,
      );
    }
  });

  it("requires an API key", () => {
    expect(() => new StealthScraper({ apiKey: "" })).toThrow(SearchConfigError);
  });
});
