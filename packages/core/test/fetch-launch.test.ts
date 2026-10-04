import { describe, it, expect, vi, beforeEach } from "vitest";

const browserClose = vi.fn(async () => {});
const launch = vi.fn(async () => ({ close: browserClose }));

vi.mock("playwright", () => ({ chromium: { launch } }));

const { PageFetcher } = await import("../src/enrich/fetch.js");

/** Reaches the private launcher; the public paths all funnel through it. */
const browserOf = (f: InstanceType<typeof PageFetcher>) => f.browserHandle();

describe("PageFetcher browser launch", () => {
  beforeEach(() => {
    launch.mockClear();
    browserClose.mockClear();
  });

  it("launches one browser for concurrent callers on a cold fetcher", async () => {
    const f = new PageFetcher();
    const handles = await Promise.all([browserOf(f), browserOf(f), browserOf(f), browserOf(f)]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(new Set(handles).size).toBe(1);
  });

  it("relaunches after close", async () => {
    const f = new PageFetcher();
    await browserOf(f);
    await f.close();
    expect(browserClose).toHaveBeenCalledTimes(1);
    await browserOf(f);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed launch", async () => {
    launch.mockRejectedValueOnce(new Error("no chromium"));
    const f = new PageFetcher();
    await expect(browserOf(f)).rejects.toThrow("no chromium");
    await expect(browserOf(f)).resolves.toBeDefined();
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
