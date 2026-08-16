import { describe, it, expect } from "vitest";
import { SpiderScraper, parseSpiderResponse } from "../src/enrich/spider.js";
import { SearchConfigError } from "../src/errors.js";

/** The shape observed from the live API against the DHgate listing. */
const row = (over: Record<string, unknown> = {}) => ({
  url: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
  status: 200,
  error: null,
  content: "<html><head><title>Replica Yeti Cooler | DHgate</title></head><body><p>Wholesale replica yeti cooler, factory direct.</p></body></html>",
  costs: { total_cost: 0.000689 },
  ...over,
});

describe("parseSpiderResponse", () => {
  it("reads the array form the API actually returns", () => {
    const r = parseSpiderResponse([row()], "https://x.example/");
    expect(r.statusCode).toBe(200);
    expect(r.title).toBe("Replica Yeti Cooler | DHgate");
    expect(r.text).toContain("Wholesale replica yeti cooler");
    expect(r.finalUrl).toContain("dhgate.com");
  });

  it("also accepts a bare object", () => {
    expect(parseSpiderResponse(row(), "https://x.example/").statusCode).toBe(200);
  });

  // The raw HTML is what the evidence path renders; a text-only result could
  // not produce a screenshot.
  it("keeps the HTML for the evidence path", () => {
    expect(parseSpiderResponse([row()], "https://x.example/").html).toContain("<title>");
  });

  // Reporting an average would make the spend circuit breaker a guess.
  it("reports the real per-call cost in micros", () => {
    expect(parseSpiderResponse([row()], "https://x.example/").costMicros).toBe(689);
  });

  it("falls back to a nominal cost when the breakdown is absent", () => {
    const r = parseSpiderResponse([row({ costs: undefined })], "https://x.example/");
    expect(r.costMicros).toBeGreaterThan(0);
  });

  it("never reports a zero cost for a call that was billed", () => {
    expect(parseSpiderResponse([row({ costs: { total_cost: 1e-9 } })], "https://x.example/").costMicros)
      .toBeGreaterThanOrEqual(1);
  });

  // Observed live: the screenshot route answers 200 with an error field and no
  // bytes. A 200 is not success.
  it("throws when the row carries an error despite a 200", () => {
    expect(() =>
      parseSpiderResponse([row({ error: "screenshot route produced no image bytes" })], "https://x.example/"),
    ).toThrow(/screenshot route/);
  });

  it("throws on an empty body rather than returning a blank page", () => {
    expect(() => parseSpiderResponse([row({ content: "" })], "https://x.example/")).toThrow(/no content/);
    expect(() => parseSpiderResponse([], "https://x.example/")).toThrow(/no content/);
  });

  it("falls back to the requested URL when the response omits one", () => {
    expect(parseSpiderResponse([row({ url: undefined })], "https://x.example/y").finalUrl).toBe(
      "https://x.example/y",
    );
  });
});

describe("SpiderScraper", () => {
  const scraper = (fetchImpl: typeof fetch) => new SpiderScraper({ apiKey: "k", fetchImpl });

  it("refuses to construct without a key", () => {
    expect(() => new SpiderScraper({ apiKey: "" })).toThrow(SearchConfigError);
  });

  it("asks for raw HTML, so extraction stays identical to the tier it replaces", async () => {
    let sentBody: Record<string, unknown> = {};
    let sentAuth = "";
    await scraper(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      sentAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([row()]);
    }).scrape("https://x.example/");

    expect(sentBody.return_format).toBe("raw");
    expect(sentBody.url).toBe("https://x.example/");
    expect(sentAuth).toBe("Bearer k");
  });

  // Neither a bad key nor an empty balance improves on the next attempt.
  it.each([[401], [403], [402]])("fails fast on %i rather than retrying", async (status) => {
    const s = scraper(async () => new Response("nope", { status }));
    await expect(s.scrape("https://x.example/")).rejects.toBeInstanceOf(SearchConfigError);
  });

  it("throws a retryable error on a server fault", async () => {
    const s = scraper(async () => new Response("boom", { status: 503 }));
    await expect(s.scrape("https://x.example/")).rejects.not.toBeInstanceOf(SearchConfigError);
  });

  it("identifies itself for cost reporting", () => {
    expect(scraper(async () => Response.json([row()])).name).toBe("spider");
  });
});
