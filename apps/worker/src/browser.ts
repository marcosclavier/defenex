import {
  ChainedScraper,
  PageFetcher,
  SpiderScraper,
  StealthScraper,
  type ScrapeProvider,
} from "@defenex/core";
import { env } from "./env.js";
import { coreLogger, logger } from "./logger.js";

let fetcher: PageFetcher | null = null;

/** Jobs currently inside `withBrowser`. The browser is only closed at zero. */
let leases = 0;
/** Leases taken since the current browser launched; drives recycling. */
let leasesSinceLaunch = 0;
let idleTimer: NodeJS.Timeout | null = null;

/**
 * Runs `fn` with the shared fetcher, and closes the browser once nothing is
 * using it.
 *
 * The worker is idle almost all of the time, and a resident Chromium was most
 * of the Railway bill: it held ~2.3GB on average against ~0.6% of one vCPU, and
 * grew from 1.5GB to 3GB over a month without a redeploy, because a long-lived
 * browser process keeps memory its closed contexts never give back. Relaunching
 * costs about a second, against scans that take minutes.
 *
 * So the browser closes after `BROWSER_IDLE_MINUTES` with no lease, and is
 * recycled outright after `BROWSER_RECYCLE_AFTER_JOBS` leases even if the queue
 * never drains long enough to go idle. Every use of the browser must go through
 * here — a caller holding a `Browser` outside a lease can have it closed under it.
 */
export async function withBrowser<T>(fn: (fetcher: PageFetcher) => Promise<T>): Promise<T> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  leases++;
  leasesSinceLaunch++;
  try {
    return await fn(getFetcher());
  } finally {
    leases--;
    if (leases === 0) releaseIdle();
  }
}

function releaseIdle(): void {
  if (leasesSinceLaunch >= env.BROWSER_RECYCLE_AFTER_JOBS) {
    logger.info({ jobs: leasesSinceLaunch }, "recycling browser");
    void recycle();
    return;
  }
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (leases === 0) {
      logger.info({ idleMinutes: env.BROWSER_IDLE_MINUTES }, "closing idle browser");
      void recycle();
    }
  }, env.BROWSER_IDLE_MINUTES * 60_000);
  // An idle timer must not hold the process open during shutdown.
  idleTimer.unref();
}

/**
 * Closes the browser but keeps the fetcher; its next fetch relaunches. A lease
 * taken while this is closing is safe — the fetcher drops its handle before
 * awaiting the close, so the new lease launches a fresh browser.
 */
async function recycle(): Promise<void> {
  leasesSinceLaunch = 0;
  await fetcher?.close().catch(() => {});
}

/**
 * One browser for the whole process, shared across concurrent scans.
 *
 * A fetcher per job would multiply a ~300MB Chromium process by the queue
 * concurrency and OOM the container. Contexts are cheap and still isolate
 * cookies and storage between hostile pages.
 *
 * The paid stealth budget is deliberately NOT set here. It is per-scan, decided
 * by the caller from the requester's tier — holding it on this singleton meant
 * concurrent scans drew from one shared allowance.
 */
function getFetcher(): PageFetcher {
  if (!fetcher) {
    fetcher = new PageFetcher({
      logger: coreLogger,
      screenshot: true,
      stealth: getScanScraper(),
    });
  }
  return fetcher;
}

let scanScraper: ScrapeProvider | null = null;
let evidenceScraper: ScrapeProvider | null = null;

function spider(): ScrapeProvider | null {
  return env.SPIDER_CLOUD_API_KEY
    ? new SpiderScraper({ apiKey: env.SPIDER_CLOUD_API_KEY, logger: coreLogger })
    : null;
}

function yepapi(): ScrapeProvider {
  return new StealthScraper({ apiKey: env.YEPAPI_API_KEY, logger: coreLogger });
}

/**
 * The paid tier for scanning.
 *
 * Governed by `SCAN_FETCH_PROVIDER` rather than by the presence of a key,
 * because this choice changes what text the classifier reads and therefore what
 * counts as a finding — and reverting it should not need a deploy.
 */
export function getScanScraper(): ScrapeProvider {
  if (!scanScraper) {
    scanScraper = buildScanScraper();
    logger.info({ provider: scanScraper.name, configured: env.SCAN_FETCH_PROVIDER }, "scan fetch tier");
  }
  return scanScraper;
}

function buildScanScraper(): ScrapeProvider {
  const fast = spider();
  if (env.SCAN_FETCH_PROVIDER === "yepapi" || !fast) return yepapi();
  if (env.SCAN_FETCH_PROVIDER === "spider") return fast;
  // Price-ascending: the expensive provider only runs where the cheap one was
  // defeated, so coverage is the union and the bill stays close to the cheap one.
  return new ChainedScraper([fast, yepapi()], { logger: coreLogger });
}

/**
 * The paid tier for evidence capture. Always chained where both are available,
 * regardless of the scanner's setting.
 *
 * This only runs after our own browser has already been defeated, so the
 * alternative is not a different screenshot but no screenshot and a finding
 * nobody can enforce. Coverage is worth more here than anywhere else, and the
 * per-takedown cost of a second attempt is irrelevant next to it.
 */
export function getEvidenceScraper(): ScrapeProvider {
  if (!evidenceScraper) {
    const fast = spider();
    evidenceScraper = fast ? new ChainedScraper([fast, yepapi()], { logger: coreLogger }) : yepapi();
    logger.info({ provider: evidenceScraper.name }, "evidence fetch tier");
  }
  return evidenceScraper;
}

/**
 * Must be called from the signal handler, not only from a `finally`. Railway
 * sends SIGTERM on every redeploy, and a leaked browser compounds across
 * deploys until the container runs out of memory.
 */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  leasesSinceLaunch = 0;
  const current = fetcher;
  fetcher = null;
  if (current) {
    logger.info("closing shared browser");
    await current.close().catch(() => {});
  }
}
