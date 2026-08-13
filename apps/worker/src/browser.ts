import { PageFetcher, StealthScraper } from "@defenex/core";
import { env } from "./env.js";
import { coreLogger, logger } from "./logger.js";

let fetcher: PageFetcher | null = null;

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
export function getFetcher(): PageFetcher {
  if (!fetcher) {
    fetcher = new PageFetcher({
      logger: coreLogger,
      screenshot: true,
      stealth: new StealthScraper({ apiKey: env.YEPAPI_API_KEY, logger: coreLogger }),
    });
  }
  return fetcher;
}

/**
 * Must be called from the signal handler, not only from a `finally`. Railway
 * sends SIGTERM on every redeploy, and a leaked browser compounds across
 * deploys until the container runs out of memory.
 */
export async function closeBrowser(): Promise<void> {
  const current = fetcher;
  fetcher = null;
  if (current) {
    logger.info("closing shared browser");
    await current.close().catch(() => {});
  }
}
