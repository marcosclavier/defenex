import type { Job } from "bullmq";
import { Resend } from "resend";
import { getTakedown, markTakedownFiled, updateTakedown } from "@defenex/db";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { getObject } from "../storage/r2.js";
import { chargeEnforcement, isEmailChannel, type JobLogger } from "../enforcement.js";
import type { SubmitJobData } from "../queues.js";

/**
 * Sends an approved notice to a published abuse address.
 *
 * Only email channels reach this job. A platform's IP portal is filed by a
 * person: scripting those forms breaches the terms we are asking them to
 * enforce, and a suspended submitter account would take enforcement away from
 * every customer at once.
 *
 * The send is guarded by the state machine rather than by a flag. A takedown
 * arrives here as `awaiting_filing` and leaves as `submitted`, and that
 * transition only fires once — so a retry after a delivery error cannot put a
 * second sworn legal notice in front of the same recipient.
 */

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Resend caps a message at 40MB; stay well clear and link instead when large. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function processSubmit(job: Job<SubmitJobData>): Promise<void> {
  const { takedownId } = job.data;
  const log = logger.child({ takedownId });

  const takedown = await getTakedown(takedownId);
  if (!takedown) {
    log.warn("takedown vanished before submission");
    return;
  }
  if (takedown.status !== "awaiting_filing") {
    log.info({ status: takedown.status }, "not awaiting filing; nothing to send");
    return;
  }
  if (!isEmailChannel(takedown.channel)) {
    log.warn({ channel: takedown.channel }, "portal channel reached the submit queue; a person files these");
    return;
  }
  if (!takedown.noticeBody || !takedown.submittedTo || !takedown.approvedByUserId) {
    await updateTakedown(takedownId, {
      status: "pending_approval",
      reviewNotes: "submission aborted: the notice, recipient or approver was missing",
    });
    log.error("approved takedown was missing its notice, recipient or approver");
    return;
  }
  if (!resend) {
    log.error("RESEND_API_KEY not set; cannot send notice");
    throw new Error("resend not configured");
  }

  const attachments = await evidenceAttachment(takedown.evidenceBundleKey, takedownId, log);

  const { error } = await resend.emails.send({
    // Must match the contact address inside the notice: the body swears to it,
    // and a mismatched envelope is the first thing an abuse desk distrusts.
    from: `${env.NOTICE_ORGANISATION} <${env.NOTICE_FROM_EMAIL}>`,
    replyTo: env.NOTICE_FROM_EMAIL,
    to: takedown.submittedTo,
    subject: takedown.noticeSubject ?? "Infringement notice",
    // Plain text, not HTML. Abuse desks parse these into ticketing systems, and
    // a legal notice has no need of styling.
    text: takedown.noticeBody,
    ...(attachments ? { attachments } : {}),
  });

  if (error) {
    log.error({ err: error.message, to: takedown.submittedTo }, "notice send failed");
    // Left in `awaiting_filing`, so the retry re-enters cleanly.
    throw new Error(`resend: ${error.message}`);
  }

  const filed = await markTakedownFiled(takedownId, { submittedTo: takedown.submittedTo });
  if (!filed.ok) {
    // Sent but the transition lost a race. Do not retry — that would send again.
    log.error({ reason: filed.reason }, "notice sent but could not be recorded as filed");
    return;
  }

  await chargeEnforcement(filed.takedown, log);
  log.info(
    { to: takedown.submittedTo, channel: takedown.channel, attached: Boolean(attachments) },
    "notice sent",
  );
}

/**
 * The preserved evidence travels with the notice. A signed URL would be the
 * cheaper option, but a complaint can sit in a queue for days and a link that
 * has expired by the time someone opens it is worse than no link at all.
 */
async function evidenceAttachment(
  key: string | null,
  takedownId: string,
  log: JobLogger,
): Promise<Array<{ filename: string; content: string }> | null> {
  if (!key) return null;

  const bytes = await getObject(key);
  if (!bytes) {
    log.warn({ key }, "evidence bundle could not be read; sending without it");
    return null;
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    log.warn({ key, bytes: bytes.byteLength }, "evidence bundle too large to attach");
    return null;
  }
  return [{ filename: `evidence-${takedownId}.zip`, content: bytes.toString("base64") }];
}
