import {
  getFinding,
  listTakedownsDueForVerification,
  recordVerification,
  VERIFY_MAX_ATTEMPTS,
} from "@defenex/db";
import type { Browser } from "playwright";
import { assertUrlIsFetchable } from "@defenex/core";
import { logger } from "../logger.js";
import { withBrowser } from "../browser.js";
import { env } from "../env.js";

/**
 * Goes back and checks whether the page actually came down.
 *
 * This is the only part of the system that can tell a customer their money did
 * something. It re-fetches one URL rather than re-running a scan, so it costs
 * nothing and can run daily.
 *
 * "Gone" is deliberately conservative. A 404 is clear enough, but so is a page
 * that still loads with the infringing text stripped out — a marketplace often
 * pulls the listing content and leaves the URL answering. What it will not do
 * is treat a fetch failure as success: our own network trouble looks exactly
 * like a removal from here, which is why two consecutive observations are
 * required before anything is concluded.
 */

/** Statuses that mean the page itself is gone, not merely unreachable. */
const GONE_STATUSES = new Set([404, 410, 451]);

export async function processVerify(): Promise<void> {
  const due = await listTakedownsDueForVerification(env.SCHEDULE_BATCH_SIZE);
  if (due.length === 0) {
    logger.debug("verify: nothing due");
    return;
  }

  logger.info({ due: due.length }, "verify: re-checking submitted takedowns");

  for (const takedown of due) {
    const log = logger.child({ takedownId: takedown.id });
    try {
      const finding = await getFinding(takedown.findingId);
      if (!finding) {
        log.warn("verify: finding is gone; skipping");
        continue;
      }

      const outcome = await checkUrl(finding.url, finding.evidenceQuote);
      if (outcome === "unknown") {
        // Not recorded as either result: an inconclusive check must not count
        // towards the streak in either direction.
        log.info({ url: finding.url }, "verify: inconclusive, will look again");
        continue;
      }

      const { confirmed, streak } = await recordVerification(takedown.id, outcome === "gone");
      log.info(
        { url: finding.url, outcome, streak, confirmed, attempt: takedown.verifyAttempts + 1 },
        confirmed ? "verify: removal confirmed" : "verify: recorded",
      );

      if (!confirmed && takedown.verifyAttempts + 1 >= VERIFY_MAX_ATTEMPTS) {
        log.info({ url: finding.url }, "verify: giving up; needs a human to decide on escalation");
      }
    } catch (err) {
      // One bad URL must not abort the sweep.
      log.warn({ err: String(err) }, "verify: check failed");
    }
  }
}

type Outcome = "gone" | "present" | "unknown";

async function checkUrl(url: string, evidenceQuote: string): Promise<Outcome> {
  try {
    await assertUrlIsFetchable(url);
  } catch {
    return "unknown";
  }

  return withBrowser(async (fetcher) => checkInBrowser(await fetcher.browserHandle(), url, evidenceQuote));
}

async function checkInBrowser(browser: Browser, url: string, evidenceQuote: string): Promise<Outcome> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await context.newPage();
    page.on("download", (d) => void d.cancel());
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1_200);

    const status = response?.status() ?? 0;
    if (GONE_STATUSES.has(status)) return "gone";
    // A block page or a server error tells us nothing about the listing.
    if (status === 0 || status >= 500 || status === 403 || status === 429) return "unknown";

    const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")) as string;
    const normalised = text.replace(/\s+/g, " ").toLowerCase();
    if (normalised.length < 200) return "unknown";

    // The quote was verified to appear on the page when the finding was made.
    // Its disappearance is the most direct evidence the content was pulled.
    const needle = evidenceQuote.replace(/\s+/g, " ").trim().toLowerCase();
    if (needle.length >= 12 && !normalised.includes(needle)) return "gone";

    return "present";
  } catch {
    return "unknown";
  } finally {
    await context.close().catch(() => {});
  }
}
