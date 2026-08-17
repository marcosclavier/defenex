import { describe, it, expect, vi } from "vitest";
import { SerperClient, mapSerperPage } from "../src/search/serper.js";
import { SearchConfigError, QuotaExceededError } from "../src/errors.js";

const organic = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    title: `t${i}`,
    link: `https://${prefix}${i}.example/`,
    snippet: `s${i}`,
    position: i + 1,
  }));

const page = (n: number, prefix = "a") => Response.json({ organic: organic(n, prefix), credits: 1 });

describe("mapSerperPage", () => {
  /**
   * Serper restarts `position` at 1 on every page. `priorScore` treats position
   * as a proxy for reach, so taken at face value a five-page query would report
   * five separate results sitting at position 1.
   */
  it("re-bases position against the page number", () => {
    const p1 = mapSerperPage({ organic: organic(10, "a") }, "q", 1);
    const p3 = mapSerperPage({ organic: organic(10, "c") }, "q", 3);
    expect(p1[0]?.position).toBe(1);
    expect(p1[9]?.position).toBe(10);
    expect(p3[0]?.position).toBe(21);
    expect(p3[9]?.position).toBe(30);
  });

  it("derives displayLink from the URL, which Serper does not supply", () => {
    const [r] = mapSerperPage({ organic: [{ link: "https://www.dhgate.com/a/b", title: "t" }] }, "q", 1);
    expect(r?.displayLink).toBe("www.dhgate.com");
  });

  it("skips entries with no link", () => {
    expect(mapSerperPage({ organic: [{ title: "no link" }] }, "q", 1)).toEqual([]);
  });

  it("copes with a response carrying no organic section", () => {
    expect(mapSerperPage({}, "q", 1)).toEqual([]);
  });

  // Everything is organic here. Recorded so the loss of paid/product signal is
  // visible in the tests, not only in a comment.
  it("marks every result organic, because that is all Serper returns", () => {
    const mapped = mapSerperPage({ organic: organic(3, "a") }, "q", 1);
    expect(mapped.every((r) => r.resultType === "organic")).toBe(true);
    expect(mapped.every((r) => r.price === undefined && r.flaggedMalicious === undefined)).toBe(true);
  });
});

describe("SerperClient", () => {
  const client = (fetchImpl: typeof fetch, over = {}) =>
    new SerperClient({ apiKey: "k", fetchImpl, ...over });

  it("requires a key", () => {
    expect(() => new SerperClient({ apiKey: "" })).toThrow(SearchConfigError);
  });

  it("sends the key and the page number", async () => {
    let sent: Record<string, unknown> = {};
    let header = "";
    await client(async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      header = new Headers(init?.headers).get("x-api-key") ?? "";
      return page(10);
    }).search("q", { depth: 10 });
    expect(header).toBe("k");
    expect(sent.q).toBe("q");
    expect(sent.page).toBe(1);
  });

  // Depth is not free here: ten results per credit, so pages are billed.
  it("paginates to reach the requested depth", async () => {
    let n = 0;
    const out = await client(async () => page(10, `p${n++}-`)).search("q", { depth: 30 });
    expect(out.callsSpent).toBe(3);
    expect(out.results).toHaveLength(30);
  });

  it("charges per page", async () => {
    const out = await client(async () => page(10, "x"), { costMicrosPerCall: 500 }).search("q", { depth: 20 });
    expect(out.costMicros).toBe(1_000);
  });

  it("never exceeds maxPages however deep the caller asks", async () => {
    const spy = vi.fn(async () => page(10, "y"));
    const out = await client(spy as unknown as typeof fetch, { maxPages: 2 }).search("q", { depth: 100 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.callsSpent).toBe(2);
  });

  // Measured against the live API: 26 unique across 3 pages, not 30.
  it("deduplicates results that repeat across pages", async () => {
    const out = await client(async () => page(10, "same")).search("q", { depth: 30 });
    expect(out.results).toHaveLength(10);
    // Three pages were still billed — the overlap is the vendor's, not ours.
    expect(out.callsSpent).toBe(3);
  });

  it("stops paginating when a page comes back empty", async () => {
    let n = 0;
    const spy = vi.fn(async () => (n++ === 0 ? page(10, "a") : Response.json({ organic: [] })));
    const out = await client(spy as unknown as typeof fetch).search("q", { depth: 50 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.results).toHaveLength(10);
  });

  it("trims to the requested depth", async () => {
    const out = await client(async () => page(10, "a")).search("q", { depth: 5 });
    expect(out.results).toHaveLength(5);
  });

  it.each([[401], [403], [402], [400]])("fails fast on %i without retrying", async (status) => {
    const spy = vi.fn(async () => Response.json({ message: "nope" }, { status }));
    await expect(client(spy as unknown as typeof fetch).search("q")).rejects.toBeInstanceOf(SearchConfigError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses to start when the daily cap is already spent", async () => {
    const spy = vi.fn(async () => page(10));
    const c = client(spy as unknown as typeof fetch, {
      dailyCap: 5,
      quota: { used: async () => 5, consume: async () => {} },
    });
    await expect(c.search("q")).rejects.toBeInstanceOf(QuotaExceededError);
    // The cap must stop the call, not report it afterwards.
    expect(spy).not.toHaveBeenCalled();
  });

  // Hitting the cap mid-query should not discard pages already paid for.
  it("returns what it has when the cap trips partway through", async () => {
    let used = 0;
    let n = 0;
    // Distinct URLs per page, or dedup hides what this is measuring.
    const c = client(async () => page(10, `cap${n++}-`), {
      dailyCap: 2,
      quota: { used: async () => used, consume: async (k) => { used += k; } },
    });
    const out = await c.search("q", { depth: 50 });
    expect(out.callsSpent).toBe(2);
    expect(out.results).toHaveLength(20);
  });

  it("retries a rejecting fetch rather than letting it escape", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const spy = vi.fn(async () => {
      if (calls++ < 2) throw new TypeError("fetch failed");
      return page(10);
    });
    const pending = client(spy as unknown as typeof fetch).search("q", { depth: 10 });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ callsSpent: 1 });
    vi.useRealTimers();
  });
});
