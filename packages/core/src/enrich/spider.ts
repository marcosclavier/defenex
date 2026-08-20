import { MAX_PAGE_TEXT_CHARS } from "@defenex/shared";
import { SearchConfigError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";
import { extractReadableText, extractTitle } from "./html.js";
import type { ScrapeProvider, ScrapeResult } from "./scrape.js";

/**
 * spider.cloud — the paid fetch tier.
 *
 * Measured against the DHgate listing that answers our headless browser with a
 * 403: spider returned the real page in about three seconds for $0.0007, where
 * the YepAPI stealth tier costs $0.03 and takes fifteen to twenty-five. It also
 * hands back the HTML, which the evidence path needs and a text-only response
 * could not provide.
 *
 * `return_format: "raw"` is deliberate. Spider will return markdown or text,
 * but running its output through our own `htmlToText` keeps the extraction
 * identical to the tier this replaces — so switching providers changes who
 * fetched the page and nothing about what the classifier reads. Anything else
 * would make a detection regression impossible to attribute.
 */

const ENDPOINT = "https://api.spider.cloud/scrape";

/** Fallback when the response omits its cost breakdown; the observed mean. */
const FALLBACK_COST_MICROS = 700;

export interface SpiderConfig {
  apiKey: string;
  logger?: Logger;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface SpiderRow {
  url?: string;
  status?: number;
  error?: string | null;
  content?: string | null;
  costs?: { total_cost?: number };
}

export function parseSpiderResponse(body: unknown, requestedUrl: string): ScrapeResult {
  // Spider answers with an array even for one URL, but has been seen returning
  // a bare object; accept both rather than fail on a shape difference.
  const row: SpiderRow = (Array.isArray(body) ? body[0] : body) ?? {};

  if (row.error) throw new Error(`spider: ${row.error}`);

  const html = row.content ?? "";
  if (!html) throw new Error("spider returned no content");

  const { text, bodyChars } = extractReadableText(html);
  const truncated = text.slice(0, MAX_PAGE_TEXT_CHARS);
  return {
    statusCode: row.status ?? 0,
    text: truncated,
    // Clamped so it always describes the text actually returned. Long bodies
    // are truncated far above every threshold that reads this, and thin ones
    // are never truncated at all, so the clamp cannot change a decision.
    bodyChars: Math.min(bodyChars, truncated.length),
    title: extractTitle(html),
    finalUrl: row.url ?? requestedUrl,
    // The real figure, not a constant: it varies with page size and compute,
    // and reporting an average would make the spend circuit breaker a guess.
    costMicros: row.costs?.total_cost != null
      ? Math.max(1, Math.round(row.costs.total_cost * 1_000_000))
      : FALLBACK_COST_MICROS,
    html,
  };
}

export class SpiderScraper implements ScrapeProvider {
  readonly name = "spider";
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: SpiderConfig) {
    if (!config.apiKey) throw new SearchConfigError("SPIDER_CLOUD_API_KEY is not set");
    this.log = config.logger ?? silentLogger;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async scrape(url: string, country = "us"): Promise<ScrapeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url, return_format: "raw", limit: 1, country }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Fail fast rather than retrying: neither a bad key nor an empty
        // balance gets better on the next attempt, and a scan that keeps
        // trying just wastes the queue's time.
        if (res.status === 401 || res.status === 403) {
          throw new SearchConfigError(`spider rejected credentials (${res.status})`);
        }
        if (res.status === 402) throw new SearchConfigError("spider out of credit (402)");
        throw new Error(`spider scrape failed ${res.status}: ${detail.slice(0, 200)}`);
      }

      const result = parseSpiderResponse(await res.json(), url);
      this.log.debug("spider scrape ok", {
        url,
        chars: result.text.length,
        status: result.statusCode,
        costMicros: result.costMicros,
      });
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
