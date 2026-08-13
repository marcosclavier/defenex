import { describe, it, expect, beforeEach } from "vitest";
import { createRateLimiter } from "../src/rate-limit.js";

/** Minimal in-memory stand-in for the Redis commands the limiter uses. */
function fakeRedis() {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    store,
    async incr(k: string) { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; },
    async expire(k: string, s: number) { ttls.set(k, s); return 1; },
    async ttl(k: string) { return ttls.get(k) ?? -1; },
    async del(k: string) { store.delete(k); ttls.delete(k); return 1; },
  };
}

describe("rate limiter", () => {
  let redis: ReturnType<typeof fakeRedis>;
  let check: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    redis = fakeRedis();
    check = createRateLimiter(redis as never);
  });

  it("allows the first scan of a domain", async () => {
    expect((await check("acme.com", "1.1.1.1")).allowed).toBe(true);
  });

  it("blocks a repeat scan of the same domain", async () => {
    await check("acme.com", "1.1.1.1");
    const second = await check("acme.com", "2.2.2.2");
    expect(second.allowed).toBe(false);
    expect(second.scope).toBe("domain");
  });

  it("is case-insensitive about the domain", async () => {
    await check("Acme.com", "1.1.1.1");
    expect((await check("acme.com", "1.1.1.1")).allowed).toBe(false);
  });

  it("blocks a single IP enumerating many brands", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await check(`brand${i}.com`, "9.9.9.9")).allowed).toBe(true);
    }
    const sixth = await check("brand5.com", "9.9.9.9");
    expect(sixth.allowed).toBe(false);
    expect(sixth.scope).toBe("ip");
  });

  it("releases the domain slot when the IP limit rejects the request", async () => {
    // Otherwise one blocked visitor locks that brand out for everyone for a day.
    for (let i = 0; i < 5; i++) await check(`brand${i}.com`, "9.9.9.9");
    await check("victim.com", "9.9.9.9");
    expect(redis.store.has("rl-domain-victim.com")).toBe(false);

    const other = await check("victim.com", "8.8.8.8");
    expect(other.allowed).toBe(true);
  });

  it("does not apply the IP limit when the address is unknown", async () => {
    for (let i = 0; i < 12; i++) {
      expect((await check(`b${i}.com`, "unknown")).allowed).toBe(true);
    }
  });
});
