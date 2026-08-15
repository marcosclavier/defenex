import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { getDashboard } from "@/lib/worker";
import { ClaimForm } from "./ClaimForm";
import { MonitoringToggle } from "./MonitoringToggle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  monitor: "Monitor",
  protect: "Protect",
  managed: "Managed",
};

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await getDashboard(session.userId);

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-4xl px-6 pt-14 pb-20">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="t-eyebrow">Account</p>
            <h1 className="t-h2 mt-3">Your brands</h1>
          </div>
          <p className="font-mono text-xs text-ink-mute">
            {session.email} · {PLAN_LABEL[data.plan] ?? data.plan} plan
          </p>
        </div>

        {data.plan === "free" && (
          <div className="mt-8 border border-line bg-surface p-6">
            <h2 className="t-h3">Scans are a snapshot</h2>
            <p className="t-small measure mt-2 text-ink-dim">
              Infringing listings appear and disappear constantly. Monitoring re-runs your
              scans on a schedule and alerts you only to what is new.
            </p>
            <Link
              href="/pricing"
              className="mt-5 inline-block bg-paper px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim"
            >
              See plans
            </Link>
          </div>
        )}

        {data.subscription && data.subscription.enforcementsIncluded > 0 && (
          <p className="mt-6 font-mono text-xs text-ink-dim">
            Enforcements this period: {data.subscription.enforcementsUsed} of{" "}
            {data.subscription.enforcementsIncluded}
          </p>
        )}

        <section className="mt-10">
          {data.brands.length === 0 ? (
            <div className="border border-line bg-surface p-6">
              <h2 className="t-h3">No brands yet</h2>
              <p className="t-small measure mt-2 text-ink-dim">
                Run a scan, or claim a brand you have already received a report for.
              </p>
            </div>
          ) : (
            <div className="border border-line bg-surface">
              {data.brands.map((b) => (
                <article key={b.id} className="border-b border-line p-5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <h2 className="t-h3">{b.name}</h2>
                      <p className="t-data mt-1 text-ink-dim">{b.domain}</p>
                    </div>
                    <div className="flex items-center gap-4 font-mono text-xs">
                      {b.findings.critical > 0 && (
                        <span className="text-critical">{b.findings.critical} critical</span>
                      )}
                      {b.findings.high > 0 && <span className="text-high">{b.findings.high} high</span>}
                      <span className="text-ink-mute">{b.findings.total} open</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <MonitoringToggle brandId={b.id} paused={b.monitoringPaused} plan={data.plan} />
                    <Link
                      href={`/dashboard/brands/${b.id}/rights`}
                      className="font-mono text-xs text-ink-mute underline underline-offset-4 transition-colors hover:text-ink-dim"
                    >
                      Trademark rights
                    </Link>
                  </div>

                  {b.scans.length > 0 && (
                    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-ink-mute">
                      <div>
                        <dt className="inline">last scan </dt>
                        <dd className="inline text-ink-dim">
                          {b.scans[0]!.finishedAt
                            ? new Date(b.scans[0]!.finishedAt).toISOString().slice(0, 10)
                            : b.scans[0]!.status}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">scans </dt>
                        <dd className="inline text-ink-dim">{b.scans.length}</dd>
                      </div>
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="t-h3">Claim a brand</h2>
          <p className="t-small measure mt-2 text-ink-dim">
            If you received a Defenex report for a brand you own, claim it here to keep its
            scan history under this account.
          </p>
          <ClaimForm />
        </section>

        <form action="/api/auth/signout" method="post" className="mt-12">
          <button
            formAction="/api/auth/signout"
            className="font-mono text-xs text-ink-mute underline underline-offset-4 transition-colors hover:text-ink-dim"
          >
            Sign out
          </button>
        </form>
      </main>
      <Footer />
    </>
  );
}
