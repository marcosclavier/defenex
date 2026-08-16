import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { listPendingRights, listTakedownsForReview } from "@/lib/worker";
import { RightsDecision } from "./RightsDecision";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review queue", robots: { index: false, follow: false } };

const STATUS_TONE: Record<string, string> = {
  pending_approval: "text-medium",
  blocked_no_evidence: "text-critical",
  awaiting_filing: "text-high",
};

interface PendingRight {
  id: string;
  brandId: string;
  regNumber: string;
  jurisdiction: string;
  attestedByName: string | null;
  attestedTitle: string | null;
  registrySnapshot: { markText?: string; ownerName?: string; statusText?: string; isLive?: boolean } | null;
  createdAt: string;
}

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // 404, not 403. A non-admin should not learn the route exists.
  if (!session.isAdmin) notFound();

  const [rights, takedowns] = await Promise.all([
    listPendingRights(session.userId).catch(() => ({ pending: [] })),
    listTakedownsForReview(session.userId).catch(() => ({ takedowns: [] })),
  ]);
  const pending = rights.pending as unknown as PendingRight[];

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <p className="t-eyebrow">Internal</p>
        <h1 className="t-h2 mt-3">Review queue</h1>
        <p className="t-small measure mt-2 text-ink-dim">
          Nothing leaves this system without someone reading it first. A notice you approve is a
          statement you are making.
        </p>

        <section className="mt-10">
          <h2 className="t-h3">Notices awaiting review</h2>
          {takedowns.takedowns.length === 0 ? (
            <div className="mt-4 border border-line bg-surface p-6">
              <p className="t-small text-ink-dim">Nothing waiting.</p>
            </div>
          ) : (
            <div className="mt-4 border border-line bg-surface">
              {takedowns.takedowns.map((t) => (
                <article key={t.id} className="border-b border-line p-5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span
                      className={`font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${STATUS_TONE[t.status] ?? "text-ink-mute"}`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono text-xs text-ink-mute">
                      {t.channel.replace(/_/g, " ")} · {t.noticeKind ?? "unframed"}
                    </span>
                  </div>
                  <p className="t-data mt-2 text-ink">{t.finding?.url ?? "finding missing"}</p>
                  <p className="t-small mt-1 text-ink-dim">
                    {t.brand?.name ?? "unknown brand"}
                    {t.finding && ` · severity ${t.finding.severity}`}
                  </p>
                  {t.status === "blocked_no_evidence" && t.outcomeNote && (
                    <p className="t-small mt-2 border-l-2 border-critical pl-3 text-ink-dim">
                      {t.outcomeNote}
                    </p>
                  )}
                  <Link
                    href={`/admin/takedowns/${t.id}`}
                    className="mt-3 inline-block border border-line-strong px-4 py-2 text-sm transition-colors hover:border-paper"
                  >
                    Review
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="t-h3">Rights claims awaiting verification</h2>
          <p className="t-small measure mt-2 text-ink-dim">
            The register shows a registration exists and who it belongs to. It cannot show that the
            person who submitted it is that owner — that judgement is yours.
          </p>
          {pending.length === 0 ? (
            <div className="mt-4 border border-line bg-surface p-6">
              <p className="t-small text-ink-dim">Nothing waiting.</p>
            </div>
          ) : (
            <div className="mt-4 border border-line bg-surface">
              {pending.map((r) => (
                <article key={r.id} className="border-b border-line p-5 last:border-b-0">
                  <dl className="space-y-1.5 font-mono text-xs">
                    <Row label="reg" value={`${r.jurisdiction} ${r.regNumber}`} />
                    <Row label="mark" value={r.registrySnapshot?.markText ?? "— not checked"} />
                    <Row label="owner" value={r.registrySnapshot?.ownerName ?? "— not checked"} />
                    <Row
                      label="live"
                      value={
                        r.registrySnapshot
                          ? r.registrySnapshot.isLive
                            ? "yes"
                            : `NO — ${r.registrySnapshot.statusText ?? "dead"}`
                          : "unchecked"
                      }
                      tone={r.registrySnapshot && !r.registrySnapshot.isLive ? "critical" : undefined}
                    />
                    <Row
                      label="attested"
                      value={
                        r.attestedByName
                          ? `${r.attestedByName}, ${r.attestedTitle ?? "no role given"}`
                          : "NONE ON FILE"
                      }
                      tone={r.attestedByName ? undefined : "critical"}
                    />
                  </dl>
                  <RightsDecision rightsId={r.id} />
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "critical" }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-ink-mute">{label}</dt>
      <dd className={tone === "critical" ? "text-critical" : "text-ink"}>{value}</dd>
    </div>
  );
}
