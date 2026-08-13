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

/**
 * Vocabulary that makes a quote *probative* rather than merely present.
 * A quote must do more than exist on the page — it has to support the claim.
 */
/**
 * Strong signals only. Deliberately excludes "wholesale", "cheap", "outlet",
 * "discount" and "inspired by": all appear constantly in ordinary commerce, and
 * during gate testing "inspired by" alone let DHgate boilerplate ("Every mobile
 * clothing is inspired by high-quality designers") masquerade as evidence.
 */
const INFRINGEMENT_VOCAB =
  /(replica|fake|knock-?off|counterfeit|\bdupes?\b|aaa quality|1:1|crack(ed)?|keygen|nulled|licen[cs]e key|activation code|torrent)/i;

const CREDENTIAL_VOCAB =
  /(login|log in|sign ?in|password|verify|verification|account suspend|payment (card|details)|billing (details|information)|credit card|cvv|otp)/i;

/** Quotes shorter than this prove nothing — "sale" appears on every page. */
const MIN_QUOTE_CHARS = 12;

/**
 * A quote is probative when it names the brand or uses vocabulary that bears on
 * the accusation. Generic marketing boilerplate is not evidence even when it is
 * genuinely on the page.
 *
 * Found in gate testing: three Patagonia findings all cited "Every mobile
 * clothing is inspired by high-quality designers" — real DHgate boilerplate that
 * proves nothing. The findings were probably correct, but a report showing a
 * customer that quote as proof invites exactly the credibility loss the whole
 * evidence rule exists to prevent.
 */
export function isProbative(quote: string, brand: string, aliases: string[] = []): boolean {
  const q = canonical(quote);

  const names = [brand, ...aliases]
    .map((n) => canonical(n).replace(/[^a-z0-9]/g, ""))
    .filter((n) => n.length >= 3);
  const squashed = q.replace(/[^a-z0-9]/g, "");
  // Counterfeit listings mangle the mark on purpose ("Patagoniamens",
  // "Patalys"), so compare against a squashed form rather than word boundaries.
  if (names.some((n) => squashed.includes(n))) return true;

  return INFRINGEMENT_VOCAB.test(q) || CREDENTIAL_VOCAB.test(q);
}

export function verifyEvidence(
  quote: string,
  sourceText: string,
  opts: { brand?: string; aliases?: string[] } = {},
): EvidenceCheck {
  const q = canonical(quote);
  const s = canonical(sourceText);

  if (!q) return { ok: false, reason: "empty_quote" };
  if (q.length < MIN_QUOTE_CHARS) return { ok: false, reason: "quote_too_short" };
  if (!s) return { ok: false, reason: "no_source_text" };
  if (!s.includes(q)) return { ok: false, reason: "quote_not_in_source" };

  if (opts.brand && !isProbative(quote, opts.brand, opts.aliases ?? [])) {
    return { ok: false, reason: "quote_not_probative" };
  }

  return { ok: true };
}
