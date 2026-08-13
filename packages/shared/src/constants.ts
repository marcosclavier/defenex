/** Google Custom Search hard limits. These are Google's, not ours — do not raise them. */
export const CSE_MAX_RESULTS_PER_QUERY = 10;
/** `start` may not exceed 91, so no query can ever surface result 101+. */
export const CSE_MAX_START_INDEX = 91;
export const CSE_MAX_TOTAL_RESULTS = 100;
/** $5 per 1000 queries, expressed in micro-dollars to stay in integer math. */
export const CSE_COST_MICROS_PER_QUERY = 5000;

/** Our own circuit breaker, set below Google's 10k/day so we fail soft, not hard. */
export const DEFAULT_CSE_DAILY_CAP = 8000;
export const DEFAULT_SCAN_QUERY_BUDGET = 20;

/** Cache CSE responses for a week: infringement pages do not churn hourly. */
export const CSE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Truncation limit for page text handed to the classifier. */
export const MAX_PAGE_TEXT_CHARS = 8_000;

/** Only fetch+screenshot results scoring at or above this; below it, snippet-only. */
export const ENRICHMENT_SEVERITY_FLOOR = 40;
