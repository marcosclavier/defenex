import { createHash } from "node:crypto";
import {
  DEFAULT_SEARCH_DAILY_CAP,
  DEFAULT_SEARCH_DEPTH,
  MAX_SEARCH_DEPTH,
  SEARCH_CACHE_TTL_MS,
  YEPAPI_COST_MICROS_PER_CALL,
  type SearchResult,
} from "@defenex/shared";
import { QuotaExceededError, SearchConfigError, SearchRateLimitError } from "../errors.js";
import {
  MemoryCache,
  MemoryQuota,
  silentLogger,
  type CacheStore,
  type Logger,
  type QuotaCounter,
} from "../ports.js";
import type { SearchOptions, SearchOutcome, SearchProvider } from "./types.js";

const ENDPOINT = "https://api.yepapi.com/v1/serp/google";

/**
 * Country targeting. YepAPI uses DataForSEO-style codes: 2000 + the ISO 3166-1
 * numeric country code. Only 2840 (US) is confirmed by the vendor docs; the
 * rest follow that pattern and are verified by `pnpm preflight`.
 */
const LOCATION_CODES: Record<string, number> = {
  us: 2840, gb: 2826, ca: 2124, au: 2036, de: 2276, fr: 2250,
  es: 2724, it: 2380, nl: 2528, cn: 2156, ru: 2643, tr: 2792,
  in: 2356, br: 2076, mx: 2484, jp: 2392, kr: 2410,
};

export const DEFAULT_LOCATION_CODE = LOCATION_CODES.us as number;

interface YepItem {
  position?: number;
  type?: string;
  title?: string;
  url?: string;
  description?: string;
  domain?: string;
  data?: Record<string, unknown> | null;
}

interface YepResponse {
  ok?: boolean;
  data?: { query?: string; totalResults?: number; itemTypes?: string[]; results?: YepItem[] };
  error?: { code?: string; message?: string };
}

export interface YepApiConfig {
  apiKey: string;
  dailyCap?: number;
  defaultDepth?: number;
  cache?: CacheStore;
  quota?: QuotaCounter;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Extract a displayable price from the several shapes the API uses. */
function readPrice(data: Record<string, unknown> | null | undefined): string | undefined {
  const price = data?.["price"];
  if (!price || typeof price !== "object") return undefined;
  const p = price as Record<string, unknown>;
  return (
    asString(p["displayedPrice"]) ??
    (typeof p["current"] === "number" ? `${p["current"]} ${asString(p["currency"]) ?? ""}`.trim() : undefined)
  );
}

export class YepApiClient implements SearchProvider {
  readonly name = "yepapi";

