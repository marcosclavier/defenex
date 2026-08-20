/**
 * The paid fetch tier, behind one interface.
 *
 * Reached only when the free headless browser has already been defeated. Two
 * providers implement it today and they differ by two orders of magnitude in
 * price, so which one is wired in is an operational decision — not something
 * the scanner or the evidence capture should know about.
 */
export interface ScrapeResult {
  statusCode: number;
  /** Readable text, already extracted and truncated. */
  text: string;
  /**
   * How much of `text` came from the document body rather than from `<head>`
   * metadata. Absent means the provider does not distinguish, and the whole of
   * `text` counts.
   *
   * The two are worth different things. A client-rendered listing sends an
   * `og:title` that names the product and a body that says nothing; that title
   * is enough for a classifier to judge what is on offer, and nowhere near
   * enough to claim we saw the page. Everything below that has to answer the
   * second question reads this rather than `text.length`.
   */
  bodyChars?: number;
  title: string | null;
  finalUrl: string;
  /** Actual spend for this call, in millionths of a dollar. */
  costMicros: number;
  /** Raw HTML, when the provider returns it. Needed to render evidence. */
  html?: string;
}

export interface ScrapeProvider {
  scrape(url: string, country?: string): Promise<ScrapeResult>;
  /** For logs and cost reporting. */
  readonly name: string;
}

/**
 * Below this a fetch was defeated rather than the page being empty. Anti-bot
 * systems answer 200 with an interstitial carrying almost no text, so length is
 * as much a signal as status.
 */
export const MIN_USEFUL_TEXT = 200;

/**
 * Enough text to be worth a classifier call — a lower bar than having seen the
 * page, and deliberately so.
 *
 * A client-rendered listing yields only its metadata, which runs to a couple of
 * hundred characters and names the product: two real AliExpress listings came
 * out at 206 and 190. Judging one and discarding the other because they fell
 * either side of the anti-bot threshold is an accident, not a policy. What this
 * admits is still held to every downstream rule — `isProbative` decides whether
 * any of it can be quoted, and the evidence capture applies `MIN_USEFUL_TEXT`
 * to the body alone regardless.
 */
export const MIN_CLASSIFIABLE_TEXT = 80;

/** How much document the page actually served, metadata excluded. */
export function bodyCharsOf(result: ScrapeResult): number {
  return result.bodyChars ?? result.text.length;
}

/** Did we actually see the page, or merely get an answer? */
export function isUsableScrape(result: ScrapeResult): boolean {
  return result.statusCode < 400 && bodyCharsOf(result) >= MIN_USEFUL_TEXT;
}
