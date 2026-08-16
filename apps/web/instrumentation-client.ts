import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side reporting. The DSN must be `NEXT_PUBLIC_` to be inlined into the
 * client bundle at build time; a bare `SENTRY_DSN` never reaches the browser.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    // No session replay and no PII: pages here show customers their own
    // findings and a recording would carry that off-site.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
