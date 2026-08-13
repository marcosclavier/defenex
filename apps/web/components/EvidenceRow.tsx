import { SeverityChip, SeverityRule } from "./Severity";

export interface EvidenceRowProps {
  url: string;
  category: string;
  severity: number;
  severityLabel: string;
  confidence?: string;
  evidenceQuote: string;
  evidenceSource?: "browser" | "stealth" | null;
  screenshotUrl?: string | null;
}

/**
 * One finding, presented as a docket entry rather than a card.
 *
 * The verbatim quote is the product: it is what separates a finding from an
 * accusation, so it is set as an actual quotation and never truncated below
 * the point where it still supports the claim.
 */
export function EvidenceRow(f: EvidenceRowProps) {
  return (
    <article className="relative border-b border-line py-5 pl-5 last:border-b-0">
      <SeverityRule label={f.severityLabel} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SeverityChip label={f.severityLabel} score={f.severity} />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-dim">
          {f.category.replace(/_/g, " ")}
        </span>
        {f.confidence && (
          <span className="font-mono text-[0.6875rem] text-ink-mute">
            {f.confidence} confidence
          </span>
        )}
        {f.evidenceSource === "stealth" && (
          // Surfaced, not hidden: a takedown notice needs visual evidence, and
          // this finding does not have any.
          <span className="font-mono text-[0.6875rem] text-ink-mute">no screenshot</span>
        )}
      </div>

      <p className="t-data mt-2 text-ink">{f.url}</p>

      <blockquote className="mt-3 border-l border-line-strong pl-3">
        <p className="font-mono text-[0.8125rem] leading-relaxed text-ink-dim">
          {f.evidenceQuote}
        </p>
      </blockquote>

      {f.screenshotUrl && (
        <a
          href={f.screenshotUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-block border border-line transition-colors hover:border-line-strong"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={f.screenshotUrl}
            alt={`Screenshot captured from ${f.url}`}
            loading="lazy"
            className="block max-h-56 w-auto max-w-full"
          />
        </a>
      )}
    </article>
  );
}
