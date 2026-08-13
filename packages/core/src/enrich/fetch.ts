import { chromium, type Browser, type BrowserContext } from "playwright";
import { MAX_PAGE_TEXT_CHARS, type EnrichedResult, type SearchResult } from "@defenex/shared";
import { assertUrlIsFetchable } from "./ssrf.js";
import { BlockedUrlError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";

export interface FetcherOptions {
  timeoutMs?: number;
  screenshot?: boolean;
  logger?: Logger;
  userAgent?: string;
}

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

  constructor(opts: FetcherOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.wantScreenshot = opts.screenshot ?? true;
    this.log = opts.logger ?? silentLogger;
    this.userAgent =
      opts.userAgent ??
      "Mozilla/5.0 (compatible; DefenexBot/1.0; +https://defenex.com/bot)";
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        args: ["--disable-dev-shm-usage", "--no-sandbox"],
      });
    }
    return this.browser;
  }

  async fetchOne(result: SearchResult): Promise<EnrichedResult> {
    const base: EnrichedResult = {
      ...result,
      finalUrl: result.url,
      httpStatus: 0,
      pageTitle: null,
      pageText: null,
      screenshot: null,
      fetchError: null,
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

      return {
        ...base,
        finalUrl: page.url(),
        httpStatus: response?.status() ?? 0,
        pageTitle,
        pageText: (pageText ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS),
        screenshot,
        fetchError: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("fetch failed", { url: result.url, error: message });
      return { ...base, fetchError: message };
    } finally {
      // A leaked context is how the worker OOMs at 3am.
      await context?.close().catch(() => {});
    }
  }

  /** Fetch with bounded concurrency — unbounded parallelism exhausts memory. */
  async fetchMany(results: SearchResult[], concurrency = 4): Promise<EnrichedResult[]> {
    const out: EnrichedResult[] = new Array(results.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(concurrency, results.length) }, async () => {
      while (true) {
        const i = cursor++;
        const item = results[i];
        if (!item) break;
        out[i] = await this.fetchOne(item);
      }
    });

    await Promise.all(runners);
    return out;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}
