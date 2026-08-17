import { silentLogger, type Logger } from "../ports.js";
import type { SearchOptions, SearchOutcome, SearchProvider } from "./types.js";

/**
 * Tries each SERP provider in turn until one answers.
 *
 * Search is the one dependency the whole product rests on: with it down,
 * nothing can be scanned, no monitoring runs, and no takedown gets raised.
 * That was not a hypothetical — the primary returned 502 to every request for
 * a full day, which is what this exists for.
 *
 * The providers are ordered by preference, not price. The first is the one
 * whose detection results the engine is calibrated against; a fallback is a
 * degradation to be accepted during an outage, not an optimisation.
 */
export interface SearchChainOptions {
  logger?: Logger;
  /**
   * Consecutive failures before a provider is skipped for the rest of the run.
   *
   * Without this a dead primary is retried on every query — fifteen times per
   * scan, each paying its full retry ladder before falling through. The latch
   * turns an outage into one wasted query instead of fifteen.
   */
  failuresBeforeSkip?: number;
}

export class ChainedSearchProvider implements SearchProvider {
  readonly name: string;
  private readonly log: Logger;
  private readonly failuresBeforeSkip: number;
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(
    private readonly providers: SearchProvider[],
    opts: SearchChainOptions = {},
  ) {
    if (providers.length === 0) throw new Error("a search chain needs at least one provider");
    this.name = providers.map((p) => p.name).join("→");
    this.log = opts.logger ?? silentLogger;
    this.failuresBeforeSkip = opts.failuresBeforeSkip ?? 3;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    let spentCalls = 0;
    let spentMicros = 0;
    const failures: string[] = [];

    const usable = this.providers.filter((p) => !this.isTripped(p.name));
    // Everything tripped: clear the latches and try once more rather than
    // failing a whole scan on a breaker set earlier in the run.
    const attempts = usable.length > 0 ? usable : this.resetAndUseAll();

    for (const provider of attempts) {
      try {
        const outcome = await provider.search(query, opts);
        spentCalls += outcome.callsSpent;
        spentMicros += outcome.costMicros;
        this.consecutiveFailures.set(provider.name, 0);

        if (failures.length > 0) {
          this.log.info("search chain fell through", { query, to: provider.name, after: failures });
        }

        /**
         * An empty result set is success. A narrow `site:` query legitimately
         * finds nothing most of the time, and treating that as failure would
         * buy a call from every remaining provider on every such query — the
         * majority of what the planner generates.
         */
        return {
          ...outcome,
          callsSpent: spentCalls,
          costMicros: spentMicros,
          provider: provider.name,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${provider.name}: ${message}`);
        this.trip(provider.name, query);
      }
    }

    throw new Error(`every search provider failed for "${query}" — ${failures.join("; ")}`);
  }

  private isTripped(name: string): boolean {
    return (this.consecutiveFailures.get(name) ?? 0) >= this.failuresBeforeSkip;
  }

  private trip(name: string, query: string): void {
    const next = (this.consecutiveFailures.get(name) ?? 0) + 1;
    this.consecutiveFailures.set(name, next);
    if (next === this.failuresBeforeSkip) {
      this.log.warn("search provider tripped; skipping it for the rest of this run", {
        provider: name,
        afterFailures: next,
        lastQuery: query,
      });
    }
  }

  private resetAndUseAll(): SearchProvider[] {
    this.consecutiveFailures.clear();
    return this.providers;
  }
}
