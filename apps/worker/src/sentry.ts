import * as Sentry from "@sentry/node";
import { env } from "./env.js";
import { scrub } from "./scrub.js";

/**
 * Imported first in `index.ts`, before anything that can throw.
 *
 * Scrubbing lives in `scrub.ts`, which carries no env dependency and is tested
 * directly.
 */

export const sentryEnabled = Boolean(env.SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // We scrub deliberately below; do not also opt into sending PII.
    sendDefaultPii: false,
    beforeSend: (event) => scrub(event),
    beforeSendTransaction: (event) => scrub(event),
  });
}

/**
 * Every exit path in this process calls `process.exit()`, which drops anything
 * Sentry has queued. Awaited before each of them.
 */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!sentryEnabled) return;
  await Sentry.flush(timeoutMs).catch(() => {});
}

/** Tagged so takedown failures can carry their own alert rule. */
export function captureJobFailure(queue: string, jobId: string | undefined, err: Error): void {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("queue", queue);
    scope.setTag("subsystem", TAKEDOWN_QUEUES.has(queue) ? "takedown" : "scan");
    if (jobId) scope.setTag("jobId", jobId);
    Sentry.captureException(err);
  });
}

/** These three carry legal filings; a silent failure there is not acceptable. */
const TAKEDOWN_QUEUES = new Set(["evidence", "draft", "submit"]);

export { Sentry };

export function captureApiError(err: Error, method: string, path: string): void {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("subsystem", "api");
    // The path template, not the URL — ids in a tag fragment the grouping.
    scope.setContext("request", { method, path });
    Sentry.captureException(err);
  });
}

export function captureUnhandled(reason: unknown): void {
  if (!sentryEnabled) return;
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
}
