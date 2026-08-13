import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { EvidenceRow } from "@/components/EvidenceRow";
import { getReport, WorkerError } from "@/lib/worker";

export const dynamic = "force-dynamic";

// A report is customer data behind an unguessable token, not public content.
export const metadata: Metadata = {
  title: "Scan report",
  robots: { index: false, follow: false },
};

const ORDER = ["critical", "high", "medium", "low"] as const;

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let report;
  try {
    report = await getReport(token);
  } catch (err) {
    if (err instanceof WorkerError && err.status === 404) notFound();
    throw err;
  }

  const { brand, scan, findings } = report;
  if (!brand) notFound();

  const counts = ORDER.map((label) => ({
    label,
    n: findings.filter((f) => f.severityLabel === label).length,
  })).filter((c) => c.n > 0);

  const withoutScreenshot = findings.filter((f) => !f.screenshotUrl).length;

  return (
    <>
      <Header />

      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <p className="t-eyebrow">Scan report</p>
        <h1 className="t-h2 mt-3">{brand.name}</h1>
        <p className="t-data mt-2 text-ink-dim">
          {brand.domain}
          {scan.finishedAt && ` · ${new Date(scan.finishedAt).toISOString().slice(0, 10)}`}
          {` · ${scan.resultsSeen.toLocaleString()} results examined`}
        </p>

        <section className="mt-10 border border-line bg-surface p-6">
          {findings.length === 0 ? (
            <>
              <h2 className="t-h3">Nothing met the evidence bar</h2>
              <p className="t-small measure mt-2 text-ink-dim">
                We examined {scan.resultsSeen.toLocaleString()} results and could not verify any of
                them as infringing. That is a real result, not an error — we only report a finding
                when we can quote the page text that supports it.
              </p>
            </>
          ) : (
            <>
              <h2 className="t-h3">
                {findings.length} {findings.length === 1 ? "finding" : "findings"}
              </h2>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {counts.map((c) => (
                  <span key={c.label} className="font-mono text-xs uppercase tracking-[0.14em] text-ink-dim">
                    {c.n} {c.label}
                  </span>
                ))}
              </div>
              {withoutScreenshot > 0 && (
                <p className="t-small mt-4 text-ink-mute">
                  {withoutScreenshot} of these were captured from a site that blocks automated
                  browsers, so they carry quoted text but no screenshot. An enforcement notice
                  needs the image, and we capture it before filing.
                </p>
              )}
            </>
          )}
        </section>

        {findings.length > 0 && (
          <section className="mt-10">
            <h2 className="t-eyebrow">Evidence</h2>
            <div className="mt-4 border border-line bg-surface">
              {findings.map((f) => (
                <EvidenceRow
                  key={f.url}
                  url={f.url}
                  category={f.category}
                  severity={f.severity}
                  severityLabel={f.severityLabel}
                  confidence={f.confidence}
                  evidenceQuote={f.evidenceQuote}
                  evidenceSource={f.evidenceSource}
                  screenshotUrl={f.screenshotUrl}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="t-h3">What happens next</h2>
          <p className="t-small measure mt-2 text-ink-dim">
            This scan is a snapshot. Infringing listings appear and disappear constantly, and a
            single scan will not catch a seller who relists next week. Monitoring re-runs this on a
            schedule and tells you only what is new.
          </p>
          <Link
            href="/scan"
            className="mt-5 inline-block border border-line-strong px-4 py-2.5 text-sm transition-colors hover:border-paper"
          >
            Scan another brand
          </Link>
        </section>

        <p className="t-small mt-10 text-ink-mute">
          Every quote above is text taken directly from the page it references. Findings describe
          what a page appears to do and are not legal conclusions.
        </p>
      </main>

      <Footer />
    </>
  );
}
