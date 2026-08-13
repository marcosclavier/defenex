import { describe, it, expect, vi } from "vitest";
import { YepApiClient } from "../src/search/yepapi.js";
import { SearchConfigError, QuotaExceededError } from "../src/errors.js";
import { MemoryQuota } from "../src/ports.js";

const okResponse = (results: unknown[]) =>
  new Response(JSON.stringify({ ok: true, data: { query: "q", totalResults: 1, results } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const client = (fetchImpl: typeof fetch, over = {}) =>
  new YepApiClient({ apiKey: "test-key", fetchImpl, ...over });

describe("YepApiClient result mapping", () => {
  it("maps organic results and preserves Google's malicious flag", async () => {
    const c = client(vi.fn(async () =>
      okResponse([
        {
          position: 1, type: "organic", title: "Replica Store", url: "https://bad.test/x",
          description: "cheap replicas", domain: "bad.test", data: { isMalicious: true },
        },
      ]),
    ) as unknown as typeof fetch);

    const { results, callsSpent, costMicros } = await c.search("q");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: "https://bad.test/x",
      resultType: "organic",
      position: 1,
      flaggedMalicious: true,
    });
    expect(callsSpent).toBe(1);
    expect(costMicros).toBe(10_000); // $0.01 per call
  });

  it("flattens product carousels into individual candidate URLs", async () => {
    const c = client(vi.fn(async () =>
      okResponse([
        {
          position: 3, type: "popularProducts", title: "", url: "", domain: "",
          data: {
            items: [
              { title: "Fake Tumbler", url: "https://shop.test/a", source: "DHgate", price: "$12" },
              { title: "Fake Mug", url: "https://shop.test/b", source: "AliExpress" },
              { title: "No URL", source: "Nowhere" },
            ],
          },
        },
      ]),
    ) as unknown as typeof fetch);

    const { results } = await c.search("q");
    expect(results).toHaveLength(2); // the item without a URL is unusable
    expect(results[0]).toMatchObject({ resultType: "product", price: "$12", url: "https://shop.test/a" });
  });

  it("keeps paid ads — bidding on a brand name is trademark misuse", async () => {
    const c = client(vi.fn(async () =>
      okResponse([
        { position: 1, type: "paid", title: "Ad", url: "https://ad.test/x", domain: "ad.test", data: {} },
      ]),
    ) as unknown as typeof fetch);

    const { results } = await c.search("q");
    expect(results[0]?.resultType).toBe("paid");
  });

  it("ignores navigational furniture and unknown types without crashing", async () => {
    // aiOverview appears in live responses but is absent from the vendor docs,
    // so unknown types must be skipped rather than guessed at.
    const c = client(vi.fn(async () =>
      okResponse([
        { position: 1, type: "aiOverview", title: "AI", url: "", domain: "", data: {} },
        { position: 2, type: "peopleAlsoAsk", data: { items: [{ title: "?" }] } },
        { position: 3, type: "relatedSearches", data: { items: ["a", "b"] } },
        { position: 4, type: "video", data: { items: [] } },
        { position: 5, type: "someFutureType", url: "https://x.test/", domain: "x.test", data: {} },
        { position: 6, type: "organic", title: "Real", url: "https://real.test/", domain: "real.test", data: {} },
      ]),
    ) as unknown as typeof fetch);

    const { results } = await c.search("q");
    expect(results.map((r) => r.url)).toEqual(["https://real.test/"]);
  });

  it("skips organic entries with no URL", async () => {
    const c = client(vi.fn(async () =>
      okResponse([{ position: 1, type: "organic", title: "no link", domain: "x.test", data: {} }]),
    ) as unknown as typeof fetch);
    expect((await c.search("q")).results).toHaveLength(0);
  });
});

describe("YepApiClient behaviour", () => {
  it("caches by query so a repeat costs nothing", async () => {
    const spy = vi.fn(async () =>
      okResponse([{ position: 1, type: "organic", url: "https://a.test/", domain: "a.test", data: {} }]),
    );
    const c = client(spy as unknown as typeof fetch);

    const first = await c.search("same query");
    const second = await c.search("same query");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(second.costMicros).toBe(0);
    expect(second.results).toEqual(first.results);
  });

  it("caps depth at the observed provider ceiling", async () => {
    const spy = vi.fn(async () => okResponse([]));
    await client(spy as unknown as typeof fetch).search("q", { depth: 5000 });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.depth).toBe(100);
  });

  it("maps a geo target to a location code", async () => {
    const spy = vi.fn(async () => okResponse([]));
    await client(spy as unknown as typeof fetch).search("q", { gl: "de" });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.location_code).toBe(2276);
  });

  it("falls back to US for an unknown geo target rather than failing", async () => {
    const spy = vi.fn(async () => okResponse([]));
    await client(spy as unknown as typeof fetch).search("q", { gl: "zz" });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.location_code).toBe(2840);
  });

  it.each([
    [401, "INVALID_API_KEY"],
    [402, "OUT_OF_CREDIT"],
    [400, "BAD_REQUEST"],
  ])("fails fast on %i without retrying", async (status, code) => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: { code, message: "nope" } }), { status }),
    );
    await expect(client(spy as unknown as typeof fetch).search("q")).rejects.toBeInstanceOf(
      SearchConfigError,
    );
    expect(spy).toHaveBeenCalledTimes(1); // retrying cannot fix credentials or credit
  });

  it("treats ok:false in a 200 body as an error", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: { code: "X", message: "y" } }), { status: 200 }),
    );
    await expect(client(spy as unknown as typeof fetch).search("q")).rejects.toBeInstanceOf(
      SearchConfigError,
    );
  });

  it("refuses to spend beyond the daily cap", async () => {
    const quota = new MemoryQuota();
    await quota.consume(5);
    const spy = vi.fn(async () => okResponse([]));
    const c = client(spy as unknown as typeof fetch, { quota, dailyCap: 5 });

    await expect(c.search("q")).rejects.toBeInstanceOf(QuotaExceededError);
    expect(spy).not.toHaveBeenCalled(); // the cap must stop the call, not report it after
  });

  it("requires an API key", () => {
    expect(() => new YepApiClient({ apiKey: "" })).toThrow(SearchConfigError);
  });
});
