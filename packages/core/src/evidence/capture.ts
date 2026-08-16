import { createHash } from "node:crypto";
import type { Browser, BrowserContext } from "playwright";
import { assertUrlIsFetchable } from "../enrich/ssrf.js";
import { BlockedUrlError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";
import { MIN_USEFUL_TEXT, type ScrapeProvider } from "../enrich/scrape.js";
import { htmlToText } from "../enrich/html.js";

/**
 * Evidence capture for a takedown notice.
 *
 * Deliberately separate from `PageFetcher`, which captures for classification:
 * that path takes a viewport-sized JPEG, tolerates a stealth fallback with no
 * image at all, and is reused from whatever the last scan happened to see. None
 * of that is admissible. Here the page is fetched fresh at request time, the
 * screenshot is full-page and lossless, and every artifact is hashed so the
 * bundle can be shown to be unaltered.
 *
 * The browser is passed in rather than launched: the worker already runs one
 * shared Chromium and a second ~300MB process would OOM the container.
 */

export interface EvidenceArtifact {
  /** Filename inside the bundle. */
  name: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface CaptureOptions {
  url: string;
  browser: Browser;
  timeoutMs?: number;
  userAgent?: string;
  logger?: Logger;
  /**
   * Fallback for pages that refuse our browser. Its HTML is rendered locally
   * and photographed; see `captureViaProxy`.
   */
  scraper?: ScrapeProvider;
}

/**
 * How the image was obtained. Recorded because the two are not the same claim:
 * one is a photograph of the live page, the other is our rendering of markup
 * the origin served us. Both are defensible; conflating them is not.
 */
export type CaptureMethod = "direct-browser" | "proxy-html-rendered";

export interface CaptureResult {
  /** False means we did not actually see the page, so nothing may be filed. */
  ok: boolean;
  capturedAt: string;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  responseHeaders: Record<string, string>;
  pageTitle: string | null;
  /** Rendered text length. Near-zero on an interstitial that returned 200. */
  textLength: number;
  captureMethod: CaptureMethod;
  /** False when the page defeated a full-page shot and only the viewport was taken. */
  screenshotFullPage: boolean;
  artifacts: EvidenceArtifact[];
  failure: string | null;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function artifactOf(name: string, contentType: string, bytes: Uint8Array): EvidenceArtifact {
  return { name, contentType, bytes, sha256: sha256Of(bytes) };
}

export function jsonArtifact(name: string, value: unknown): EvidenceArtifact {
  return artifactOf(name, "application/json", Buffer.from(JSON.stringify(value, null, 2), "utf8"));
}

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; DefenexBot/1.0; +https://defenex.com/bot)";

/**
 * Runs inside the browser, not Node. Typed through globalThis so `packages/core`
 * keeps a Node-only `lib`.
 */
function readBodyText(): string {
  const doc = (globalThis as { document?: { body?: { innerText?: string } } }).document;
  return doc?.body?.innerText ?? "";
}

function failed(url: string, capturedAt: string, reason: string): CaptureResult {
  return {
    ok: false,
    capturedAt,
    requestedUrl: url,
    finalUrl: null,
    httpStatus: null,
    responseHeaders: {},
    pageTitle: null,
    textLength: 0,
    captureMethod: "direct-browser",
    screenshotFullPage: false,
    artifacts: [],
    failure: reason,
  };
}

/**
 * Captures the page, falling back to the proxy tier when the site refuses us.
 *
 * The order matters. A direct photograph of the live page is the stronger
 * record and is always tried first; the proxy path exists because the sites
 * worth filing against are precisely the ones that block datacentre traffic,
 * and the alternative is that our highest-severity findings are permanently
 * unenforceable.
 */
export async function capturePage(opts: CaptureOptions): Promise<CaptureResult> {
  const log = opts.logger ?? silentLogger;

  /**
   * The guard runs once, here, before either tier.
   *
   * It used to sit inside the direct attempt, which quietly made the proxy a
   * way around it: a URL our own browser refused would fall through to a
   * third-party fetcher, and whatever came back would be rendered into an
   * evidence bundle. Refusing to fetch a URL has to mean refusing to fetch it
   * by any route.
   */
  try {
    await assertUrlIsFetchable(opts.url);
  } catch (err) {
    const reason = err instanceof BlockedUrlError ? err.message : String(err);
    log.warn("evidence url blocked", { url: opts.url, reason });
    return failed(opts.url, new Date().toISOString(), reason);
  }

  const direct = await captureDirect(opts);
  if (direct.ok || !opts.scraper) return direct;

  log.info("direct capture defeated; trying the proxy tier", {
    url: opts.url,
    reason: direct.failure,
  });
  const viaProxy = await captureViaProxy(opts, opts.scraper);
  // Falling back must not lose why the first attempt failed — that is the
  // sentence an admin reads when both fail.
  return viaProxy.ok
    ? viaProxy
    : { ...viaProxy, failure: `${direct.failure}; proxy tier also failed: ${viaProxy.failure}` };
}

async function captureDirect(opts: CaptureOptions): Promise<CaptureResult> {
  const log = opts.logger ?? silentLogger;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const capturedAt = new Date().toISOString();

  let context: BrowserContext | null = null;
  try {
    context = await opts.browser.newContext({
      userAgent: opts.userAgent ?? DEFAULT_UA,
      // Taller than the scan viewport: the fold matters when a human reviews
      // the shot, and a short viewport pushes the listing off-screen.
      viewport: { width: 1280, height: 1024 },
      ignoreHTTPSErrors: true,
    });
    context.setDefaultTimeout(timeoutMs);

    const page = await context.newPage();
    page.on("download", (d) => void d.cancel());

    const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Marketplace listings render client-side; a shot taken too early proves nothing.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    const [pageTitle, html, rawText] = await Promise.all([
      page.title().catch(() => null),
      page.content().catch(() => ""),
      page.evaluate(readBodyText).catch(() => ""),
    ]);
    const pageText = (rawText ?? "").replace(/\s+/g, " ").trim();

    // Chromium caps texture height, so a very long page can defeat fullPage.
    // A viewport shot is worth far more than no shot, but the difference is
    // recorded because it changes what the image proves.
    let screenshotFullPage = true;
    let shot = await page
      .screenshot({ type: "png", fullPage: true })
      .catch(async (err: unknown) => {
        log.warn("full-page screenshot failed; falling back to viewport", {
          url: opts.url,
          error: err instanceof Error ? err.message : String(err),
        });
        screenshotFullPage = false;
        return page.screenshot({ type: "png", fullPage: false }).catch(() => null);
      });
    if (!shot) shot = null;

    const status = response?.status() ?? null;
    const headers = response ? await response.allHeaders().catch(() => ({})) : {};
    const finalUrl = page.url();

    /**
     * A screenshot is necessary but nowhere near sufficient. DHgate answers our
     * browser with a 403 "Access Denied" page, which screenshots perfectly
     * well — filing that as proof of a counterfeit listing is precisely the
     * knowingly-false notice §512(f) creates liability for. So the same two
     * defeat signals the scanner uses decide it here: an error status, or a
     * page whose rendered text is too thin to be the listing.
     */
    const defeat = !shot
      ? `no screenshot could be taken (status ${status ?? "unknown"})`
      : status !== null && status >= 400
        ? `server returned ${status} (${pageTitle ?? "no title"}); the listing was not served to us`
        : pageText.length < MIN_USEFUL_TEXT
          ? `page rendered only ${pageText.length} characters (${pageTitle ?? "no title"}); an interstitial, not the listing`
          : null;

    if (defeat) {
      log.warn("capture defeated", { url: opts.url, status, chars: pageText.length, reason: defeat });
      return {
        ...failed(opts.url, capturedAt, defeat),
        finalUrl,
        httpStatus: status,
        responseHeaders: headers,
        pageTitle,
        textLength: pageText.length,
      };
    }

    const artifacts: EvidenceArtifact[] = [
      artifactOf("screenshot.png", "image/png", shot!),
      artifactOf("page.html", "text/html", Buffer.from(html, "utf8")),
      // The rendered text as well as the source: a reviewer should be able to
      // read what the page said without executing anything it served us.
      artifactOf("page.txt", "text/plain", Buffer.from(pageText, "utf8")),
      jsonArtifact("response.json", { requestedUrl: opts.url, finalUrl, httpStatus: status, headers, capturedAt }),
    ];

    log.info("evidence captured", {
      url: opts.url,
      status,
      bytes: shot!.byteLength,
      chars: pageText.length,
      fullPage: screenshotFullPage,
    });

    return {
      ok: true,
      capturedAt,
      requestedUrl: opts.url,
      finalUrl,
      httpStatus: status,
      responseHeaders: headers,
      pageTitle,
      textLength: pageText.length,
      captureMethod: "direct-browser",
      screenshotFullPage,
      artifacts,
      failure: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("evidence capture failed", { url: opts.url, error: message });
    return failed(opts.url, capturedAt, message);
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Tier 2: fetch the markup through a proxy that the site will answer, then
 * render it in our own browser and photograph the result.
 *
 * What this produces is a screenshot of markup the origin served at a known
 * time, not a photograph of the live page — the manifest says so, and the
 * distinction matters if a notice is ever challenged. The page's own assets
 * still load from the origin through an injected `<base>`, so what a reviewer
 * sees is the real layout: measured against DHgate, 131 images and stylesheets
 * loaded and none failed.
 *
 * The page is not otherwise altered. It is tempting to inject CSS to hide an
 * overlay the site happens to serve, and that is exactly the thing you must not
 * do to evidence — a human reviews every notice, and a cosmetic imperfection is
 * their problem to weigh, not ours to edit away.
 */
async function captureViaProxy(opts: CaptureOptions, scraper: ScrapeProvider): Promise<CaptureResult> {
  const log = opts.logger ?? silentLogger;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const capturedAt = new Date().toISOString();

  let fetched;
  try {
    fetched = await scraper.scrape(opts.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("proxy fetch failed", { url: opts.url, error: message });
    return { ...failed(opts.url, capturedAt, message), captureMethod: "proxy-html-rendered" };
  }

  if (!fetched.html) {
    return {
      ...failed(opts.url, capturedAt, `${scraper.name} returned no HTML to render`),
      captureMethod: "proxy-html-rendered",
    };
  }
  if (fetched.statusCode >= 400) {
    return {
      ...failed(opts.url, capturedAt, `${scraper.name} saw status ${fetched.statusCode}`),
      captureMethod: "proxy-html-rendered",
      httpStatus: fetched.statusCode,
    };
  }
  if (fetched.text.length < MIN_USEFUL_TEXT) {
    return {
      ...failed(opts.url, capturedAt, `${scraper.name} returned only ${fetched.text.length} characters`),
      captureMethod: "proxy-html-rendered",
      httpStatus: fetched.statusCode,
      textLength: fetched.text.length,
    };
  }

  /**
   * Re-extracted from the HTML rather than reusing `fetched.text`, which is
   * truncated to what the classifier reads. Evidence is not a model input: the
   * artifact has to be everything the page said, or a quote further down it
   * cannot be corroborated from the bundle.
   */
  const fullText = htmlToText(fetched.html);

  let context: BrowserContext | null = null;
  try {
    context = await opts.browser.newContext({
      userAgent: opts.userAgent ?? DEFAULT_UA,
      viewport: { width: 1280, height: 1024 },
      ignoreHTTPSErrors: true,
    });
    context.setDefaultTimeout(timeoutMs);
    const page = await context.newPage();
    page.on("download", (d) => void d.cancel());

    await page.setContent(withBaseHref(fetched.html, fetched.finalUrl), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    let screenshotFullPage = true;
    const shot = await page.screenshot({ type: "png", fullPage: true }).catch(async () => {
      screenshotFullPage = false;
      return page.screenshot({ type: "png", fullPage: false }).catch(() => null);
    });

    if (!shot) {
      return {
        ...failed(opts.url, capturedAt, "the proxied markup could not be rendered to an image"),
        captureMethod: "proxy-html-rendered",
        httpStatus: fetched.statusCode,
      };
    }

    log.info("evidence captured via proxy", {
      url: opts.url,
      provider: scraper.name,
      status: fetched.statusCode,
      bytes: shot.byteLength,
      chars: fullText.length,
      costMicros: fetched.costMicros,
    });

    return {
      ok: true,
      capturedAt,
      requestedUrl: opts.url,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.statusCode,
      // The proxy reports no response headers, and inventing them would be
      // worse than an honest absence.
      responseHeaders: {},
      pageTitle: fetched.title,
      textLength: fullText.length,
      captureMethod: "proxy-html-rendered",
      screenshotFullPage,
      artifacts: [
        artifactOf("screenshot.png", "image/png", shot),
        artifactOf("page.html", "text/html", Buffer.from(fetched.html, "utf8")),
        artifactOf("page.txt", "text/plain", Buffer.from(fullText, "utf8")),
        jsonArtifact("response.json", {
          requestedUrl: opts.url,
          finalUrl: fetched.finalUrl,
          httpStatus: fetched.statusCode,
          capturedAt,
          captureMethod: "proxy-html-rendered",
          proxyProvider: scraper.name,
        }),
      ],
      failure: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("proxy render failed", { url: opts.url, error: message });
    return { ...failed(opts.url, capturedAt, message), captureMethod: "proxy-html-rendered" };
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Without this the page's relative asset URLs resolve to nothing and the
 * screenshot is an unstyled skeleton. Prepended to `<head>` so a `<base>` the
 * document already declares wins, since that is what the browser would have
 * honoured on the live page.
 */
export function withBaseHref(html: string, finalUrl: string): string {
  let origin: string;
  try {
    origin = new URL(finalUrl).origin + "/";
  } catch {
    return html;
  }
  const tag = `<base href="${origin}">`;
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${tag}`)
    : `${tag}${html}`;
}
