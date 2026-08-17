/**
 * YepAPI SERP — the primary search provider.
 * Billing is per CALL, not per result, so a deep query costs the same as a
 * shallow one. Depth is therefore free coverage, bounded only by latency.
 */
export const YEPAPI_COST_MICROS_PER_CALL = 10_000; // $0.01
export const DEFAULT_SEARCH_DEPTH = 50;
/** Observed ceiling: depth=100 returned 89 organic results in one call. */
export const MAX_SEARCH_DEPTH = 100;

/** Circuit breaker on calls per day. Fail soft (defer the scan), never hard. */
export const DEFAULT_SEARCH_DAILY_CAP = 5_000;
export const DEFAULT_SCAN_QUERY_BUDGET = 15;

/** Infringement pages do not churn hourly; a week of caching is safe and cheap. */
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far past its TTL a cached SERP may be served when the provider cannot be
 * reached at all.
 *
 * Never used on the happy path. During an outage a month-old result set is a
 * far better answer than an error: infringing listings persist for weeks, so
 * most of it is still true, and the alternative is telling a customer we found
 * nothing when in fact we could not look.
 */
export const SEARCH_STALE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Serper.dev — the failover SERP provider.
 *
 * Unlike YepAPI, depth is NOT free here. Measured against the live API on both
 * the free and paid tiers: `num` is accepted and ignored, and a call returns
 * about ten organic results whatever you ask for. `page` is the only depth
 * lever and each page is a separate credit, which makes this the Google Custom
 * Search cost model rather than YepAPI's.
 */
export const SERPER_RESULTS_PER_PAGE = 10;
/** 5 pages ≈ 50 results, matching the default SEARCH_DEPTH. */
export const SERPER_DEFAULT_MAX_PAGES = 5;
/**
 * Per-credit price, overridable because it depends on the active plan. It
 * feeds the spend circuit breaker and the cost shown to customers, so a wrong
 * value is wrong in both places.
 */
export const SERPER_COST_MICROS_PER_CALL = 500;

/**
 * Google Custom Search — retained as a fallback provider only.
 * Google is discontinuing the JSON API in January 2027; do not build on it.
 */
export const CSE_MAX_RESULTS_PER_QUERY = 10;
/** `start` may not exceed 91, so no CSE query can ever surface result 101+. */
export const CSE_MAX_START_INDEX = 91;
export const CSE_MAX_TOTAL_RESULTS = 100;
export const CSE_COST_MICROS_PER_QUERY = 5_000;
export const DEFAULT_CSE_DAILY_CAP = 8_000;
export const CSE_CACHE_TTL_MS = SEARCH_CACHE_TTL_MS;

/**
 * YepAPI stealth scrape — tier-2 fetch for sites that block a normal browser.
 * Three times the price of a search call and 15-25s of latency, so it is used
 * sparingly and only where tier 1 already failed.
 */
export const STEALTH_COST_MICROS_PER_CALL = 30_000; // $0.03
export const DEFAULT_STEALTH_BUDGET = 8;

/** Truncation limit for page text handed to the classifier. */
export const MAX_PAGE_TEXT_CHARS = 8_000;

/** Only fetch+screenshot results scoring at or above this; below it, snippet-only. */
export const ENRICHMENT_SEVERITY_FLOOR = 40;

