import type { Job } from "bullmq";
import {
  RdapClient,
  buildEvidenceBundle,
  capturePage,
  resolveIpv4,
  type RdapDomainRecord,
  type RdapIpRecord,
} from "@defenex/core";
import { getFinding, getTakedown, updateTakedown } from "@defenex/db";
import { coreLogger, logger } from "../logger.js";
import { getEvidenceScraper, withBrowser } from "../browser.js";
import { putObject } from "../storage/r2.js";
import { evidenceBundleKey } from "../storage/keys.js";
import { draftQueue, type EvidenceJobData } from "../queues.js";
import { draftJobId } from "../job-ids.js";

/**
 * Captures the evidence a notice cannot be filed without.
 *
 * The rule this job enforces: **no image, no filing.** A DMCA notice is a sworn
 * statement, and the page it describes will usually be gone before anyone
 * checks. If the capture fails the takedown stops at `blocked_no_evidence` and
 * waits for a human, rather than proceeding to a draft that reads as though
 * someone looked at the page.
 *
 * That case is not hypothetical: the highest-severity finding in production is
 * a DHgate listing that already defeated the browser once during the scan and
 * was only read through the paid stealth tier, which returns no screenshot.
 */

export async function processEvidence(job: Job<EvidenceJobData>): Promise<void> {
  const { takedownId } = job.data;
  const log = logger.child({ takedownId });

  const takedown = await getTakedown(takedownId);
  if (!takedown) {
    log.warn("takedown vanished before capture");
    return;
  }
  // Idempotent: a retry after a partial failure must not overwrite a bundle
  // that already exists and has already been reviewed.
  if (takedown.evidenceBundleKey) {
    log.info({ key: takedown.evidenceBundleKey }, "evidence already captured");
    return;
  }

  const finding = await getFinding(takedown.findingId);
  if (!finding) {
    await updateTakedown(takedownId, {
      status: "blocked_no_evidence",
      outcomeNote: "finding no longer exists",
    });
    return;
  }

  await updateTakedown(takedownId, { status: "capturing_evidence" });

  const capture = await withBrowser(async (fetcher) =>
    capturePage({
      url: finding.url,
      browser: await fetcher.browserHandle(),
      logger: coreLogger,
      // Sites worth filing against are the ones that block us hardest, so the
      // paid tier is not a luxury here — without it the highest-severity
      // findings would be permanently unenforceable.
      scraper: getEvidenceScraper(),
    }),
  );

  if (!capture.ok) {
    log.warn({ url: finding.url, reason: capture.failure }, "capture failed; blocking takedown");
    await updateTakedown(takedownId, {
      status: "blocked_no_evidence",
      outcomeNote: `evidence capture failed: ${capture.failure ?? "unknown"}`.slice(0, 1000),
    });
    // Not thrown: a page that blocks us is an outcome to be reviewed, not an
    // infrastructure fault to retry into.
    return;
  }

  const { rdapDomain, rdapIp, lookupErrors } = await lookupRegistrations(finding.url);

  const bundle = buildEvidenceBundle({
    takedownId,
    findingId: finding.id,
    brandId: takedown.brandId,
    capture,
    rdapDomain,
    rdapIp,
    lookupErrors,
  });

  const key = evidenceBundleKey(takedownId);
  const stored = await putObject(key, Buffer.from(bundle.zip), "application/zip");
  if (!stored) {
    // Captured but not preserved is the same as not captured: the page will be
    // gone by the time anyone asks, and the bytes are only in this process.
    await updateTakedown(takedownId, {
      status: "blocked_no_evidence",
      outcomeNote: "evidence captured but upload to object storage failed",
    });
    log.error({ key }, "evidence upload failed");
    throw new Error(`evidence upload failed for ${takedownId}`);
  }

  await updateTakedown(takedownId, {
    evidenceBundleKey: key,
    // Copied out of the archive so the drafter and the approval queue can read
    // the registrar, the host and the hashes without pulling megabytes back.
    evidenceManifest: bundle.manifest as unknown as Record<string, unknown>,
    status: "draft",
    outcomeNote: null,
  });

  log.info(
    {
      key,
      sha256: bundle.sha256,
      bytes: bundle.zip.byteLength,
      artifacts: bundle.manifest.artifacts.length,
      fullPage: capture.screenshotFullPage,
      method: capture.captureMethod,
      registrar: bundle.manifest.registrar?.name ?? null,
      host: bundle.manifest.host?.operator ?? null,
      lookupErrors: lookupErrors.length,
    },
    "evidence bundle stored",
  );

  // Drafting is a separate job: it calls a model and can fail on its own terms
  // without putting the capture — the part that cannot be redone later — at
  // risk of being repeated.
  await draftQueue.add("draft", { takedownId }, { jobId: draftJobId(takedownId) });
}

/**
 * Registrar and hosting provider, from the registries rather than from a page
 * we do not control. Neither lookup may fail the capture: the screenshot is the
 * evidence, and a missing abuse address only narrows which channels Stage 3 can
 * choose from.
 */
async function lookupRegistrations(url: string): Promise<{
  rdapDomain: RdapDomainRecord | null;
  rdapIp: RdapIpRecord | null;
  lookupErrors: string[];
}> {
  const rdap = new RdapClient({ logger: coreLogger });
  const lookupErrors: string[] = [];

  // Run together, not in sequence. Each has its own timeout and the RDAP
  // servers for some address blocks simply hang; serially that is twice the
  // wait for data neither the screenshot nor the filing decision depends on.
  const [rdapDomain, rdapIp] = await Promise.all([
    rdap.lookupDomain(url).catch((err: unknown) => {
      lookupErrors.push(`domain: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    (async () => {
      const host = hostnameOf(url);
      if (!host) return null;
      const ip = await resolveIpv4(host);
      if (!ip) {
        lookupErrors.push(`ip: could not resolve ${host}`);
        return null;
      }
      return rdap.lookupIp(ip).catch((err: unknown) => {
        lookupErrors.push(`ip: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
    })(),
  ]);

  return { rdapDomain, rdapIp, lookupErrors };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
