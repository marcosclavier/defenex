import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export { scanJobId, reportJobId } from "./job-ids.js";

export interface ScanJobData {
  scanId: string;
  brandId: string;
  brand: string;
  domain: string;
  industry: string;
  aliases: string[];
  allowlistDomains: string[];
  requestedByEmail?: string | null;
}

export interface ReportJobData {
  scanId: string;
  email?: string | null;
}

export const QUEUE_SCAN = "scan";
export const QUEUE_REPORT = "report";

// BullMQ requires this to be null: with retries enabled a blocking command can
// abort mid-job and silently drop work.
const connection: ConnectionOptions = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 10_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export const scanQueue = new Queue<ScanJobData>(QUEUE_SCAN, { connection, defaultJobOptions });
export const reportQueue = new Queue<ReportJobData>(QUEUE_REPORT, { connection, defaultJobOptions });

const workers: Worker[] = [];

export function startWorkers(handlers: {
  scan: Processor<ScanJobData>;
  report: Processor<ReportJobData>;
}): Worker[] {
  const scanWorker = new Worker<ScanJobData>(QUEUE_SCAN, handlers.scan, {
    connection,
    concurrency: env.SCAN_CONCURRENCY,
    // A scan runs a browser and several model calls; give it room before
    // BullMQ decides the job is stalled and re-runs it.
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
  });

  const reportWorker = new Worker<ReportJobData>(QUEUE_REPORT, handlers.report, {
    connection,
    concurrency: env.REPORT_CONCURRENCY,
    lockDuration: 5 * 60_000,
  });

  for (const w of [scanWorker, reportWorker]) {
    w.on("failed", (job, err) =>
      logger.error({ queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, "job failed"),
    );
    w.on("completed", (job) => logger.info({ queue: w.name, jobId: job.id }, "job completed"));
    workers.push(w);
  }

  return workers;
}

/** Stop consuming and let in-flight jobs finish before the process exits. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([scanQueue.close(), reportQueue.close()]);
  await (connection as IORedis).quit().catch(() => {});
}
