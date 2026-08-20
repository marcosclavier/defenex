import { describe, it, expect, vi } from "vitest";
import { ChainedScraper } from "../src/enrich/chain.js";
import { bodyCharsOf, isUsableScrape } from "../src/enrich/scrape.js";
import { SearchConfigError } from "../src/errors.js";
import type { ScrapeProvider, ScrapeResult } from "../src/enrich/scrape.js";

const good = (over: Partial<ScrapeResult> = {}): ScrapeResult => ({
  statusCode: 200,
  text: "x".repeat(500),
  title: "Listing",
  finalUrl: "https://x.example/",
  costMicros: 700,
  ...over,
});

function provider(name: string, impl: () => Promise<ScrapeResult>): ScrapeProvider {
  return { name, scrape: impl };
}

describe("isUsableScrape", () => {
  it("accepts a real page", () => {
    expect(isUsableScrape(good())).toBe(true);
  });

  // Anti-bot systems answer 200 with an interstitial, so length is as much a
  // signal as status.
  it.each([
    [good({ statusCode: 403 }), "an error status"],
    [good({ statusCode: 404 }), "a missing page"],
    [good({ text: "short" }), "an interstitial with almost no text"],
  ])("rejects %#: %s", (result) => {
    expect(isUsableScrape(result)).toBe(false);
  });
});

describe("ChainedScraper", () => {
  it("names itself after the order it tries", () => {
    const chain = new ChainedScraper([provider("spider", async () => good()), provider("yepapi", async () => good())]);
    expect(chain.name).toBe("spider→yepapi");
  });

  it("refuses to be constructed empty", () => {
    expect(() => new ChainedScraper([])).toThrow();
  });

  // The whole point of the ordering: the expensive provider must not run when
  // the cheap one already read the page.
  it("stops at the first provider that works", async () => {
    const second = vi.fn(async () => good());
    const chain = new ChainedScraper([provider("spider", async () => good()), provider("yepapi", second)]);
    const out = await chain.scrape("https://x.example/");
    expect(second).not.toHaveBeenCalled();
    expect(out.costMicros).toBe(700);
  });

  // Measured against Etsy: spider returns a 403 where YepAPI reads the page.
  it("falls through when the first is defeated by a 403", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ statusCode: 403, text: "", costMicros: 700 })),
      provider("yepapi", async () => good({ text: "y".repeat(900), costMicros: 30_000 })),
    ]);
    const out = await chain.scrape("https://etsy.example/");
    expect(out.text.length).toBe(900);
  });

  it("falls through on a thin body as well as an error status", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ text: "blocked" })),
      provider("yepapi", async () => good({ text: "y".repeat(900) })),
    ]);
    expect((await chain.scrape("https://x.example/")).text.length).toBe(900);
  });

  // Every attempt is billed whether or not it worked.
  it("reports what the whole chain cost, not just the winning hop", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ statusCode: 403, text: "", costMicros: 700 })),
      provider("yepapi", async () => good({ costMicros: 30_000 })),
    ]);
    expect((await chain.scrape("https://x.example/")).costMicros).toBe(30_700);
  });

  // One provider being unusable must not take the tier down with it.
  it.each([
    [new SearchConfigError("spider out of credit (402)")],
    [new Error("network unreachable")],
  ])("falls through when the first throws (%s)", async (err) => {
    const chain = new ChainedScraper([
      provider("spider", async () => {
        throw err;
      }),
      provider("yepapi", async () => good()),
    ]);
    await expect(chain.scrape("https://x.example/")).resolves.toMatchObject({ statusCode: 200 });
  });

  it("reports every provider's reason when they all fail", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ statusCode: 403, text: "" })),
      provider("yepapi", async () => {
        throw new Error("boom");
      }),
    ]);
    await expect(chain.scrape("https://x.example/")).rejects.toThrow(/spider: status 403.*yepapi: boom/s);
  });

  // Spider answers in seconds when it can read a page and spends thirty-odd
  // failing; an unbounded first hop makes every fallback pay that wait.
  it("caps the first hop so a slow failure does not eat the fallback's time", async () => {
    vi.useFakeTimers();
    const chain = new ChainedScraper(
      [
        provider("slow", () => new Promise<ScrapeResult>(() => {})),
        provider("yepapi", async () => good({ text: "y".repeat(900) })),
      ],
      { firstHopTimeoutMs: 1_000 },
    );
    const pending = chain.scrape("https://x.example/");
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toMatchObject({ text: "y".repeat(900) });
    vi.useRealTimers();
  });

  // The last provider gets the time it needs; there is nothing to fall back to.
  it("does not cap the final provider", async () => {
    vi.useFakeTimers();
    const chain = new ChainedScraper(
      [
        provider("only", async () => {
          await new Promise((r) => setTimeout(r, 5_000));
          return good();
        }),
      ],
      { firstHopTimeoutMs: 100 },
    );
    const pending = chain.scrape("https://x.example/");
    await vi.advanceTimersByTimeAsync(5_100);
    await expect(pending).resolves.toMatchObject({ statusCode: 200 });
    vi.useRealTimers();
  });
});

describe("ChainedScraper — partial reads", () => {
  it("returns the best partial rather than discarding it when nobody read the page", async () => {
    // A client-rendered AliExpress listing answers 200 with no body and an
    // og:title naming the product. Throwing here reported the fetch as failed
    // and threw away the one line that says what is being sold.
    const chain = new ChainedScraper([
      provider("spider", async () => good({ text: "Replica Acme Cooler 20oz", bodyChars: 0 })),
      provider("yepapi", async () => {
        throw new Error("aborted");
      }),
    ]);
    const out = await chain.scrape("https://x.example/");
    expect(out.text).toBe("Replica Acme Cooler 20oz");
    // Still not a page we saw, and the caller can tell.
    expect(isUsableScrape(out)).toBe(false);
  });

  it("bills every hop on a partial read too", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ text: "short", bodyChars: 0, costMicros: 700 })),
      provider("yepapi", async () => good({ text: "shorter", bodyChars: 0, costMicros: 30_000 })),
    ]);
    expect((await chain.scrape("https://x.example/")).costMicros).toBe(30_700);
  });

  it("prefers the fullest partial", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ text: "short", bodyChars: 0 })),
      provider("yepapi", async () => good({ text: "a rather longer partial", bodyChars: 0 })),
    ]);
    expect((await chain.scrape("https://x.example/")).text).toBe("a rather longer partial");
  });

  it("still throws when there is nothing to return", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ statusCode: 403, text: "" })),
      provider("yepapi", async () => good({ statusCode: 503, text: "" })),
    ]);
    await expect(chain.scrape("https://x.example/")).rejects.toThrow(/every paid provider failed/);
  });

  it("does not offer an error page as a partial read", async () => {
    const chain = new ChainedScraper([
      provider("spider", async () => good({ statusCode: 403, text: "Access Denied. Request blocked." })),
      provider("yepapi", async () => {
        throw new Error("boom");
      }),
    ]);
    await expect(chain.scrape("https://x.example/")).rejects.toThrow(/every paid provider failed/);
  });
});

describe("bodyCharsOf", () => {
  it("reports document text, not the metadata padded onto it", () => {
    // What the evidence capture measures before it will build a bundle. An
    // og:title is enough to classify a listing and not enough to swear we saw
    // the page, so the two counts have to stay separable.
    expect(bodyCharsOf(good({ text: "x".repeat(500), bodyChars: 12 }))).toBe(12);
  });

  it("counts the whole text when a provider does not distinguish", () => {
    expect(bodyCharsOf(good({ text: "x".repeat(40) }))).toBe(40);
  });
});
