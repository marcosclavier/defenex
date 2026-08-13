import { serve } from "@hono/node-server";
import { closeDb } from "@defenex/db";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { createApi } from "./api.js";
import { closeQueues, startWorkers } from "./queues.js";
import { processScan } from "./jobs/scan.js";
import { processReport } from "./jobs/report.js";
import { closeBrowser } from "./browser.js";

const server = serve({ fetch: createApi().fetch, port: env.PORT }, (info) =>
  logger.info({ port: info.port }, "worker listening"),
);

startWorkers({ scan: processScan, report: processReport });
logger.info(
  { scanConcurrency: env.SCAN_CONCURRENCY, reportConcurrency: env.REPORT_CONCURRENCY },
  "queue workers started",
);

/**
 * Railway sends SIGTERM on every redeploy.
 *
 * Order matters: stop accepting HTTP first, then let in-flight jobs drain, then
 * close the browser and the database pool. The browser close is the one that
 * bites if forgotten — a `finally` does not run on a signal, and each leaked
 * Chromium holds ~100MB, compounding across deploys until the container OOMs.
 */
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  const deadline = setTimeout(() => {
    logger.error("graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 25_000);
  deadline.unref();

  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueues();
    await closeBrowser();
    await closeDb();
    logger.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err: String(err) }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) =>
  logger.error({ reason: String(reason) }, "unhandled rejection"),
);
process.on("uncaughtException", (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
  void shutdown("SIGTERM");
});
