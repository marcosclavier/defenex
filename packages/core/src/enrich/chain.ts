import { silentLogger, type Logger } from "../ports.js";
import { isUsableScrape, type ScrapeProvider, type ScrapeResult } from "./scrape.js";

/**
 * Tries each paid provider in turn and returns the first that actually read the
 * page.
 *
 * Measured head to head, neither provider dominates. spider.cloud reads DHgate,
 * which YepAPI's stealth tier and our own browser both get a 403 from, and it
 * costs about a fortieth as much. YepAPI reads Etsy, which spider gets a
 * consistent 403 from. Picking either alone means losing coverage somewhere
 * that matters, and the sites in question are marketplaces — exactly where the
 * findings worth filing against live.
 *
 * Chaining makes coverage the union of both while the bill stays close to the
 * cheap one, because the fallback only fires where the first was defeated. The
 * order is therefore price-ascending, and it matters.
 */
export interface ChainOptions {
  logger?: Logger;
  /**
   * Applied to every provider but the last. Spider answers in a few seconds
   * when it can read a page and spends thirty-odd failing when it cannot, so
   * an unbounded first hop makes every fallback pay that wait.
   */
  firstHopTimeoutMs?: number;
}

export class ChainedScraper implements ScrapeProvider {
  readonly name: string;
  private readonly log: Logger;
  private readonly firstHopTimeoutMs: number;

  constructor(
    private readonly providers: ScrapeProvider[],
    opts: ChainOptions = {},
  ) {
    if (providers.length === 0) throw new Error("a scrape chain needs at least one provider");
    this.name = providers.map((p) => p.name).join("→");
    this.log = opts.logger ?? silentLogger;
    this.firstHopTimeoutMs = opts.firstHopTimeoutMs ?? 25_000;
  }

  async scrape(url: string, country = "us"): Promise<ScrapeResult> {
    // Every attempt is billed whether or not it worked, so the caller is told
    // what the whole chain cost rather than only the hop that succeeded.
    let spentMicros = 0;
    const failures: string[] = [];

    for (const [index, provider] of this.providers.entries()) {
      const isLast = index === this.providers.length - 1;
      try {
        const result = await this.attempt(provider, url, country, isLast);
        spentMicros += result.costMicros;

        if (isUsableScrape(result)) {
          if (index > 0) {
            this.log.info("scrape chain fell through", { url, to: provider.name, after: failures });
          }
          return { ...result, costMicros: spentMicros };
        }
        failures.push(`${provider.name}: status ${result.statusCode}, ${result.text.length} chars`);
      } catch (err) {
        // Including a bad key or an empty balance: the point of a chain is that
        // one provider being unusable does not take the tier down with it.
        failures.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`every paid provider failed for ${url} — ${failures.join("; ")}`);
  }

  private async attempt(
    provider: ScrapeProvider,
    url: string,
    country: string,
    isLast: boolean,
  ): Promise<ScrapeResult> {
    if (isLast) return provider.scrape(url, country);

    /**
     * The provider's own timeout still applies; this only stops a slow first
     * hop from eating the time the fallback needs. The losing request is not
     * cancelled — `ScrapeProvider` has no abort signal — so it runs to
     * completion and is discarded. That costs one call we do not use, which is
     * a fraction of a cent and cheaper than the alternative of waiting.
     */
    return Promise.race([
      provider.scrape(url, country),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${this.firstHopTimeoutMs}ms`)),
          this.firstHopTimeoutMs,
        ).unref(),
      ),
    ]);
  }
}
