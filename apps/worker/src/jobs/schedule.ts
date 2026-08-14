import { listBrandsDueForScan, markScheduled } from "@defenex/db";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { scanJobId } from "../job-ids.js";
import { scanQueue } from "../queues.js";

/**
 * Enqueues rescans for brands whose cadence has elapsed.
 *
 * Runs on a repeatable job rather than a cron container so that scheduling
 * shares the queue's retry and concurrency behaviour, and so a redeploy cannot
 * miss a window — the next tick simply picks up whatever is overdue.
 */
export async function processSchedule(): Promise<void> {
  const due = await listBrandsDueForScan(env.SCHEDULE_BATCH_SIZE);
  if (due.length === 0) {
    logger.debug("scheduler: nothing due");
    return;
  }

  logger.info({ count: due.length }, "scheduler: enqueueing rescans");

  for (const brand of due) {
    try {
      // Claim the slot BEFORE enqueueing. If the enqueue then fails we lose one
      // cycle; if we marked afterwards, a crash between the two would re-enqueue
      // on every tick and bill a scan each time.
      await markScheduled(brand.id);

      const scanId = crypto.randomUUID();
      await scanQueue.add(
        "scan",
        {
          scanId,
          brandId: brand.id,
          brand: brand.name,
          domain: brand.domain,
          industry: brand.industry,
          aliases: brand.aliases,
          allowlistDomains: brand.allowlistDomains,
          requestedByEmail: null,
          // Paying customers get the full paid fetch tier.
          stealthBudget: env.STEALTH_BUDGET_IDENTIFIED,
          scheduled: true,
        },
        { jobId: scanJobId(scanId) },
      );

      logger.info({ brandId: brand.id, domain: brand.domain, plan: brand.plan }, "rescan enqueued");
    } catch (err) {
      logger.error(
        { brandId: brand.id, err: err instanceof Error ? err.message : String(err) },
        "scheduler: failed to enqueue",
      );
    }
  }
}
