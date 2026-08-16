import type { Job } from "bullmq";
import {
  GeminiDescriber,
  missingRequiredStatements,
  renderNotice,
  resolveChannel,
  unresolvedPlaceholders,
  APPROVER_PLACEHOLDER,
  type ChannelDecision,
  type NoticeDescriber,
  type RightsCitation,
} from "@defenex/core";
import { getBrand, getFinding, getTakedown, updateTakedown, verifiedRightsFor } from "@defenex/db";
import { env } from "../env.js";
import { coreLogger, logger } from "../logger.js";
import type { DraftJobData } from "../queues.js";

/**
 * Turns a captured takedown into a notice awaiting human approval.
 *
 * There is deliberately no path from here to submission. The job's output is a
 * document in a queue; a person reads it, edits it if they disagree with it,
 * and signs it. Stage 5 sends what that person approved, not what this wrote.
 */

export async function processDraft(job: Job<DraftJobData>): Promise<void> {
  const { takedownId } = job.data;
  const log = logger.child({ takedownId });

  const takedown = await getTakedown(takedownId);
  if (!takedown) {
    log.warn("takedown vanished before drafting");
    return;
  }
  // Only a fresh draft is written. Re-running must not overwrite a notice an
  // admin has already edited or approved.
  if (takedown.status !== "draft") {
    log.info({ status: takedown.status }, "takedown is past drafting; leaving it alone");
    return;
  }
  if (!takedown.evidenceBundleKey) {
    log.warn("no evidence bundle; refusing to draft");
    await updateTakedown(takedownId, {
      status: "blocked_no_evidence",
      reviewNotes: "drafting was attempted before evidence existed",
    });
    return;
  }

  const [finding, brand, rights] = await Promise.all([
    getFinding(takedown.findingId),
    getBrand(takedown.brandId),
    verifiedRightsFor(takedown.brandId),
  ]);

  if (!finding || !brand) {
    await updateTakedown(takedownId, { status: "declined", declinedReason: "finding or brand no longer exists" });
    return;
  }

  // The gate again, at the point of writing rather than only at the point of
  // asking. A verification could have been revoked in between.
  if (!rights) {
    await updateTakedown(takedownId, {
      status: "declined",
      declinedReason: "the brand no longer has a verified registration",
    });
    log.warn("drafting refused: rights verification is gone");
    return;
  }

  const manifest = (takedown.evidenceManifest ?? {}) as ManifestShape;
  const decision = resolveChannel({
    url: finding.url,
    category: finding.category,
    registrarAbuseEmail: manifest.registrar?.abuseEmail ?? null,
    registrarName: manifest.registrar?.name ?? null,
    hostAbuseEmail: manifest.host?.abuseEmail ?? null,
    hostOperator: manifest.host?.operator ?? null,
  });

  const snapshot = (rights.registrySnapshot ?? {}) as { markText?: string; ownerName?: string; registrationDate?: string };
  const citation: RightsCitation = {
    markText: snapshot.markText ?? brand.name,
    regNumber: rights.regNumber,
    jurisdiction: rights.jurisdiction,
    registeredAt: snapshot.registrationDate ?? null,
    ownerName: snapshot.ownerName ?? null,
  };

  const describer: NoticeDescriber = new GeminiDescriber({ apiKey: env.GEMINI_API_KEY, logger: coreLogger });
  const description = await describer.describe({
    brandName: brand.name,
    category: finding.category,
    noticeKind: decision.noticeKind,
    url: finding.url,
    pageTitle: typeof manifest.pageTitle === "string" ? manifest.pageTitle : null,
    evidenceQuote: finding.evidenceQuote,
    reasoning: finding.reasoning,
    markText: citation.markText,
  });

  const notice = renderNotice({
    noticeKind: decision.noticeKind,
    channel: decision.channel,
    recipient: decision.platform,
    category: finding.category,
    brandName: brand.name,
    // The owner of record, not our customer's account name: the notice speaks
    // for whoever the register says holds the mark.
    onBehalfOf: citation.ownerName ?? rights.attestedByName ?? brand.name,
    rights: citation,
    infringingUrl: finding.url,
    finalUrl: typeof manifest.finalUrl === "string" ? manifest.finalUrl : null,
    evidenceQuote: finding.evidenceQuote,
    evidence: {
      capturedAt: typeof manifest.capturedAt === "string" ? manifest.capturedAt : new Date().toISOString(),
      httpStatus: typeof manifest.httpStatus === "number" ? manifest.httpStatus : null,
      screenshotSha256: manifest.artifacts?.find((a) => a.name === "screenshot.png")?.sha256 ?? null,
    },
    description,
    signatory: {
      name: APPROVER_PLACEHOLDER,
      title: env.NOTICE_AGENT_TITLE,
      organisation: env.NOTICE_ORGANISATION,
      email: env.NOTICE_FROM_EMAIL,
      phone: env.NOTICE_AGENT_PHONE ?? null,
      address: env.NOTICE_AGENT_ADDRESS ?? null,
    },
  });

  // A template that has lost a sworn element is a defect in our code, not
  // something to send and find out about later.
  const missing = missingRequiredStatements(notice.body, decision.noticeKind);
  if (missing.length > 0) {
    log.error({ missing: missing.map((m) => m.id), kind: decision.noticeKind }, "rendered notice is missing required statements");
    await updateTakedown(takedownId, {
      status: "blocked_no_evidence",
      reviewNotes: `notice template is incomplete: ${missing.map((m) => `${m.id} (${m.because})`).join("; ")}`,
    });
    throw new Error(`notice for ${takedownId} is missing: ${missing.map((m) => m.id).join(", ")}`);
  }

  await updateTakedown(takedownId, {
    channel: decision.channel,
    noticeKind: decision.noticeKind,
    noticeSubject: notice.subject,
    noticeBody: notice.body,
    status: "pending_approval",
    submittedTo: decision.destination,
    reviewNotes: reviewNotesFor(decision, notice.body, rights.attestedByName),
  });

  log.info(
    {
      channel: decision.channel,
      kind: decision.noticeKind,
      method: decision.method,
      destination: decision.destination,
      blockers: decision.blockers.length,
      descriptionChars: description.length,
    },
    "notice drafted and queued for approval",
  );
}

interface ManifestShape {
  pageTitle?: unknown;
  finalUrl?: unknown;
  capturedAt?: unknown;
  httpStatus?: unknown;
  registrar?: { name?: string | null; abuseEmail?: string | null } | null;
  host?: { operator?: string | null; abuseEmail?: string | null } | null;
  artifacts?: Array<{ name: string; sha256: string }>;
}

function reviewNotesFor(decision: ChannelDecision, body: string, attestedBy: string | null): string {
  const notes = [decision.rationale, ...decision.blockers.map((b) => `BLOCKER: ${b}`)];

  if (!attestedBy) {
    // Every notice claims authority to act for the owner. Without the
    // customer's affirmation on file, that claim has nothing behind it.
    notes.push(
      "BLOCKER: the rights record carries no authorisation attestation, so the statement of authority in this notice is unsupported",
    );
  }

  const placeholders = unresolvedPlaceholders(body).filter((p) => p !== APPROVER_PLACEHOLDER);
  if (placeholders.length > 0) notes.push(`Unfilled fields: ${placeholders.join(", ")}`);
  notes.push(`Signature is filled in on approval; the approver is the person making these statements.`);

  if (decision.alternatives.length > 0) {
    notes.push(
      `Other routes: ${decision.alternatives.map((a) => `${a.platform} (${a.destination ?? "no address"})`).join("; ")}`,
    );
  }
  return notes.join("\n");
}
