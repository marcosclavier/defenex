import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { getDashboard, listRights } from "@/lib/worker";
import { RightsForm } from "./RightsForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trademark rights", robots: { index: false } };

const STATUS_TONE: Record<string, string> = {
  verified: "text-ink",
  pending: "text-medium",
  rejected: "text-critical",
};

export default async function RightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const dashboard = await getDashboard(session.userId);
  const brand = dashboard.brands.find((b) => b.id === id);
  if (!brand) notFound();

  const { rights } = await listRights(id).catch(() => ({ rights: [] }));
  const verified = rights.filter((r) => r.status === "verified");

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-14 pb-20">
        <Link href="/dashboard" className="t-eyebrow transition-colors hover:text-ink-dim">
          ← Dashboard
        </Link>
        <h1 className="t-h2 mt-3">Trademark rights</h1>
        <p className="t-data mt-2 text-ink-dim">{brand.domain}</p>

        <p className="t-small measure mt-5 text-ink-dim">
          Before we file an enforcement notice we verify you own or represent the mark. Filing a
          notice you are not entitled to file carries real legal consequences, so we will not do it
          on trust.
        </p>

        {verified.length > 0 ? (
          <div className="mt-8 border-l-2 border-paper pl-4">
            <p className="text-sm text-ink">Rights verified for this brand.</p>
            <p className="t-small mt-1 text-ink-dim">
              You can request removals from any finding in your reports.
            </p>
          </div>
        ) : (
          <div className="mt-8 border-l-2 border-medium pl-4">
            <p className="text-sm text-ink">No verified registration yet.</p>
            <p className="t-small mt-1 text-ink-dim">
              Removal requests are unavailable until one is verified.
            </p>
          </div>
        )}

        {rights.length > 0 && (
          <section className="mt-10">
            <h2 className="t-eyebrow">Registrations on file</h2>
            <div className="mt-3 border border-line bg-surface">
              {rights.map((r) => (
                <div key={r.id} className="border-b border-line p-4 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="t-data text-ink">
                      {r.jurisdiction} {r.regNumber}
                    </p>
                    <span className={`font-mono text-xs uppercase tracking-[0.14em] ${STATUS_TONE[r.status]}`}>
                      {r.status}
                    </span>
                  </div>
                  {r.registrySnapshot?.markText && (
                    <p className="t-small mt-1 text-ink-dim">
                      {r.registrySnapshot.markText}
                      {r.registrySnapshot.ownerName ? ` · ${r.registrySnapshot.ownerName}` : ""}
                    </p>
                  )}
                  {r.status === "rejected" && r.rejectedReason && (
                    <p className="t-small mt-1 text-critical">{r.rejectedReason}</p>
                  )}
                  {r.registryUrl && (
                    <a
                      href={r.registryUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="t-small mt-1 inline-block text-ink-mute underline underline-offset-4 hover:text-ink-dim"
                    >
                      View on the register
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10 border-t border-line pt-8">
          <h2 className="t-h3">Add a registration</h2>
          <RightsForm brandId={id} />
        </section>
      </main>
      <Footer />
    </>
  );
}
