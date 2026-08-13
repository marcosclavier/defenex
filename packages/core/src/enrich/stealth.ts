import { STEALTH_COST_MICROS_PER_CALL, MAX_PAGE_TEXT_CHARS } from "@defenex/shared";
import { SearchConfigError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";

const ENDPOINT = "https://api.yepapi.com/v1/scrape/stealth";

export interface StealthConfig {
  apiKey: string;
  logger?: Logger;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface StealthResult {
  statusCode: number;
  text: string;
  title: string | null;
  finalUrl: string;
  costMicros: number;
}

/**
 * Strip markup to readable text.
 *
 * The vendor accepts a `format: "markdown"` flag but was observed returning raw
 * HTML regardless, so conversion cannot be delegated. Responses also run to
 * hundreds of kilobytes, and only the first few thousand characters are ever
 * shown to the classifier.
 */
export function htmlToText(html: string): string {
  // Whitespace in the source is rendered as a single space, so block breaks are
  // marked with a sentinel first and restored last. Otherwise a newline that
  // merely formats the HTML would split a sentence in the extracted text.
  const BREAK = "\u0000";
  return html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, BREAK)
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, BREAK)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${BREAK}\\s*`, "g"), "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? htmlToText(m[1]).slice(0, 300) : null;
}

/** Tier-2 fetcher for sites that refuse an ordinary headless browser. */
export class StealthScraper {
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: StealthConfig) {
    if (!config.apiKey) throw new SearchConfigError("YEPAPI_API_KEY is not set");
    this.log = config.logger ?? silentLogger;
    this.timeoutMs = config.timeoutMs ?? 45_000;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async scrape(url: string, country = "us"): Promise<StealthResult> {
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

      return {
        statusCode: body.data?.statusCode ?? 0,
        text: htmlToText(raw).slice(0, MAX_PAGE_TEXT_CHARS),
        title: extractTitle(raw),
        finalUrl: body.data?.url ?? url,
        costMicros: STEALTH_COST_MICROS_PER_CALL,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
