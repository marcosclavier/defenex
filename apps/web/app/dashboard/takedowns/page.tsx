import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { listUserTakedowns } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Removals", robots: { index: false } };

/**
 * Plain language, because the enum names are ours and the customer did not
 * agree to learn them. Tone is carried by colour only where it means something:
 * removed is the outcome they paid for, blocked and declined need attention.
 */
const STATE: Record<string, { label: string; tone: string; note?: string }> = {
  draft: { label: "Preparing", tone: "text-ink-mute" },
  capturing_evidence: { label: "Capturing evidence", tone: "text-ink-mute" },
  blocked_no_evidence: {
    label: "Blocked",
    tone: "text-critical",
    note: "The page could not be preserved, so nothing was filed. We do not send notices about pages we cannot show.",
  },
  pending_approval: { label: "Under review", tone: "text-medium" },
  awaiting_filing: { label: "Approved", tone: "text-medium", note: "Being filed with the platform." },
  declined: { label: "Declined", tone: "text-ink-dim", note: "We did not file this. It has not been charged." },
  submitted: { label: "Filed", tone: "text-ink" },
  accepted: { label: "Accepted", tone: "text-ink" },
  rejected: { label: "Rejected", tone: "text-critical" },
  removed: { label: "Removed", tone: "text-ink" },
  escalated: { label: "Escalated", tone: "text-high" },
};

export default async function TakedownsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { takedowns } = await listUserTakedowns(session.userId).catch(() => ({ takedowns: [] }));

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <Link href="/dashboard" className="t-eyebrow transition-colors hover:text-ink-dim">
          ← Dashboard
        </Link>
        <h1 className="t-h2 mt-3">Removals</h1>
        <p className="t-small measure mt-2 text-ink-dim">
          Every notice is read and signed by a person before it is sent. Once filed, we re-check the
          page until it comes down.
        </p>

        <section className="mt-10">
          {takedowns.length === 0 ? (
            <div className="border border-line bg-surface p-6">
              <h2 className="t-h3">No removals yet</h2>
              <p className="t-small measure mt-2 text-ink-dim">
                Open a brand&rsquo;s findings to request one.
              </p>
            </div>
          ) : (
            <div className="border border-line bg-surface">
              {takedowns.map((t) => {
                const state = STATE[t.status] ?? { label: t.status, tone: "text-ink-mute" };
                return (
                  <article key={t.id} className="border-b border-line p-5 last:border-b-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span
                        className={`font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${state.tone}`}
                      >
                        {state.label}
                      </span>
                      <span className="font-mono text-xs text-ink-mute">
                        {t.brand?.name ?? "—"}
                        {t.submittedAt &&
                          ` · filed ${new Date(t.submittedAt).toISOString().slice(0, 10)}`}
                        {t.resolvedAt &&
                          ` · resolved ${new Date(t.resolvedAt).toISOString().slice(0, 10)}`}
                      </span>
                    </div>
                    <p className="t-data mt-2 text-ink">{t.finding?.url ?? "—"}</p>
                    {(state.note || t.declinedReason || t.outcomeNote) && (
                      <p className="t-small mt-2 text-ink-dim">
                        {t.declinedReason ?? t.outcomeNote ?? state.note}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
