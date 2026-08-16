import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export { scanJobId, reportJobId, evidenceJobId, draftJobId } from "./job-ids.js";

export interface ScanJobData {
  scanId: string;
  brandId: string;
  brand: string;
  domain: string;
  industry: string;
  aliases: string[];
  allowlistDomains: string[];
  requestedByEmail?: string | null;
  /** Resolved from the requester's tier when the scan was accepted. */
  stealthBudget: number;
  /** Set by the scheduler. Only scheduled scans raise alerts. */
  scheduled?: boolean;
  /** Caller may request FEWER queries than the configured budget, never more. */
  queryBudget?: number;
}

export interface AlertJobData {
  brandId: string;
  scanId: string;
  /** url_hashes that are new or have reappeared since the previous scan. */
  changedHashes: string[];
}

export interface EvidenceJobData {
  takedownId: string;
}

export interface DraftJobData {
  takedownId: string;
}

export interface ReportJobData {
  scanId: string;
  email?: string | null;
}

export const QUEUE_SCAN = "scan";
export const QUEUE_REPORT = "report";
export const QUEUE_ALERT = "alert";
export const QUEUE_SCHEDULE = "schedule";
export const QUEUE_EVIDENCE = "evidence";
export const QUEUE_DRAFT = "draft";

// BullMQ requires this to be null: with retries enabled a blocking command can
// abort mid-job and silently drop work.
const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const connection: ConnectionOptions = redis;

/** Shared with the rate limiter so we hold one Redis connection, not two. */
export const redisClient = redis;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 10_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export const scanQueue = new Queue<ScanJobData>(QUEUE_SCAN, { connection, defaultJobOptions });
export const reportQueue = new Queue<ReportJobData>(QUEUE_REPORT, { connection, defaultJobOptions });
export const alertQueue = new Queue<AlertJobData>(QUEUE_ALERT, { connection, defaultJobOptions });
export const scheduleQueue = new Queue(QUEUE_SCHEDULE, { connection, defaultJobOptions });
export const draftQueue = new Queue<DraftJobData>(QUEUE_DRAFT, { connection, defaultJobOptions });
export const evidenceQueue = new Queue<EvidenceJobData>(QUEUE_EVIDENCE, {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    // A site that blocks the browser will block it again in ten seconds. Two
    // attempts covers a transient network failure; beyond that the job records
    // `blocked_no_evidence` and an admin retries deliberately.
    attempts: 2,
    backoff: { type: "fixed", delay: 30_000 },
  },
});

const workers: Worker[] = [];

export function startWorkers(handlers: {
  scan: Processor<ScanJobData>;
  report: Processor<ReportJobData>;
  alert: Processor<AlertJobData>;
  schedule: Processor;
  evidence: Processor<EvidenceJobData>;
  draft: Processor<DraftJobData>;
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

  const alertWorker = new Worker<AlertJobData>(QUEUE_ALERT, handlers.alert, {
    connection,
    concurrency: 3,
  });

  const scheduleWorker = new Worker(QUEUE_SCHEDULE, handlers.schedule, {
    connection,
    // One at a time: two concurrent ticks could both see the same brand as due.
    concurrency: 1,
  });

  const evidenceWorker = new Worker<EvidenceJobData>(QUEUE_EVIDENCE, handlers.evidence, {
    connection,
    // Shares the one browser with running scans; more than two concurrent
    // full-page captures is how the container runs out of memory.
    concurrency: 2,
    lockDuration: 5 * 60_000,
  });

  const draftWorker = new Worker<DraftJobData>(QUEUE_DRAFT, handlers.draft, {
    connection,
    concurrency: 2,
    lockDuration: 3 * 60_000,
  });

  for (const w of [scanWorker, reportWorker, alertWorker, scheduleWorker, evidenceWorker, draftWorker]) {
    w.on("failed", (job, err) =>
      logger.error({ queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, "job failed"),
    );
    w.on("completed", (job) => logger.info({ queue: w.name, jobId: job.id }, "job completed"));
    workers.push(w);
  }

  return workers;
}

/**
 * Registers the repeatable scheduler tick. Idempotent: BullMQ keys a repeatable
 * job by name and pattern, so a redeploy re-registers rather than duplicating.
 */
export async function startScheduler(intervalMinutes: number): Promise<void> {
  await scheduleQueue.add(
    "tick",
    {},
    {
      repeat: { every: intervalMinutes * 60_000 },
      jobId: "schedule-tick",
      removeOnComplete: { count: 20 },
    },
  );
}

/** Stop consuming and let in-flight jobs finish before the process exits. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([
    scanQueue.close(), reportQueue.close(), alertQueue.close(), scheduleQueue.close(),
    evidenceQueue.close(), draftQueue.close(),
  ]);
  await redis.quit().catch(() => {});
}
