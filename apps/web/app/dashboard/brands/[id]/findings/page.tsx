import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { EvidenceRow } from "@/components/EvidenceRow";
import { getSession } from "@/lib/session";
import { listBrandFindings, WorkerError } from "@/lib/worker";
import { RequestTakedown } from "./RequestTakedown";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Findings", robots: { index: false } };

const TAKEDOWN_LABEL: Record<string, string> = {
  draft: "Preparing the notice",
  capturing_evidence: "Capturing evidence",
  blocked_no_evidence: "Blocked — evidence could not be captured",
  pending_approval: "Awaiting our review",
  awaiting_filing: "Approved, being filed",
  declined: "We declined to file this",
  submitted: "Filed",
  accepted: "Accepted by the platform",
  rejected: "Rejected by the platform",
  removed: "Removed",
  escalated: "Escalated",
};

export default async function FindingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  let data;
  try {
    data = await listBrandFindings(id, session.userId);
  } catch (err) {
    if (err instanceof WorkerError && err.status === 404) notFound();
    throw err;
  }

  const { canRequest } = data;

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <Link href="/dashboard" className="t-eyebrow transition-colors hover:text-ink-dim">
          ← Dashboard
        </Link>
        <h1 className="t-h2 mt-3">{data.brand.name}</h1>
        <p className="t-data mt-2 text-ink-dim">{data.brand.domain}</p>

        {/* Told before it is hit, not after. */}
        {!canRequest.hasVerifiedRights && (
          <div className="mt-8 border-l-2 border-medium pl-4">
            <p className="t-small measure text-ink-dim">
              Removals need a verified trademark registration on file first. We will not file a
              notice we cannot stand behind.{" "}
              <Link
                href={`/dashboard/brands/${id}/rights`}
                className="underline underline-offset-4 hover:text-ink"
              >
                Add a registration
              </Link>
              .
            </p>
          </div>
        )}

        {canRequest.hasVerifiedRights && canRequest.exhausted && (
          <div className="mt-8 border-l-2 border-medium pl-4">
            <p className="t-small measure text-ink-dim">
              You have used {canRequest.used} of {canRequest.included} enforcements this period.
              Further removals are ${canRequest.overageUsd} each.
            </p>
          </div>
        )}

        {canRequest.hasVerifiedRights && !canRequest.exhausted && (
          <p className="mt-8 font-mono text-xs text-ink-mute">
            {canRequest.remaining} of {canRequest.included} enforcements left this period
          </p>
        )}

        <section className="mt-8">
          {data.findings.length === 0 ? (
            <div className="border border-line bg-surface p-6">
              <h2 className="t-h3">Nothing open</h2>
              <p className="t-small measure mt-2 text-ink-dim">
                No open findings for this brand. Monitoring will alert you if that changes.
              </p>
            </div>
          ) : (
            <div className="border border-line bg-surface px-5">
              {data.findings.map((f) => (
                <div key={f.id} className="border-b border-line last:border-b-0">
                  <EvidenceRow
                    url={f.url}
                    category={f.category}
                    severity={f.severity}
                    severityLabel={f.severityLabel}
                    confidence={f.confidence}
                    evidenceQuote={f.evidenceQuote}
                    evidenceSource={f.evidenceSource}
                    screenshotUrl={f.screenshotUrl}
                  />
                  <div className="pb-5 pl-5">
                    {f.takedown ? (
                      <p className="font-mono text-xs text-ink-dim">
                        {TAKEDOWN_LABEL[f.takedown.status] ?? f.takedown.status}
                      </p>
                    ) : (
                      <RequestTakedown
                        findingId={f.id}
                        disabled={!canRequest.hasVerifiedRights}
                        brandId={id}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
