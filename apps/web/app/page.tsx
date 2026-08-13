import Link from "next/link";
import { Header, Footer } from "@/components/Shell";
import { EvidenceRow } from "@/components/EvidenceRow";

/*
 * The hero states the problem in the customer's words, then immediately shows
 * real output. The sample below is an actual finding from a live YETI scan,
 * quote and all — the product's own evidence is more persuasive than any claim
 * about it, and using invented examples in a trust product would be corrosive.
 */
const SAMPLE = [
  {
    url: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
    category: "COUNTERFEIT",
    severity: 87,
    severityLabel: "critical",
    confidence: "high",
    evidenceQuote: "Replica Yeti Cooler Wholesale - High Capacity & Durable | DHgate",
  },
  {
    url: "https://uk.dhgate.com/yeti-cup-uk.html",
    category: "TRADEMARK_MISUSE",
    severity: 51,
    severityLabel: "medium",
    confidence: "high",
    evidenceQuote: "Wholesale Cheap Yeti Cup - Buy in Bulk on DHgate UK",
  },
];

const CATEGORIES = [
  { name: "Counterfeits", body: "Listings offering fake versions of your product, on marketplaces and standalone stores." },
  { name: "Lookalike domains", body: "Domains built to be mistaken for yours, including ones registered days ago." },
  { name: "Phishing", body: "Pages using your brand to harvest customer logins and payment details." },
  { name: "Impersonation", body: "Social and support accounts posing as you." },
];

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 sm:pt-28">
          <h1 className="t-display measure">
            Someone is selling fake versions of your product.
          </h1>
          <p className="t-body measure mt-6 text-ink-dim">
            Defenex searches the open web for counterfeit listings, lookalike domains and
            impersonation of your brand — and quotes the evidence for every single one.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/scan"
              className="bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim"
            >
              Scan my brand
            </Link>
            <span className="font-mono text-xs text-ink-mute">
              free · no account · about 90 seconds
            </span>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <p className="t-eyebrow">Actual output from a live scan</p>
          <div className="mt-4 border border-line bg-surface">
            {SAMPLE.map((f) => (
              <EvidenceRow key={f.url} {...f} />
            ))}
          </div>
          <p className="t-small mt-3 text-ink-mute">
            Every finding carries a quote taken directly from the page. If we cannot quote
            it, we do not report it.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <h2 className="t-h2">What a scan looks for</h2>
          <div className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-2">
            {CATEGORIES.map((c) => (
              <div key={c.name} className="bg-canvas p-6">
                <h3 className="t-h3">{c.name}</h3>
                <p className="t-small mt-2 text-ink-dim">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <h2 className="t-h2">Why the quote matters</h2>
          <div className="measure mt-6 space-y-4 text-ink-dim">
            <p className="t-body">
              Most infringement reports are a list of links and an assertion. That is easy to
              generate and impossible to act on, because someone still has to open every URL
              and decide whether the claim is true.
            </p>
            <p className="t-body">
              Defenex fetches each page and requires the model to quote the specific text that
              justifies the finding. We then verify that quote appears on the page, and check it
              actually supports the claim rather than being generic marketing copy. Findings
              that fail either check are discarded rather than shown to you.
            </p>
            <p className="t-body">
              The result is a shorter list than you would get elsewhere, and one you can hand to
              a lawyer.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
