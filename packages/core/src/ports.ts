/**
 * Ports let the engine run in two very different hosts without knowing about
 * either: the CLI (in-memory / on-disk) and the worker (Postgres-backed).
 * `packages/core` therefore has no dependency on `@defenex/db`.
 */

export interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
}

export interface QuotaCounter {
  /** Queries already spent today. */
  used(): Promise<number>;
  /** Record `n` queries as spent. */
  consume(n: number): Promise<void>;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ------------------------------------------------------------------ defaults

/** TTL-aware in-memory cache. Fine for a single CLI run. */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<string, { value: unknown; at: number }>();
  constructor(private readonly ttlMs: number) {}

  async get(key: string): Promise<unknown | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, { value, at: Date.now() });
  }
}

/** Counts within one process only — the worker swaps in the Postgres counter. */
export class MemoryQuota implements QuotaCounter {
  private count = 0;
  async used(): Promise<number> {
    return this.count;
  }
  async consume(n: number): Promise<void> {
    this.count += n;
  }
}

export const consoleLogger: Logger = {
  debug: (msg, meta) => console.debug(JSON.stringify({ level: "debug", msg, ...meta })),
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
};

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
