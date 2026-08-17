import {
  SERPER_COST_MICROS_PER_CALL,
  SERPER_DEFAULT_MAX_PAGES,
  SERPER_RESULTS_PER_PAGE,
  DEFAULT_SEARCH_DAILY_CAP,
  DEFAULT_SEARCH_DEPTH,
  type SearchResult,
} from "@defenex/shared";
import { QuotaExceededError, SearchConfigError, SearchRateLimitError } from "../errors.js";
import { MemoryQuota, silentLogger, type Logger, type QuotaCounter } from "../ports.js";
import type { SearchOptions, SearchOutcome, SearchProvider } from "./types.js";

/**
 * Serper.dev — failover SERP provider.
 *
 * Chosen because it proxies Google, the same index the primary serves, so the
 * detection baselines the engine is calibrated against stay meaningful when it
 * engages. Verified against the live API: `site:` and quoted phrases pass
 * through untouched, which is the property the whole query planner rests on.
 *
 * Two things it does NOT give us, both verified on the paid tier and both
 * affecting scoring rather than merely coverage:
 *
 *   - Only `organic`. No ads section, so `resultType: "paid"` is never set —
 *     and bidding on a brand name is itself trademark misuse.
 *   - No shopping carousel, so no `resultType: "product"` and no `price`.
 *     Product carousels are the strongest counterfeit signal a SERP carries.
 *
 * There is also no equivalent of Google's `isMalicious` flag, so
 * `flaggedMalicious` is never set and the direct phishing signal is lost.
 *
 * A scan served by this provider will therefore score lower than the same scan
 * served by the primary. That is a reason to record which provider answered,
 * not a reason to pretend the results are equivalent.
 */

const ENDPOINT = "https://google.serper.dev/search";

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  date?: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  credits?: number;
  message?: string;
}

export interface SerperConfig {
  apiKey: string;
  /** Pages per query. Each is a separate credit. */
  maxPages?: number;
  costMicrosPerCall?: number;
  dailyCap?: number;
  defaultDepth?: number;
  quota?: QuotaCounter;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Flatten one page into candidate URLs.
 *
 * `position` restarts at 1 on every page, so it is re-based against the page
 * number. `priorScore` treats position as a proxy for reach; taken at face
 * value, a five-page query would report five separate results at position 1.
 */
export function mapSerperPage(
  body: SerperResponse,
  sourceQuery: string,
  page: number,
): SearchResult[] {
  const offset = (page - 1) * SERPER_RESULTS_PER_PAGE;
  const out: SearchResult[] = [];

  for (const [index, item] of (body.organic ?? []).entries()) {
    if (!item.link) continue;
    out.push({
      url: item.link,
      title: item.title ?? "",
      snippet: item.snippet ?? "",
      displayLink: hostOf(item.link),
      sourceQuery,
      resultType: "organic",
      position: offset + (item.position ?? index + 1),
    });
  }

  return out;
}

export class SerperClient implements SearchProvider {
  readonly name = "serper";

  private readonly quota: QuotaCounter;
  private readonly log: Logger;
  private readonly maxPages: number;
  private readonly costMicros: number;
  private readonly dailyCap: number;
  private readonly defaultDepth: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: SerperConfig) {
    if (!config.apiKey) throw new SearchConfigError("SERPER_DEV_API_KEY is not set");
    this.quota = config.quota ?? new MemoryQuota();
    this.log = config.logger ?? silentLogger;
    this.maxPages = Math.max(1, config.maxPages ?? SERPER_DEFAULT_MAX_PAGES);
    this.costMicros = config.costMicrosPerCall ?? SERPER_COST_MICROS_PER_CALL;
    this.dailyCap = config.dailyCap ?? DEFAULT_SEARCH_DAILY_CAP;
    this.defaultDepth = config.defaultDepth ?? DEFAULT_SEARCH_DEPTH;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const want = opts.depth ?? this.defaultDepth;
    const pages = Math.min(this.maxPages, Math.ceil(want / SERPER_RESULTS_PER_PAGE));

    const results: SearchResult[] = [];
    // Pages overlap — measured at 26 unique across 3 pages, not 30 — so the
    // same listing must not be enriched and classified twice.
    const seen = new Set<string>();
    let spent = 0;

    for (let page = 1; page <= pages; page++) {
      const used = await this.quota.used();
      if (used >= this.dailyCap) {
        // Stop rather than throw when earlier pages already returned results:
        // a shallower answer beats discarding what we have paid for.
        if (results.length > 0) break;
        throw new QuotaExceededError(used, this.dailyCap);
      }

      const body = await this.requestWithRetry(query, page, opts);
      spent += 1;
      await this.quota.consume(1);

      const mapped = mapSerperPage(body, query, page);
      // An empty page means the result set is exhausted; further pages are
      // billable and would return nothing.
      if (mapped.length === 0) break;

      for (const r of mapped) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        results.push(r);
      }

      if (results.length >= want) break;
    }

    this.log.debug("serper search complete", { query, pages: spent, results: results.length });

    return {
      results: results.slice(0, want),
      callsSpent: spent,
      costMicros: spent * this.costMicros,
      fromCache: false,
    };
  }

  private async requestWithRetry(
    query: string,
    page: number,
    opts: SearchOptions,
  ): Promise<SerperResponse> {
    const MAX_ATTEMPTS = 4;
    let lastStatus = 0;
    let lastNetworkError: string | null = null;

    const payload = {
      q: query,
      // Sent for completeness; the API accepts it and returns ten regardless.
      num: SERPER_RESULTS_PER_PAGE,
      page,
      ...(opts.gl ? { gl: opts.gl.toLowerCase() } : {}),
      ...(opts.language ? { hl: opts.language } : {}),
    };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(ENDPOINT, {
          method: "POST",
          headers: { "X-API-KEY": this.config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // The vendor being unreachable is what this ladder is for.
        lastNetworkError = err instanceof Error ? err.message : String(err);
        this.log.warn("serper network error", { attempt, error: lastNetworkError });
        if (attempt < MAX_ATTEMPTS - 1) await sleep(2 ** attempt * 700);
        continue;
      }

      lastStatus = res.status;
      lastNetworkError = null;

      if (res.ok) return (await res.json()) as SerperResponse;

      const body = (await res.json().catch(() => ({}))) as SerperResponse;
      const reason = body.message ?? res.statusText;

      if (res.status === 401 || res.status === 403) {
        throw new SearchConfigError(`Serper rejected the credentials (${res.status}) — ${reason}`);
      }
      if (res.status === 402) {
        throw new SearchConfigError(`Serper account is out of credit (402) — ${reason}`);
      }
      // 400 covers plan restrictions as well as malformed queries; the free
      // tier answers "Query pattern not allowed for free accounts" this way.
      if (res.status === 400) {
        throw new SearchConfigError(`Serper rejected the query (400) — ${reason}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const backoff = 2 ** attempt * 700;
        this.log.warn("serper retry", { status: res.status, attempt, backoff });
        await sleep(backoff);
        continue;
      }

      throw new SearchConfigError(`Unexpected Serper response ${res.status} — ${reason}`);
    }

    throw new SearchRateLimitError(
      lastNetworkError
        ? `Serper unreachable after ${MAX_ATTEMPTS} attempts — ${lastNetworkError}`
        : `Serper still failing with ${lastStatus} after ${MAX_ATTEMPTS} attempts`,
    );
  }
}
