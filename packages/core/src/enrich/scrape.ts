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

/** Did we actually see the page, or merely get an answer? */
export function isUsableScrape(result: ScrapeResult): boolean {
  return result.statusCode < 400 && result.text.length >= MIN_USEFUL_TEXT;
}
