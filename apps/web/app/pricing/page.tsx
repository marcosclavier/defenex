import type { Metadata } from "next";
import { Header, Footer } from "@/components/Shell";
import { PLANS } from "@/lib/plans";
import { CheckoutButton } from "./CheckoutButton";

export const metadata: Metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-5xl px-6 pt-16 pb-20">
        <p className="t-eyebrow">Pricing</p>
        <h1 className="t-h2 mt-3">Monitoring, then enforcement</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          Counterfeiters relist. A single takedown does not end the problem, so the
          product is continuous monitoring — with enforcement included once you want
          listings removed rather than just found.
        </p>

        <div className="mt-10 grid gap-px border border-line bg-line lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div key={plan.slug} className="flex flex-col bg-canvas p-6">
              <h2 className="t-h3">{plan.name}</h2>
              <p className="t-small mt-1 text-ink-dim">{plan.blurb}</p>

              <p className="mt-5 font-mono text-3xl tabular-nums">
                ${plan.monthly.toLocaleString()}
                <span className="text-sm text-ink-mute">/mo</span>
              </p>
              <p className="font-mono text-xs text-ink-mute">
                or ${plan.yearly.toLocaleString()}/yr — two months free
              </p>

              <ul className="mt-5 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="t-small flex gap-2 text-ink-dim">
                    <span aria-hidden className="mt-2 h-px w-3 shrink-0 bg-line-strong" />
                    {f}
                  </li>
                ))}
              </ul>

              <CheckoutButton slug={plan.slug} name={plan.name} />
            </div>
          ))}
        </div>

        <p className="t-small measure mt-8 text-ink-mute">
          Enforcement allowances are per month and do not roll over. We verify you own or
          represent a mark before filing anything on your behalf — filing a notice you are
          not entitled to file carries real legal consequences.
        </p>
      </main>
      <Footer />
    </>
  );
}
