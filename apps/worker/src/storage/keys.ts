import { createHash } from "node:crypto";

/**
 * Object keys, kept apart from the R2 client on purpose.
 *
 * `r2.ts` reads the environment at import time, so anything importing it drags
 * the whole worker config into scope — including tests, which then fail on
 * missing credentials they never use. Key layout is pure string work and
 * belongs where it can be asserted on directly.
 */

/** Content-addressed so re-running a scan does not duplicate identical images. */
export function screenshotKey(scanId: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return `screenshots/${scanId}/${hash}.jpg`;
}

export const EVIDENCE_KEY_PREFIX = "evidence";

/** One bundle per takedown: recapture overwrites rather than accumulating. */
export function evidenceBundleKey(takedownId: string): string {
  return `${EVIDENCE_KEY_PREFIX}/${takedownId}.zip`;
}
