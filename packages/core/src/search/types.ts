import type { SearchResult } from "@defenex/shared";

export interface SearchOptions {
  /** Results requested. Provider decides how to satisfy it. */
  depth?: number;
  /** Two-letter geo target, e.g. "us", "cn". Providers map it themselves. */
  gl?: string;
  language?: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  /** Billable API calls actually made. Cache hits cost nothing. */
  callsSpent: number;
  costMicros: number;
  fromCache: boolean;
  /**
   * Served from cache past its TTL because the provider was unreachable. The
   * results are real but may be out of date, and a scan that relied on them
   * should say so rather than present them as fresh.
   */
  stale?: boolean;
}

/**
 * Search backends have proven volatile — Google is retiring the Custom Search
 * JSON API in January 2027 — so the engine depends on this interface rather
 * than on any one vendor.
 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchOutcome>;
}
