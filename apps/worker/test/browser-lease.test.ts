import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const close = vi.fn(async () => {});

vi.mock("@defenex/core", () => ({
  PageFetcher: class { close = close; },
  ChainedScraper: class {},
  SpiderScraper: class {},
  StealthScraper: class { name = "yepapi"; },
}));
vi.mock("../src/env.js", () => ({
  env: { BROWSER_IDLE_MINUTES: 5, BROWSER_RECYCLE_AFTER_JOBS: 3, SCAN_FETCH_PROVIDER: "yepapi", YEPAPI_API_KEY: "k" },
}));
vi.mock("../src/logger.js", () => {
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: log, coreLogger: log };
});

const { withBrowser, closeBrowser } = await import("../src/browser.js");

const MINUTE = 60_000;

describe("browser lease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    close.mockClear();
  });
  afterEach(async () => {
    await closeBrowser();
    vi.useRealTimers();
  });

  it("closes the browser once it has been idle long enough", async () => {
    await withBrowser(async () => {});
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("never closes the browser under a job that is still using it", async () => {
    let finish!: () => void;
    const long = withBrowser(() => new Promise<void>((r) => { finish = r; }));
    // A short job ends while the long one is still running.
    await withBrowser(async () => {});
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(close).not.toHaveBeenCalled();

    finish();
    await long;
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a new job cancels a pending idle close", async () => {
    await withBrowser(async () => {});
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    await withBrowser(async () => {});
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(close).not.toHaveBeenCalled();
  });

  it("recycles after enough jobs without waiting to go idle", async () => {
    await withBrowser(async () => {});
    await withBrowser(async () => {});
    expect(close).not.toHaveBeenCalled();
    await withBrowser(async () => {});
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the job throws", async () => {
    await expect(withBrowser(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
