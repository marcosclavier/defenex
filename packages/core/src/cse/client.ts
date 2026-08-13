import { createHash } from "node:crypto";
import {
  CSE_MAX_RESULTS_PER_QUERY,
  CSE_MAX_START_INDEX,
  CSE_MAX_TOTAL_RESULTS,
  CSE_COST_MICROS_PER_QUERY,
  CSE_CACHE_TTL_MS,
  DEFAULT_CSE_DAILY_CAP,
  type SearchResult,
} from "@defenex/shared";
import {
  QuotaExceededError,
  SearchConfigError,
  SearchRateLimitError,
} from "../errors.js";
import {
  MemoryCache,
  MemoryQuota,
  silentLogger,
  type CacheStore,
  type QuotaCounter,
  type Logger,
} from "../ports.js";

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export interface CseConfig {
  apiKey: string;
  /** The `cx` — Programmable Search Engine id, with "search entire web" on. */
  searchEngineId: string;
  dailyCap?: number;
  cache?: CacheStore;
  quota?: QuotaCounter;
  logger?: Logger;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface SearchOptions {
  /** Hard-capped at 100 by Google; `start` cannot exceed 91. */
  maxResults?: number;
  /** Geo-target, e.g. "us", "cn". Counterfeit operations cluster regionally. */
  gl?: string;
  /** e.g. "d7", "m1" — used by monitoring rescans. */
  dateRestrict?: string;
  excludeTerms?: string;
}

interface CseApiItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
}

interface CseApiResponse {
  items?: CseApiItem[];
  searchInformation?: { totalResults?: string };
  error?: { code?: number; message?: string; status?: string };
}

export interface SearchOutcome {
  results: SearchResult[];
  /** API calls actually made — cache hits cost nothing. */
  queriesSpent: number;
  costMicros: number;
  fromCache: boolean;
}

function cacheKey(q: string, opts: SearchOptions, cx: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ q, cx, ...opts }))
    .digest("hex");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CseClient {
  private readonly cache: CacheStore;
  private readonly quota: QuotaCounter;
  private readonly log: Logger;
  private readonly dailyCap: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: CseConfig) {
    if (!config.apiKey) throw new SearchConfigError("GOOGLE_CLOUD_API_KEY is not set");
    if (!config.searchEngineId) throw new SearchConfigError("SEARCH_ENGINE_ID is not set");
    this.cache = config.cache ?? new MemoryCache(CSE_CACHE_TTL_MS);
    this.quota = config.quota ?? new MemoryQuota();
    this.log = config.logger ?? silentLogger;
    this.dailyCap = config.dailyCap ?? DEFAULT_CSE_DAILY_CAP;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  /**
   * Run one query, paginating until `maxResults` or Google's ceiling.
   *
   * Google returns at most 10 results per call and refuses `start` above 91,
   * so no query can ever reach result 101. A heavily-infringed brand therefore
   * yields a sample, not a census — worth remembering when reading a report.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const want = Math.min(opts.maxResults ?? CSE_MAX_RESULTS_PER_QUERY, CSE_MAX_TOTAL_RESULTS);
    const key = cacheKey(query, { ...opts, maxResults: want }, this.config.searchEngineId);

    const cached = (await this.cache.get(key)) as SearchResult[] | null;
    if (cached) {
      this.log.debug("cse cache hit", { query });
      return { results: cached, queriesSpent: 0, costMicros: 0, fromCache: true };
    }

    const results: SearchResult[] = [];
    let spent = 0;
    let start = 1;

    while (results.length < want && start <= CSE_MAX_START_INDEX) {
      await this.assertQuota();

      const page = await this.fetchPage(query, start, opts);
      spent += 1;
      await this.quota.consume(1);

      if (page.length === 0) break;
      results.push(...page);
      start += CSE_MAX_RESULTS_PER_QUERY;
    }

    const trimmed = results.slice(0, want);
    await this.cache.set(key, trimmed);

    return {
      results: trimmed,
      queriesSpent: spent,
      costMicros: spent * CSE_COST_MICROS_PER_QUERY,
      fromCache: false,
    };
  }

  private async assertQuota(): Promise<void> {
    const used = await this.quota.used();
    if (used >= this.dailyCap) throw new QuotaExceededError(used, this.dailyCap);
  }

  private async fetchPage(
    query: string,
    start: number,
    opts: SearchOptions,
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      key: this.config.apiKey,
      cx: this.config.searchEngineId,
      q: query,
      num: String(CSE_MAX_RESULTS_PER_QUERY),
      start: String(start),
      safe: "off",
    });
    if (opts.gl) params.set("gl", opts.gl);
    if (opts.dateRestrict) params.set("dateRestrict", opts.dateRestrict);
    if (opts.excludeTerms) params.set("excludeTerms", opts.excludeTerms);

    const body = await this.requestWithRetry(`${ENDPOINT}?${params}`, query);

    return (body.items ?? []).flatMap((item): SearchResult[] => {
      if (!item.link) return [];
      return [
        {
          url: item.link,
          title: item.title ?? "",
          snippet: item.snippet ?? "",
          displayLink: item.displayLink ?? "",
          sourceQuery: query,
        },
      ];
    });
  }

  /** Exponential backoff on 429/5xx; config errors fail immediately. */
  private async requestWithRetry(url: string, query: string): Promise<CseApiResponse> {
    const MAX_ATTEMPTS = 4;
    let lastStatus = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await this.doFetch(url);
      lastStatus = res.status;

      if (res.ok) return (await res.json()) as CseApiResponse;

      const body = (await res.json().catch(() => ({}))) as CseApiResponse;
      const reason = body.error?.message ?? res.statusText;

      // 403 is almost always "Custom Search API not enabled" or a bad key.
      // Retrying cannot fix either, so surface it immediately and clearly.
      if (res.status === 403) {
        throw new SearchConfigError(
          `Google rejected the request (403): ${reason}. ` +
            `Check that the Custom Search API is enabled on the project owning ` +
            `GOOGLE_CLOUD_API_KEY, and that SEARCH_ENGINE_ID is correct.`,
        );
      }
      if (res.status === 400) {
        throw new SearchConfigError(`Google rejected the query (400): ${reason}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const backoff = 2 ** attempt * 500;
        this.log.warn("cse retry", { status: res.status, attempt, backoff, query });
        await sleep(backoff);
        continue;
      }

      throw new SearchConfigError(`Unexpected CSE response ${res.status}: ${reason}`);
    }

    throw new SearchRateLimitError(
      `Google Custom Search still failing with ${lastStatus} after ${MAX_ATTEMPTS} attempts`,
    );
  }
}
