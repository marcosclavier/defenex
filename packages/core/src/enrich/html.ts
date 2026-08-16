/**
 * Markup to readable text, shared by every paid fetch provider.
 *
 * Which provider fetched a page must be the only thing that varies between
 * them: the classifier and the evidence verifier both read this output, so a
 * second extraction implementation would quietly change what counts as a
 * finding depending on which tier happened to answer.
 */

/**
 * Strip markup to readable text.
 *
 * The vendor accepts a `format: "markdown"` flag but was observed returning raw
 * HTML regardless, so conversion cannot be delegated. Responses also run to
 * hundreds of kilobytes, and only the first few thousand characters are ever
 * shown to the classifier.
 */
export function htmlToText(html: string): string {
  // Whitespace in the source is rendered as a single space, so block breaks are
  // marked with a sentinel first and restored last. Otherwise a newline that
  // merely formats the HTML would split a sentence in the extracted text.
  const BREAK = "\u0000";
  return html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, BREAK)
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, BREAK)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${BREAK}\\s*`, "g"), "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? htmlToText(m[1]).slice(0, 300) : null;
}
