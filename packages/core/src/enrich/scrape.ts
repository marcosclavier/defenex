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
