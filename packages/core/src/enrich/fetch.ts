import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  DEFAULT_STEALTH_BUDGET,
  MAX_PAGE_TEXT_CHARS,
  type EnrichedResult,
  type SearchResult,
} from "@defenex/shared";
import { assertUrlIsFetchable } from "./ssrf.js";
import { BlockedUrlError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";
import type { StealthScraper } from "./stealth.js";

export interface FetcherOptions {
  timeoutMs?: number;
  screenshot?: boolean;
  logger?: Logger;
  userAgent?: string;
  /** Tier-2 fetcher for sites that block a headless browser. */
  stealth?: StealthScraper;
}

/**
 * Paid-call budget for ONE scan.
 *
 * Deliberately per-run rather than per-fetcher. The fetcher is a process-wide
 * singleton so that concurrent scans share one browser; holding the budget on
 * it meant two scans drew from the same allowance and reported each other's
 * spend. It also makes the budget a per-request policy decision, which is how
 * the free tier is gated.
 */
export interface StealthBudget {
  remaining: number;
  used: number;
  costMicros: number;
}

export function createStealthBudget(limit: number): StealthBudget {
  return { remaining: Math.max(0, limit), used: 0, costMicros: 0 };
}

export interface FetchManyOptions {
  concurrency?: number;
  stealthBudget?: number;
}

export interface FetchManyResult {
  results: EnrichedResult[];
  stealthCallsUsed: number;
  stealthCostMicros: number;
}

/** Page text shorter than this means the fetch was defeated, not that the page is empty. */
const MIN_USEFUL_TEXT = 200;

/**
 * Runs inside the browser, not Node. Typed through globalThis so that `packages/core`
 * keeps a Node-only `lib` — adding "DOM" here would make browser globals appear
 * available throughout the package and let genuine mistakes typecheck.
 */
function readBodyText(): string {
  const doc = (globalThis as { document?: { body?: { innerText?: string } } }).document;
  return doc?.body?.innerText ?? "";
}

/**
 * Fetches candidate pages for classification and evidence.
 *
 * One browser, many contexts. Launching a browser per page would multiply a
 * ~300MB process across the queue and OOM the worker; contexts are cheap and
 * still isolate cookies and storage between hostile pages.
 */
export class PageFetcher {
  private browser: Browser | null = null;
  private readonly timeoutMs: number;
  private readonly wantScreenshot: boolean;
  private readonly log: Logger;
  private readonly userAgent: string;
  private readonly stealth: StealthScraper | undefined;

  constructor(opts: FetcherOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.wantScreenshot = opts.screenshot ?? true;
    this.log = opts.logger ?? silentLogger;
    this.userAgent =
      opts.userAgent ??
      "Mozilla/5.0 (compatible; DefenexBot/1.0; +https://defenex.com/bot)";
    this.stealth = opts.stealth;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        args: ["--disable-dev-shm-usage", "--no-sandbox"],
      });
    }
    return this.browser;
  }

  async fetchOne(result: SearchResult, budget?: StealthBudget): Promise<EnrichedResult> {
    const base: EnrichedResult = {
      ...result,
      finalUrl: result.url,
      httpStatus: 0,
      pageTitle: null,
      pageText: null,
      screenshot: null,
      fetchError: null,
      evidenceSource: null,
    };

    try {
      await assertUrlIsFetchable(result.url);
    } catch (err) {
      const reason = err instanceof BlockedUrlError ? err.message : String(err);
      this.log.warn("url blocked", { url: result.url, reason });
      return { ...base, fetchError: reason };
    }

    const browser = await this.getBrowser();
    let context: BrowserContext | null = null;

    try {
      context = await browser.newContext({
        userAgent: this.userAgent,
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
      });
      context.setDefaultTimeout(this.timeoutMs);

      const page = await context.newPage();

      // Never let a page start a download; we only want rendered content.
      page.on("download", (d) => void d.cancel());

      const response = await page.goto(result.url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs,
      });

      // Give client-rendered marketplace listings a moment to populate.
      await page.waitForTimeout(1_200);

      const [pageTitle, pageText] = await Promise.all([
        page.title().catch(() => null),
        page.evaluate(readBodyText).catch(() => ""),
      ]);

      const screenshot = this.wantScreenshot
        ? await page.screenshot({ type: "jpeg", quality: 70, fullPage: false }).catch(() => null)
        : null;

      const status = response?.status() ?? 0;
      const text = (pageText ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS);

      // Anti-bot pages return 403/503, or a 200 carrying an interstitial with
      // almost no text. Both mean we did not actually see the listing.
      if (status >= 400 || text.length < MIN_USEFUL_TEXT) {
        const viaStealth = await this.tryStealth(base, budget, `browser saw status ${status}, ${text.length} chars`);
        if (viaStealth) return viaStealth;
      }

      return {
        ...base,
        finalUrl: page.url(),
        httpStatus: status,
        pageTitle,
        pageText: text,
        screenshot,
        fetchError: null,
        evidenceSource: "browser",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("fetch failed", { url: result.url, error: message });
      const viaStealth = await this.tryStealth(base, budget, message);
      return viaStealth ?? { ...base, fetchError: message };
    } finally {
      // A leaked context is how the worker OOMs at 3am.
      await context?.close().catch(() => {});
    }
  }

  /**
   * Paid fallback. Only reached when the free browser path already failed, and
   * only while budget remains — each call costs $0.03 and takes 15-25 seconds.
   *
   * Returns no screenshot, so findings sourced this way carry text evidence but
   * no visual evidence; `evidenceSource` records the difference.
   */
  private async tryStealth(
    base: EnrichedResult,
    budget: StealthBudget | undefined,
    why: string,
  ): Promise<EnrichedResult | null> {
    if (!this.stealth || !budget || budget.remaining <= 0) return null;
    budget.remaining -= 1;

    try {
      this.log.info("falling back to stealth scrape", { url: base.url, why });
      const out = await this.stealth.scrape(base.url);
      budget.used += 1;
      budget.costMicros += out.costMicros;

      if (out.text.length < MIN_USEFUL_TEXT) {
        return { ...base, httpStatus: out.statusCode, fetchError: `stealth returned ${out.text.length} chars` };
      }

      return {
        ...base,
        finalUrl: out.finalUrl,
        httpStatus: out.statusCode,
        pageTitle: out.title,
        pageText: out.text,
        screenshot: null,
        fetchError: null,
        evidenceSource: "stealth",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("stealth scrape failed", { url: base.url, error: message });
      return null;
    }
  }

  /** Fetch with bounded concurrency — unbounded parallelism exhausts memory. */
  async fetchMany(results: SearchResult[], opts: FetchManyOptions = {}): Promise<FetchManyResult> {
    const concurrency = opts.concurrency ?? 4;
    const budget = createStealthBudget(opts.stealthBudget ?? DEFAULT_STEALTH_BUDGET);
    const out: EnrichedResult[] = new Array(results.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(concurrency, results.length) }, async () => {
      while (true) {
        const i = cursor++;
        const item = results[i];
        if (!item) break;
        out[i] = await this.fetchOne(item, budget);
      }
    });

    await Promise.all(runners);
    return { results: out, stealthCallsUsed: budget.used, stealthCostMicros: budget.costMicros };
  }

  /**
   * Expose the shared browser so callers can reuse it for other work (PDF
   * rendering) instead of launching a second ~300MB process.
   */
  async browserHandle(): Promise<Browser> {
    return this.getBrowser();
  }

  /** Idempotent: signal handlers and normal teardown may both call this. */
  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => {});
  }
}
