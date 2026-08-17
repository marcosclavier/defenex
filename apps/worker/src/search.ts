import {
  CachedSearch,
  ChainedSearchProvider,
  SerperClient,
  YepApiClient,
  type SearchProvider,
} from "@defenex/core";
import { SEARCH_CACHE_TTL_MS } from "@defenex/shared";
import { env } from "./env.js";
import { coreLogger, logger } from "./logger.js";
import { dbCache, dbQuota } from "./ports.js";

/**
 * The search tier, assembled once.
 *
 * Composed as cache → chain → providers. The cache sits outermost and is keyed
 * on the query rather than on the provider, so a warm cache carries a scan
 * through an outage without buying the same answer twice from a second vendor.
 *
 * Which providers sit in the chain is governed by `SEARCH_PROVIDER` rather than
 * by the presence of a key, mirroring `SCAN_FETCH_PROVIDER`: this decides what
 * text the classifier is given, so reverting it must be one variable and no
 * deploy.
 */

let provider: SearchProvider | null = null;

function yepapi(): SearchProvider {
  return new YepApiClient({
    apiKey: env.YEPAPI_API_KEY,
    dailyCap: env.SEARCH_DAILY_CAP,
    defaultDepth: env.SEARCH_DEPTH,
    quota: dbQuota("yepapi"),
    logger: coreLogger,
  });
}

function serper(): SearchProvider | null {
  if (!env.SERPER_DEV_API_KEY) return null;
  return new SerperClient({
    apiKey: env.SERPER_DEV_API_KEY,
    maxPages: env.SERPER_MAX_PAGES,
    costMicrosPerCall: env.SERPER_COST_MICROS_PER_CALL,
    dailyCap: env.SERPER_DAILY_CAP,
    defaultDepth: env.SEARCH_DEPTH,
    // A separate counter: the two are priced an order of magnitude apart, so
    // one shared cap would either starve the cheap one or overspend the dear one.
    quota: dbQuota("serper"),
    logger: coreLogger,
  });
}

export function getSearchProvider(): SearchProvider {
  if (!provider) {
    provider = new CachedSearch(buildChain(), {
      cache: dbCache(SEARCH_CACHE_TTL_MS),
      logger: coreLogger,
    });
    logger.info({ chain: provider.name, configured: env.SEARCH_PROVIDER }, "search tier");
  }
  return provider;
}

function buildChain(): SearchProvider {
  const fallback = serper();

  if (env.SEARCH_PROVIDER === "yepapi" || !fallback) return yepapi();
  if (env.SEARCH_PROVIDER === "serper") return fallback;

  // Primary first: it is the provider the detection baselines were measured
  // against, and it returns signals the fallback cannot (paid placements,
  // product carousels, Google's own malicious flag).
  return new ChainedSearchProvider([yepapi(), fallback], { logger: coreLogger });
}