  private readonly cache: CacheStore;
  private readonly quota: QuotaCounter;
  private readonly log: Logger;
  private readonly dailyCap: number;
  private readonly defaultDepth: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: YepApiConfig) {
    if (!config.apiKey) throw new SearchConfigError("YEPAPI_API_KEY is not set");
    this.cache = config.cache ?? new MemoryCache(SEARCH_CACHE_TTL_MS);
    this.quota = config.quota ?? new MemoryQuota();
    this.log = config.logger ?? silentLogger;
    this.dailyCap = config.dailyCap ?? DEFAULT_SEARCH_DAILY_CAP;
    this.defaultDepth = config.defaultDepth ?? DEFAULT_SEARCH_DEPTH;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  /**
   * One query, one billable call.
   *
   * Billing is per call regardless of `depth`, so unlike Google Custom Search
   * there is no pagination cost and no 100-result ceiling to design around —
   * depth is bounded by latency, not price.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const depth = Math.min(opts.depth ?? this.defaultDepth, MAX_SEARCH_DEPTH);
    const locationCode = opts.gl ? (LOCATION_CODES[opts.gl.toLowerCase()] ?? DEFAULT_LOCATION_CODE) : DEFAULT_LOCATION_CODE;
    const language = opts.language ?? "en";

    const key = createHash("sha256")
      .update(JSON.stringify({ p: "yepapi", query, depth, locationCode, language }))
      .digest("hex");

    const cached = (await this.cache.get(key)) as SearchResult[] | null;
    if (cached) {
      this.log.debug("search cache hit", { query });
      return { results: cached, callsSpent: 0, costMicros: 0, fromCache: true };
    }

    const used = await this.quota.used();
    if (used >= this.dailyCap) throw new QuotaExceededError(used, this.dailyCap);

    const body = await this.requestWithRetry({ query, depth, location_code: locationCode, language });
    await this.quota.consume(1);

    const results = this.mapResults(body, query);
    await this.cache.set(key, results);

    this.log.debug("search complete", { query, results: results.length });
    return {
      results,
      callsSpent: 1,
      costMicros: YEPAPI_COST_MICROS_PER_CALL,
      fromCache: false,
    };
  }

  /**
   * Flatten a SERP into candidate URLs.
   *
   * Only types that represent a page someone can visit are kept. The rest
   * (aiOverview, peopleAlsoAsk, relatedSearches, video, localPack, ...) are
   * navigational furniture. Unknown types are ignored rather than guessed at —
   * the vendor's type list is not exhaustive; `aiOverview` appears in live
   * responses but is absent from their documentation.
   */
  private mapResults(body: YepResponse, sourceQuery: string): SearchResult[] {
    const out: SearchResult[] = [];

    for (const item of body.data?.results ?? []) {
      const data = item.data ?? {};

      if (item.type === "organic" || item.type === "paid") {
        if (!item.url) continue;
        out.push({
          url: item.url,
          title: item.title ?? "",
          snippet: item.description ?? "",
          displayLink: item.domain ?? "",
          sourceQuery,
          resultType: item.type === "paid" ? "paid" : "organic",
          position: item.position,
          // Google's own flag. When set, this is a strong phishing/malware signal.
          flaggedMalicious: data["isMalicious"] === true,
          ...(readPrice(data) ? { price: readPrice(data) as string } : {}),
        });
        continue;
      }

      // Product carousels are live commercial offers — the highest-value
      // counterfeit signal a SERP carries.
      if (item.type === "shopping" || item.type === "popularProducts") {
        const items = Array.isArray(data["items"]) ? (data["items"] as Record<string, unknown>[]) : [];
        for (const product of items) {
          const url = asString(product["url"]);
          if (!url) continue;
          out.push({
            url,
            title: asString(product["title"]) ?? "",
            snippet: [asString(product["source"]), asString(product["description"])].filter(Boolean).join(" — "),
            displayLink: asString(product["source"]) ?? "",
            sourceQuery,
            resultType: "product",
            position: item.position,
            ...(readPrice(product) ?? asString(product["price"])
              ? { price: (readPrice(product) ?? asString(product["price"])) as string }
              : {}),
          });
        }
      }
    }

    return out;
  }

  private async requestWithRetry(payload: Record<string, unknown>): Promise<YepResponse> {
    const MAX_ATTEMPTS = 4;
    let lastStatus = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await this.doFetch(ENDPOINT, {
        method: "POST",
        headers: { "x-api-key": this.config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      lastStatus = res.status;

      if (res.ok) {
        const body = (await res.json()) as YepResponse;
        if (body.ok === false) {
          throw new SearchConfigError(
            `YepAPI returned an error: ${body.error?.code ?? "UNKNOWN"} — ${body.error?.message ?? ""}`,
          );
        }
        return body;
      }

      const body = (await res.json().catch(() => ({}))) as YepResponse;
      const reason = `${body.error?.code ?? res.status}: ${body.error?.message ?? res.statusText}`;

      // Credentials and malformed requests cannot be fixed by retrying.
      if (res.status === 401 || res.status === 403) {
        throw new SearchConfigError(
          `YepAPI rejected the credentials (${res.status}) — ${reason}. Check YEPAPI_API_KEY.`,
        );
      }
      if (res.status === 400 || res.status === 422) {
        throw new SearchConfigError(`YepAPI rejected the request (${res.status}) — ${reason}`);
      }
      if (res.status === 402) {
        throw new SearchConfigError(`YepAPI account is out of credit (402) — ${reason}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const backoff = 2 ** attempt * 700;
        this.log.warn("search retry", { status: res.status, attempt, backoff });
        await sleep(backoff);
        continue;
      }

      throw new SearchConfigError(`Unexpected YepAPI response ${res.status} — ${reason}`);
    }

    throw new SearchRateLimitError(
      `YepAPI still failing with ${lastStatus} after ${MAX_ATTEMPTS} attempts`,
    );
  }
}

export const __testing = { LOCATION_CODES };
