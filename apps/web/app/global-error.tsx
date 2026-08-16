"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last resort: an error thrown in the root layout, where the normal shell is
 * not available. Replaces `<html>` entirely, so it carries its own colours.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0a0b0d", color: "#e8eaed", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ margin: "0 auto", maxWidth: "36rem", padding: "6rem 1.5rem" }}>
          <p
            style={{
              color: "#6b7280",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Error
          </p>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0.75rem 0 0" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#9ba1a8", lineHeight: 1.6, margin: "0.75rem 0 0" }}>
            This has been reported. Reload the page, and if it keeps happening, tell us at{" "}
            <a href="mailto:support@defenex.com" style={{ color: "#e8eaed" }}>
              support@defenex.com
            </a>
            .
          </p>
          {error.digest && (
            <p
              style={{
                color: "#6b7280",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                marginTop: "1.5rem",
              }}
            >
              reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
