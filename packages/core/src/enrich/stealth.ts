import { STEALTH_COST_MICROS_PER_CALL, MAX_PAGE_TEXT_CHARS } from "@defenex/shared";
import { SearchConfigError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";
import { extractReadableText, extractTitle } from "./html.js";
import type { ScrapeProvider, ScrapeResult } from "./scrape.js";

const ENDPOINT = "https://api.yepapi.com/v1/scrape/stealth";

export interface StealthConfig {
  apiKey: string;
  logger?: Logger;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** @deprecated Use `ScrapeResult`; kept so existing imports still resolve. */
export type StealthResult = ScrapeResult;

/** Tier-2 fetcher for sites that refuse an ordinary headless browser. */
export class StealthScraper implements ScrapeProvider {
  readonly name = "yepapi";
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: StealthConfig) {
    if (!config.apiKey) throw new SearchConfigError("YEPAPI_API_KEY is not set");
    this.log = config.logger ?? silentLogger;
    this.timeoutMs = config.timeoutMs ?? 45_000;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async scrape(url: string, country = "us"): Promise<ScrapeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.doFetch(ENDPOINT, {
        method: "POST",
        headers: { "x-api-key": this.config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ url, format: "markdown", country }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw new SearchConfigError(`Stealth scrape rejected credentials (${res.status})`);
        }
        if (res.status === 402) {
          throw new SearchConfigError(`Stealth scrape out of credit (402)`);
        }
        throw new Error(`stealth scrape failed ${res.status}: ${detail.slice(0, 200)}`);
      }

      const body = (await res.json()) as {
        ok?: boolean;
        data?: { url?: string; statusCode?: number; content?: string };
        error?: { code?: string; message?: string };
      };

      if (body.ok === false) {
        throw new Error(`stealth scrape error: ${body.error?.code ?? "UNKNOWN"}`);
      }

      const raw = body.data?.content ?? "";
      this.log.debug("stealth scrape ok", { url, chars: raw.length });

      const { text, bodyChars } = extractReadableText(raw);
      const truncated = text.slice(0, MAX_PAGE_TEXT_CHARS);
      return {
        statusCode: body.data?.statusCode ?? 0,
        text: truncated,
        bodyChars: Math.min(bodyChars, truncated.length),
        title: extractTitle(raw),
        finalUrl: body.data?.url ?? url,
        costMicros: STEALTH_COST_MICROS_PER_CALL,
        html: raw,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
