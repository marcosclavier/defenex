import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { EvidenceRow } from "@/components/EvidenceRow";
import { getSession } from "@/lib/session";
import { listTakedownsForReview } from "@/lib/worker";
import { NoticeReview } from "./NoticeReview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review notice", robots: { index: false, follow: false } };

interface Manifest {
  capturedAt?: string;
  httpStatus?: number;
  screenshotFullPage?: boolean;
  captureMethod?: string;
  registrar?: { name?: string | null; abuseEmail?: string | null; ianaId?: string | null } | null;
  host?: { operator?: string | null; abuseEmail?: string | null; ip?: string | null } | null;
  lookupErrors?: string[];
  artifacts?: Array<{ name: string; sizeBytes: number; sha256: string }>;
}

export default async function ReviewNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isAdmin) notFound();

  const { id } = await params;
  // The queue endpoint already returns everything a decision needs, so there is
  // no separate per-item fetch to keep in sync with it.
  const { takedowns } = await listTakedownsForReview(session.userId);
  const item = takedowns.find((t) => t.id === id);
  if (!item) notFound();

  const manifest = (item.evidence.manifest ?? {}) as Manifest;

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <Link href="/admin" className="t-eyebrow transition-colors hover:text-ink-dim">
          ← Review queue
        </Link>
        <h1 className="t-h2 mt-3">{item.brand?.name ?? "Unknown brand"}</h1>
        <p className="t-data mt-2 text-ink-dim">
          {item.channel.replace(/_/g, " ")} · {item.noticeKind ?? "unframed"} · {item.status.replace(/_/g, " ")}
        </p>

        {item.reviewNotes && (
          <div className="mt-6 border-l-2 border-medium pl-4">
            <p className="t-eyebrow">Before you decide</p>
            <p className="t-small mt-2 whitespace-pre-line text-ink-dim">{item.reviewNotes}</p>
          </div>
        )}

        {item.finding && (
          <section className="mt-10">
            <h2 className="t-h3">The finding</h2>
            <div className="mt-4 border border-line bg-surface px-5">
              <EvidenceRow
                url={item.finding.url}
                category={item.finding.category}
                severity={item.finding.severity}
                severityLabel={item.finding.severityLabel}
                confidence={item.finding.confidence}
                evidenceQuote={item.finding.evidenceQuote}
                evidenceSource={item.finding.evidenceSource}
              />
            </div>
          </section>
        )}

        <section className="mt-10">
          <h2 className="t-h3">Preserved evidence</h2>
          {item.evidence.hasBundle ? (
            <div className="mt-4 border border-line bg-surface p-5">
              <dl className="space-y-1.5 font-mono text-xs">
                <Row label="captured" value={manifest.capturedAt ?? "—"} />
                <Row label="method" value={manifest.captureMethod ?? "direct-browser"} />
                <Row label="status" value={manifest.httpStatus != null ? String(manifest.httpStatus) : "—"} />
                <Row label="registrar" value={manifest.registrar?.name ?? "not published"} />
                <Row label="reg abuse" value={manifest.registrar?.abuseEmail ?? "not published"} />
                <Row label="host" value={manifest.host?.operator ?? "not published"} />
                <Row label="host abuse" value={manifest.host?.abuseEmail ?? "not published"} />
              </dl>
              {manifest.artifacts && manifest.artifacts.length > 0 && (
                <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-mono text-[0.6875rem]">
                  {manifest.artifacts.map((a) => (
                    <Row key={a.name} label={a.name} value={a.sha256.slice(0, 24)} />
                  ))}
                </dl>
              )}
              {item.evidence.url && (
                <a
                  href={item.evidence.url}
                  className="mt-4 inline-block border border-line-strong px-4 py-2 text-sm transition-colors hover:border-paper"
                >
                  Download bundle
                </a>
              )}
            </div>
          ) : (
            <div className="mt-4 border-l-2 border-critical pl-4">
              <p className="t-small text-ink-dim">
                No evidence was captured, so nothing may be filed. {item.outcomeNote}
              </p>
            </div>
          )}
        </section>

        <NoticeReview
          takedownId={item.id}
          status={item.status}
          subject={item.noticeSubject}
          body={item.noticeBody}
          hasEvidence={item.evidence.hasBundle}
          submittedTo={item.submittedTo}
          approverName={session.email}
        />
      </main>
      <Footer />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-ink-mute">{label}</dt>
      <dd className="break-all text-ink">{value}</dd>
    </div>
  );
}
