import { describe, it, expect, vi } from "vitest";
import { UsptoClient, parseTsdr, normalizeRegNumber } from "../src/rights/uspto.js";
import { RightsLookupError } from "../src/errors.js";

const live = {
  trademarks: [
    {
      status: {
        markElement: "YETI",
        statusCode: 700,
        usRegistrationNumber: "4213456",
        filingDate: "2012-03-01",
        registrationDate: "2012-09-25",
      },
      parties: { ownerGroups: { "20": [{ partyName: "YETI Coolers, LLC" }] } },
    },
  ],
};

const dead = {
  trademarks: [
    { status: { markElement: "GONE", statusCode: 900 }, parties: { ownerGroups: {} } },
  ],
};

describe("normalizeRegNumber", () => {
  it.each([
    ["4,213,456", "4213456"],
    ["Reg. No. 4213456", "4213456"],
    [" 4213456 ", "4213456"],
  ])("strips punctuation from %s", (input, expected) => {
    expect(normalizeRegNumber(input)).toBe(expected);
  });
});

describe("parseTsdr", () => {
  it("extracts mark, owner and live status", () => {
    const r = parseTsdr("4213456", live);
    expect(r.markText).toBe("YETI");
    expect(r.ownerName).toBe("YETI Coolers, LLC");
    expect(r.isLive).toBe(true);
    expect(r.registryUrl).toContain("4213456");
  });

  it("treats a 9xx status as dead", () => {
    // Filing against an abandoned or cancelled registration is exactly the
    // false-notice scenario the rights gate exists to prevent.
    const r = parseTsdr("1234567", dead);
    expect(r.isLive).toBe(false);
    expect(r.statusText).toMatch(/Dead/);
  });

  it("treats a pending application as not live", () => {
    const pending = { trademarks: [{ status: { statusCode: 400 } }] };
    expect(parseTsdr("1", pending).isLive).toBe(false);
  });

  it("does not throw on an unexpected shape", () => {
    const r = parseTsdr("9999999", {});
    expect(r.isLive).toBe(false);
    expect(r.markText).toBeNull();
    expect(r.ownerName).toBeNull();
  });
});

describe("UsptoClient", () => {
  const client = (impl: typeof fetch) => new UsptoClient({ apiKey: "k", fetchImpl: impl });
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("returns a parsed record", async () => {
    const c = client(vi.fn(async () => ok(live)) as unknown as typeof fetch);
    expect((await c.lookup("4,213,456")).ownerName).toBe("YETI Coolers, LLC");
  });

  it("sends the key in the header USPTO expects", async () => {
    const spy = vi.fn(async () => ok(live));
    await client(spy as unknown as typeof fetch).lookup("4213456");
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["USPTO-API-KEY"]).toBe("k");
  });

  it.each([
    // A bodyless 404 is the ambiguous case — see the disambiguation block below.
    [404, /not proof the registration does not exist/],
    [401, /rejected the API key/],
    [429, /rate limit/],
  ])("maps %i to a readable error", async (status, match) => {
    const c = client(vi.fn(async () => new Response("", { status })) as unknown as typeof fetch);
    await expect(c.lookup("4213456")).rejects.toThrow(match);
  });

  it("rejects a malformed registration number before calling out", async () => {
    const spy = vi.fn(async () => ok(live));
    await expect(client(spy as unknown as typeof fetch).lookup("abc")).rejects.toBeInstanceOf(
      RightsLookupError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("requires an API key", () => {
    expect(() => new UsptoClient({ apiKey: "" })).toThrow(RightsLookupError);
  });
});

describe("UsptoClient 404 disambiguation", () => {
  const client = (fetchImpl: typeof fetch) => new UsptoClient({ apiKey: "k", fetchImpl });

  /**
   * Verified against the live service: no key gives 401, but a wrong key gives
   * 404 — indistinguishable by status from a registration that does not exist.
   */
  it("does not assert a registration is missing when the key may have been refused", async () => {
    const c = client((async () => new Response(" BACKEND RESPONSE STATUS: 404", { status: 404 })) as unknown as typeof fetch);
    // The admin reading this must not reject a customer's claim on our own
    // credential problem.
    await expect(c.lookup("4213456")).rejects.toThrow(/not proof the registration does not exist/);
  });

  it("still reports a genuine miss as a miss", async () => {
    const c = client((async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })) as unknown as typeof fetch);
    await expect(c.lookup("4213456")).rejects.toThrow(/No US registration found/);
  });
});
