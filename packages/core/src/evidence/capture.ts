import { createHash } from "node:crypto";
import type { Browser, BrowserContext } from "playwright";
import { assertUrlIsFetchable } from "../enrich/ssrf.js";
import { BlockedUrlError } from "../errors.js";
import { silentLogger, type Logger } from "../ports.js";

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
}

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
 * Below this, the fetch was defeated rather than the page being empty. The same
 * threshold the scanner uses, for the same reason: anti-bot systems serve a
 * 200 carrying an interstitial with almost no text.
 */
const MIN_USEFUL_TEXT = 200;

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
    screenshotFullPage: false,
    artifacts: [],
    failure: reason,
  };
}

export async function capturePage(opts: CaptureOptions): Promise<CaptureResult> {
  const log = opts.logger ?? silentLogger;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const capturedAt = new Date().toISOString();

  // Same guard as the scanner. A takedown can be requested for any finding, and
  // findings come from the open web.
  try {
    await assertUrlIsFetchable(opts.url);
  } catch (err) {
    const reason = err instanceof BlockedUrlError ? err.message : String(err);
    log.warn("evidence url blocked", { url: opts.url, reason });
    return failed(opts.url, capturedAt, reason);
  }

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
