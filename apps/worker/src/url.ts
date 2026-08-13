import { createHash } from "node:crypto";

/**
 * Canonical hash used as the dedupe key for findings.
 *
 * This drives the rescan diff: the same listing must hash identically across
 * scans, or a weekly rescan reports every existing finding as new. Marketplaces
 * append fresh tracking parameters on each visit, so those are stripped.
 */
export function urlHashOf(rawUrl: string): string {
  let canonical = rawUrl;
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|srsltid|ref|spm|_ga|mc_cid|igshid)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    canonical = u.toString().replace(/\/$/, "");
  } catch {
    /* unparseable input still needs a stable hash */
  }
  return createHash("sha256").update(canonical).digest("hex");
}
