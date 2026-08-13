/**
 * The single highest-value precision rule in the engine.
 *
 * A model asked to justify a finding will sometimes invent the justification.
 * Requiring the quoted evidence to actually exist in the fetched page — and
 * checking it in code rather than trusting the model — removes most
 * hallucinated findings at negligible cost.
 */

/** Collapse whitespace and case so trivial formatting differences do not fail a true quote. */
function canonical(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export interface EvidenceCheck {
  ok: boolean;
  reason?: string;
}

/** Quotes shorter than this prove nothing — "sale" appears on every page. */
const MIN_QUOTE_CHARS = 12;

export function verifyEvidence(quote: string, sourceText: string): EvidenceCheck {
  const q = canonical(quote);
  const s = canonical(sourceText);

  if (!q) return { ok: false, reason: "empty_quote" };
  if (q.length < MIN_QUOTE_CHARS) return { ok: false, reason: "quote_too_short" };
  if (!s) return { ok: false, reason: "no_source_text" };
  if (s.includes(q)) return { ok: true };

  return { ok: false, reason: "quote_not_in_source" };
}
