import * as Sentry from "@sentry/nextjs";

/**
 * Server and edge runtime initialisation. Next calls `register()` once per
 * runtime before any route handler runs.
 */
export async function register(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

export const onRequestError = Sentry.captureRequestError;

/**
 * The same policy as the worker's `src/scrub.ts`, deliberately duplicated
 * rather than shared: the two apps deploy separately and the web app consumes
 * no workspace package at runtime, so a shared module would have to be a build
 * dependency purely to hold two regex lists. Keep them in step by hand; the
 * worker's copy carries the tests.
 *
 * Customer email addresses are personal data and add nothing to a stack trace.
 * Credentials should not be in an event at all, but a serialised error can
 * carry a whole config object, so they are stripped rather than assumed absent.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRETS = [
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bwhsec_[A-Za-z0-9]{8,}/g,
  /\bre_[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /\bpostgres(ql)?:\/\/[^\s"']+/gi,
];
const SECRET_KEY = /(api[_-]?key|secret|token|password|authorization|cookie|dsn)/i;

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") {
    let out = value;
    for (const p of SECRETS) out = out.replace(p, "[redacted]");
    return out.replace(EMAIL, "[email]");
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "[redacted]" : scrubValue(v, depth + 1),
      ]),
    );
  }
  return value;
}

function scrubEvent<T>(event: T): T {
  return scrubValue(event) as T;
}
