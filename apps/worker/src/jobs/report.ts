import { randomBytes } from "node:crypto";
import type { Job } from "bullmq";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { severityLabel } from "@defenex/core";
import { ScanReport, type ReportFinding } from "@defenex/emails";
import { createReport, getScan, listFindings, updateScanProgress } from "@defenex/db";
import { getDb, brands } from "@defenex/db";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { getFetcher } from "../browser.js";
import { putObject } from "../storage/r2.js";
import type { ReportJobData } from "../queues.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** 32 random bytes — never a sequential id, since this is a public URL. */
function publicToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function processReport(job: Job<ReportJobData>): Promise<void> {
  const { scanId } = job.data;
  const log = logger.child({ scanId });

  const scan = await getScan(scanId);
  if (!scan) {
    log.warn("report requested for unknown scan");
    return;
  }

  const db = getDb();
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, scan.brandId) });
  if (!brand) {
    log.warn("report requested for unknown brand");
    return;
  }

  const rows = await listFindings(scanId);
  const findings: ReportFinding[] = rows.map((f) => ({
    url: f.url,
    domain: f.domain,
    category: f.category,
    severity: f.severity,
    severityLabel: severityLabel(f.severity),
    confidence: f.confidence,
    evidenceQuote: f.evidenceQuote,
    // Surfaced deliberately: stealth-sourced findings have text evidence but no
    // visual evidence, and a takedown notice needs the screenshot.
    hasScreenshot: Boolean(f.screenshotKey),
  }));

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.category] = (counts[f.category] ?? 0) + 1;

  const token = publicToken();
  await createReport(scanId, token);
  const reportUrl = `${env.NEXT_PUBLIC_APP_URL}/r/${token}`;

  const html = await render(
    ScanReport({
      brand: brand.name,
      domain: brand.domain,
      findings,
      counts,
      reportUrl,
      scannedAt: (scan.finishedAt ?? new Date()).toISOString().slice(0, 10),
    }),
  );

  // Render the PDF from the same HTML rather than from the web report route,
  // so report delivery does not depend on the web app being deployed.
  const pdfKey = await renderPdf(scanId, html).catch((err) => {
    log.warn({ err: String(err) }, "pdf render failed; sending without attachment");
    return null;
  });

  const recipient = job.data.email ?? scan.requestedByEmail;
  if (!recipient) {
    log.info({ reportUrl }, "report generated; no recipient on file");
    return;
  }
  if (!resend) {
    log.warn("RESEND_API_KEY not set; report generated but not emailed");
    return;
  }

  const subject =
    findings.length > 0
      ? `${findings.length} potential infringement${findings.length === 1 ? "" : "s"} found for ${brand.name}`
      : `Brand scan complete: no infringements found for ${brand.name}`;

  const { error } = await resend.emails.send({
    from: `Defenex <reports@${env.RESEND_FROM_DOMAIN}>`,
    to: recipient,
    subject,
    html,
  });

  if (error) {
    log.error({ err: error.message }, "report email failed");
    throw new Error(`resend: ${error.message}`);
  }

  await updateScanProgress(scanId, {});
  log.info({ recipient, findings: findings.length, pdfKey }, "report sent");
}

async function renderPdf(scanId: string, html: string): Promise<string | null> {
  const fetcher = getFetcher();
  const browser = await fetcher.browserHandle();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" } });
    return await putObject(`reports/${scanId}.pdf`, Buffer.from(pdf), "application/pdf");
  } finally {
    await context.close().catch(() => {});
  }
}
