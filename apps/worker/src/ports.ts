import type { CacheStore, QuotaCounter } from "@defenex/core";
import { cacheGet, cacheSet, consumeSearchCalls, searchCallsUsedToday } from "@defenex/db";

/**
 * Postgres-backed engine ports. The CLI uses in-memory equivalents; the worker
 * needs shared state so that concurrent scans and multiple replicas honour one
 * cache and one spend cap between them.
 */
export function dbCache(ttlMs: number): CacheStore {
  return {
    get: (key) => cacheGet(key, ttlMs),
    set: (key, value) => cacheSet(key, value),
    // Same row, a longer bound. `cacheGet` already takes the TTL as an
    // argument, so an outage buffer needs no schema change.
    getStale: (key, staleTtlMs) => cacheGet(key, staleTtlMs),
  };
}

export function dbQuota(provider: string): QuotaCounter {
  return {
    used: () => searchCallsUsedToday(provider),
    consume: (n) => consumeSearchCalls(provider, n),
  };
}
