/** Our own daily cap was hit. Callers should defer the scan, not fail it. */
export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  constructor(readonly used: number, readonly cap: number) {
    super(`Daily CSE cap reached: ${used}/${cap} queries used`);
    this.name = "QuotaExceededError";
  }
}

/** Google rejected the credentials or the API is not enabled on the project. */
export class SearchConfigError extends Error {
  readonly code = "SEARCH_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "SearchConfigError";
  }
}

/** Google rate limited us and retries were exhausted. */
export class SearchRateLimitError extends Error {
  readonly code = "SEARCH_RATE_LIMIT";
  constructor(message: string) {
    super(message);
    this.name = "SearchRateLimitError";
  }
}

/** A URL was refused before any network request — SSRF guard. */
export class BlockedUrlError extends Error {
  readonly code = "BLOCKED_URL";
  constructor(readonly url: string, readonly reason: string) {
    super(`Refused to fetch ${url}: ${reason}`);
    this.name = "BlockedUrlError";
  }
}
