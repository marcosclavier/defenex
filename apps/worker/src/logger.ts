import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  // Scans touch attacker-controlled pages and customer data; keep obvious
  // secrets out of the log stream even when an error object carries them.
  redact: {
    paths: [
      "req.headers.authorization",
      "*.apiKey",
      "*.password",
      "*.WORKER_API_SECRET",
      "*.YEPAPI_API_KEY",
      "*.GEMINI_API_KEY",
    ],
    censor: "[redacted]",
  },
});

/** Adapter so packages/core can log through pino without depending on it. */
export const coreLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(meta ?? {}, msg),
  info: (msg: string, meta?: Record<string, unknown>) => logger.info(meta ?? {}, msg),
  warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(meta ?? {}, msg),
  error: (msg: string, meta?: Record<string, unknown>) => logger.error(meta ?? {}, msg),
};
