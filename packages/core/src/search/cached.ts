import { createHash } from "node:crypto";
import { SEARCH_CACHE_TTL_MS, SEARCH_STALE_TTL_MS, type SearchResult } from "@defenex/shared";
import { MemoryCache, silentLogger, type CacheStore, type Logger } from "../ports.js";
import type { SearchOptions, SearchOutcome, SearchProvider } from "./types.js";

/**
 * Caching for the whole search tier, in front of whichever provider answers.
 *
 * It used to live inside each provider, salted with that provider's name. That
 * made the cache useless as an outage buffer, which is exactly when it is worth
 * most: a query the primary cached yesterday would miss under the fallback's
 * key today, and we would pay a second vendor for an answer already on disk.
 * Keyed on the question rather than on who was asked, a warm cache carries the
 * scan through the outage on its own.
 *
 * It is safe to share because the providers are deliberately the same index —
 * a Google SERP is a Google SERP regardless of which reseller fetched it.
 * Introducing a provider with a *different* index would break that assumption
 * and would need its own namespace.
 */
export interface CachedSearchOptions {
  cache?: CacheStore;
  ttlMs?: number;
  staleTtlMs?: number;
  logger?: Logger;
  /**
   * Read the pre-shared-cache key layout on a miss.
   *
   * Existing rows are salted `{p:"yepapi", …}` and would otherwise be
   * unreachable, so the cache would go cold for a week at the worst possible
   * moment. Removable once the normal TTL has turned over.
   */
  readLegacyYepApiKey?: boolean;
}

export class CachedSearch implements SearchProvider {
  readonly name: string;
  private readonly cache: CacheStore;
  private readonly ttlMs: number;
  private readonly staleTtlMs: number;
  private readonly log: Logger;
  private readonly readLegacy: boolean;

  constructor(
    private readonly inner: SearchProvider,
    opts: CachedSearchOptions = {},
  ) {
    this.name = inner.name;
    this.ttlMs = opts.ttlMs ?? SEARCH_CACHE_TTL_MS;
    this.staleTtlMs = opts.staleTtlMs ?? SEARCH_STALE_TTL_MS;
    this.cache = opts.cache ?? new MemoryCache(this.ttlMs);
    this.log = opts.logger ?? silentLogger;
    this.readLegacy = opts.readLegacyYepApiKey ?? true;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const key = cacheKeyFor(query, opts);

    const fresh = await this.cache.get(key).catch(() => null);
    if (fresh) {
      this.log.debug("search cache hit", { query });
      return { results: fresh as SearchResult[], callsSpent: 0, costMicros: 0, fromCache: true };
    }

    const legacy = this.readLegacy ? await this.readLegacyKey(query, opts) : null;
    if (legacy) {
      this.log.debug("search cache hit (legacy key)", { query });
      // Rewritten under the shared key so the legacy read is needed once only.
      await this.cache.set(key, legacy).catch(() => {});
      return { results: legacy, callsSpent: 0, costMicros: 0, fromCache: true };
    }

    try {
      const outcome = await this.inner.search(query, opts);
      await this.cache.set(key, outcome.results).catch((err: unknown) => {
        // A cache write failing must not lose results we have already paid for.
        this.log.warn("search cache write failed", { query, error: String(err) });
      });
      return outcome;
    } catch (err) {
      /**
       * Every provider is unreachable. A cached SERP past its TTL is a far
       * better answer than none: infringing listings persist for weeks, so most
       * of a month-old result set is still true, and the alternative is telling
       * a customer we found nothing when we could not look.
       */
      const stale = await this.readStale(key, query, opts);
      if (stale) {
        this.log.warn("search failed; serving stale cache", {
          query,
          error: err instanceof Error ? err.message : String(err),
        });
        return { results: stale, callsSpent: 0, costMicros: 0, fromCache: true, stale: true };
      }
      throw err;
    }
  }

  private async readStale(
    key: string,
    query: string,
    opts: SearchOptions,
  ): Promise<SearchResult[] | null> {
    if (!this.cache.getStale) return null;
    try {
      const hit = (await this.cache.getStale(key, this.staleTtlMs)) as SearchResult[] | null;
      if (hit) return hit;
      if (!this.readLegacy) return null;
      return (await this.cache.getStale(
        legacyYepApiKey(query, opts),
        this.staleTtlMs,
      )) as SearchResult[] | null;
    } catch {
      // The cache being unavailable too is not a reason to lose the real error.
      return null;
    }
  }

  private async readLegacyKey(query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
    try {
      return (await this.cache.get(legacyYepApiKey(query, opts))) as SearchResult[] | null;
    } catch {
      return null;
    }
  }
}

/** Keyed on the question, not on who was asked. */
export function cacheKeyFor(query: string, opts: SearchOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        query,
        depth: opts.depth ?? null,
        gl: opts.gl?.toLowerCase() ?? null,
        language: opts.language ?? null,
      }),
    )
    .digest("hex");
}

/**
 * The layout in use before the cache was shared. Reproduced exactly, including
 * the location-code mapping, or the rows it is meant to reach stay unreachable.
 */
const LEGACY_LOCATION_CODES: Record<string, number> = {
  us: 2840, gb: 2826, ca: 2124, au: 2036, de: 2276, fr: 2250,
  es: 2724, it: 2380, nl: 2528, cn: 2156, ru: 2643, tr: 2792,
  in: 2356, br: 2076, mx: 2484, jp: 2392, kr: 2410,
};

export function legacyYepApiKey(query: string, opts: SearchOptions): string {
  const depth = Math.min(opts.depth ?? 50, 100);
  const locationCode = opts.gl ? (LEGACY_LOCATION_CODES[opts.gl.toLowerCase()] ?? 2840) : 2840;
  return createHash("sha256")
    .update(JSON.stringify({ p: "yepapi", query, depth, locationCode, language: opts.language ?? "en" }))
    .digest("hex");
}
