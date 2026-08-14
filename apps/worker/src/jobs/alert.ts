import type { Job } from "bullmq";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { severityLabel } from "@defenex/core";
import { NewFindings, type AlertFinding } from "@defenex/emails";
import { alertableFindings, brands, getDb, getReportByScanId, getUserById } from "@defenex/db";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { AlertJobData } from "../queues.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Alerts on change, never on the standing list.
 *
 * A weekly digest repeating findings the customer has already seen trains them
 * to ignore the sender, and the whole value of monitoring is that the email is
 * worth opening. So this fires only for findings that are new or have returned,
 * and only above the brand's severity threshold.
 */
export async function processAlert(job: Job<AlertJobData>): Promise<void> {
  const { brandId, scanId, changedHashes } = job.data;
  const log = logger.child({ scanId, brandId });

  if (changedHashes.length === 0) {
    log.debug("alert: nothing changed");
    return;
  }

  const db = getDb();
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  if (!brand?.ownerUserId) {
    log.debug("alert: brand unowned, nothing to send");
    return;
  }

  const rows = await alertableFindings(brandId, scanId, changedHashes, brand.alertMinSeverity);
  if (rows.length === 0) {
    log.info({ changed: changedHashes.length }, "alert: changes were all below the threshold");
    return;
  }

  const owner = await getUserById(brand.ownerUserId);
  if (!owner) return;

  const report = await getReportByScanId(scanId);
  const reportUrl = report
    ? `${env.NEXT_PUBLIC_APP_URL}/r/${report.publicToken}`
    : `${env.NEXT_PUBLIC_APP_URL}/dashboard`;

  const findings: AlertFinding[] = rows.map((f) => ({
    url: f.url,
    category: f.category,
    severity: f.severity,
    severityLabel: severityLabel(f.severity),
    evidenceQuote: f.evidenceQuote,
    isReturning: f.status === "reappeared",
  }));

  if (!resend) {
    log.warn("alert: RESEND_API_KEY not set");
    return;
  }

  const html = await render(
    NewFindings({
      brand: brand.name,
      findings,
      reportUrl,
      manageUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard`,
    }),
  );

  const { error } = await resend.emails.send({
    from: `Defenex <alerts@${env.RESEND_FROM_DOMAIN}>`,
    to: owner.email,
    subject: `${findings.length} new ${findings.length === 1 ? "finding" : "findings"} for ${brand.name}`,
    html,
  });

  if (error) {
    log.error({ err: error.message }, "alert send failed");
    throw new Error(`resend: ${error.message}`);
  }
  log.info({ to: owner.email, findings: findings.length }, "alert sent");
}
