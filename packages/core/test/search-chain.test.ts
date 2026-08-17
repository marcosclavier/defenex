import { describe, it, expect, vi } from "vitest";
import { ChainedSearchProvider } from "../src/search/chain.js";
import { cacheKeyFor, legacyYepApiKey, CachedSearch } from "../src/search/cached.js";
import type { SearchOutcome, SearchProvider } from "../src/search/types.js";
import type { SearchResult } from "@defenex/shared";

const result = (url: string): SearchResult => ({
  url, title: "t", snippet: "s", displayLink: "x.example", sourceQuery: "q", resultType: "organic",
});

const outcome = (over: Partial<SearchOutcome> = {}): SearchOutcome => ({
  results: [result("https://a.example/")],
  callsSpent: 1,
  costMicros: 10_000,
  fromCache: false,
  ...over,
});

function provider(name: string, impl: () => Promise<SearchOutcome>): SearchProvider {
  return { name, search: impl };
}

describe("ChainedSearchProvider", () => {
  it("names itself after the order it tries", () => {
    expect(new ChainedSearchProvider([provider("yepapi", async () => outcome()), provider("serper", async () => outcome())]).name)
      .toBe("yepapi→serper");
  });

  it("refuses to be constructed empty", () => {
    expect(() => new ChainedSearchProvider([])).toThrow();
  });

  it("does not call the fallback when the primary answers", async () => {
    const second = vi.fn(async () => outcome());
    const chain = new ChainedSearchProvider([provider("yepapi", async () => outcome()), provider("serper", second)]);
    await chain.search("q");
    expect(second).not.toHaveBeenCalled();
  });

  /**
   * The property that matters most for cost. A narrow `site:` query finds
   * nothing most of the time, and that is the correct answer — treating it as
   * failure would buy a fallback call on the majority of queries the planner
   * generates.
   */
  it("treats an empty result set as success, not as failure", async () => {
    const second = vi.fn(async () => outcome());
    const chain = new ChainedSearchProvider([
      provider("yepapi", async () => outcome({ results: [] })),
      provider("serper", second),
    ]);
    const out = await chain.search("site:nowhere.example \"nothing\"");
    expect(out.results).toEqual([]);
    expect(second).not.toHaveBeenCalled();
  });

  it("falls through when the primary throws", async () => {
    const chain = new ChainedSearchProvider([
      provider("yepapi", async () => { throw new Error("502"); }),
      provider("serper", async () => outcome({ results: [result("https://fallback.example/")] })),
    ]);
    const out = await chain.search("q");
    expect(out.results[0]?.url).toBe("https://fallback.example/");
    expect(out.provider).toBe("serper");
  });

  it("records which provider answered", async () => {
    const chain = new ChainedSearchProvider([provider("yepapi", async () => outcome())]);
    expect((await chain.search("q")).provider).toBe("yepapi");
  });

  // Every attempt is billed whether or not it worked.
  it("accumulates cost and calls across hops", async () => {
    const chain = new ChainedSearchProvider([
      provider("yepapi", async () => { throw new Error("down"); }),
      provider("serper", async () => outcome({ callsSpent: 3, costMicros: 1_500 })),
    ]);
    const out = await chain.search("q");
    expect(out.callsSpent).toBe(3);
    expect(out.costMicros).toBe(1_500);
  });

  it("propagates the stale flag", async () => {
    const chain = new ChainedSearchProvider([provider("yepapi", async () => outcome({ stale: true, fromCache: true }))]);
    expect((await chain.search("q")).stale).toBe(true);
  });

  /**
   * Without the latch a dead primary is retried on every one of the fifteen
   * queries in a scan, each paying its full retry ladder before falling
   * through. This is the difference between one wasted query and fifteen.
   */
  it("stops calling a provider that keeps failing", async () => {
    const dead = vi.fn(async (): Promise<SearchOutcome> => { throw new Error("502"); });
    const chain = new ChainedSearchProvider(
      [provider("yepapi", dead), provider("serper", async () => outcome())],
      { failuresBeforeSkip: 2 },
    );
    for (let i = 0; i < 6; i++) await chain.search(`q${i}`);
    expect(dead).toHaveBeenCalledTimes(2);
  });

  it("clears the latch on a provider that recovers", async () => {
    let fail = true;
    const flaky = vi.fn(async (): Promise<SearchOutcome> => {
      if (fail) throw new Error("502");
      return outcome();
    });
    const chain = new ChainedSearchProvider(
      [provider("yepapi", flaky), provider("serper", async () => outcome())],
      { failuresBeforeSkip: 3 },
    );
    await chain.search("q1");
    fail = false;
    await chain.search("q2");
    await chain.search("q3");
    // Two failures never accumulated into a trip because a success reset it.
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  // A breaker set early in a run must not fail an entire scan outright.
  it("retries everything rather than giving up when all providers are tripped", async () => {
    let attempts = 0;
    const sometimes = vi.fn(async (): Promise<SearchOutcome> => {
      attempts += 1;
      if (attempts <= 2) throw new Error("502");
      return outcome();
    });
    const chain = new ChainedSearchProvider([provider("only", sometimes)], { failuresBeforeSkip: 1 });
    await expect(chain.search("q1")).rejects.toThrow();
    await expect(chain.search("q2")).rejects.toThrow();
    await expect(chain.search("q3")).resolves.toMatchObject({ provider: "only" });
  });

  it("reports every provider's reason when all fail", async () => {
    const chain = new ChainedSearchProvider([
      provider("yepapi", async () => { throw new Error("502"); }),
      provider("serper", async () => { throw new Error("402"); }),
    ]);
    await expect(chain.search("q")).rejects.toThrow(/yepapi: 502.*serper: 402/s);
  });
});

describe("CachedSearch", () => {
  function memory() {
    const store = new Map<string, { value: unknown; at: number }>();
    return {
      store,
      cache: {
        get: async (k: string) => store.get(k)?.value ?? null,
        set: async (k: string, v: unknown) => void store.set(k, { value: v, at: Date.now() }),
        getStale: async (k: string) => store.get(k)?.value ?? null,
      },
    };
  }

  it("keys on the question, not on who was asked", () => {
    // The whole point: a query cached under one provider is found under another.
    expect(cacheKeyFor("q", { depth: 50, gl: "us" })).toBe(cacheKeyFor("q", { depth: 50, gl: "US" }));
    expect(cacheKeyFor("q", { depth: 50 })).not.toBe(cacheKeyFor("q", { depth: 10 }));
    expect(cacheKeyFor("a", {})).not.toBe(cacheKeyFor("b", {}));
  });

  it("serves a repeat from cache without calling the provider", async () => {
    const { cache } = memory();
    const inner = vi.fn(async () => outcome());
    const cached = new CachedSearch(provider("yepapi", inner), { cache });
    await cached.search("q");
    const second = await cached.search("q");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(second.costMicros).toBe(0);
  });

  /**
   * The reason the cache moved out of the providers: during an outage a query
   * the primary cached yesterday must not be re-bought from the fallback.
   */
  it("reads rows written under the old provider-salted key", async () => {
    const { store, cache } = memory();
    const stored = [result("https://legacy.example/")];
    store.set(legacyYepApiKey("q", { depth: 50 }), { value: stored, at: Date.now() });

    const inner = vi.fn(async () => outcome());
    const out = await new CachedSearch(provider("serper", inner), { cache }).search("q", { depth: 50 });

    expect(inner).not.toHaveBeenCalled();
    expect(out.results).toEqual(stored);
    // Rewritten under the shared key so the legacy read happens once.
    expect(store.has(cacheKeyFor("q", { depth: 50 }))).toBe(true);
  });

  it("serves stale cache when every provider is down", async () => {
    const { store, cache } = memory();
    const stored = [result("https://old.example/")];
    store.set(cacheKeyFor("q", {}), { value: stored, at: 0 });

    const cached = new CachedSearch(
      provider("chain", async () => { throw new Error("all providers failed"); }),
      { cache: { ...cache, get: async () => null } },
    );
    const out = await cached.search("q");
    expect(out.stale).toBe(true);
    expect(out.results).toEqual(stored);
    expect(out.costMicros).toBe(0);
  });

  it("rethrows when everything is down and nothing is cached", async () => {
    const cached = new CachedSearch(provider("chain", async () => { throw new Error("boom"); }), {
      cache: { get: async () => null, set: async () => {}, getStale: async () => null },
    });
    await expect(cached.search("q")).rejects.toThrow(/boom/);
  });

  it("never reaches for stale cache on the happy path", async () => {
    const getStale = vi.fn(async () => null);
    const cached = new CachedSearch(provider("yepapi", async () => outcome()), {
      cache: { get: async () => null, set: async () => {}, getStale },
    });
    await cached.search("q");
    expect(getStale).not.toHaveBeenCalled();
  });

  // Results already paid for must not be lost to a cache problem.
  it("returns results even when the cache write fails", async () => {
    const cached = new CachedSearch(provider("yepapi", async () => outcome()), {
      cache: { get: async () => null, set: async () => { throw new Error("disk full"); } },
    });
    await expect(cached.search("q")).resolves.toMatchObject({ fromCache: false });
  });
});
