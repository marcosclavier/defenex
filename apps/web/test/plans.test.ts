import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { planForPriceId, PLANS } from "../lib/plans";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });
beforeEach(() => { process.env = { ...ENV }; });

describe("planForPriceId", () => {
  it("resolves a configured monthly price to its plan", () => {
    process.env.STRIPE_PRICE_PROTECT_MONTHLY = "price_abc";
    expect(planForPriceId("price_abc")).toEqual({ slug: "protect", included: 10 });
  });

  it("resolves the yearly price to the same plan", () => {
    process.env.STRIPE_PRICE_MANAGED_YEARLY = "price_year";
    expect(planForPriceId("price_year")).toEqual({ slug: "managed", included: 50 });
  });

  it("falls back to free for an unknown price rather than granting a paid plan", () => {
    // A price created in the dashboard, or one from another product in this
    // shared Stripe account, must never confer entitlements here.
    expect(planForPriceId("price_from_another_product")).toEqual({ slug: "free", included: 0 });
  });

  it("does not match on an empty or missing price id", () => {
    process.env.STRIPE_PRICE_MONITOR_MONTHLY = "";
    expect(planForPriceId("")).toEqual({ slug: "free", included: 0 });
  });

  it("keeps allowances consistent with the published tiers", () => {
    expect(PLANS.map((p) => [p.slug, p.includedEnforcements])).toEqual([
      ["monitor", 0],
      ["protect", 10],
      ["managed", 50],
    ]);
  });

  it("prices yearly at ten months of the monthly rate", () => {
    for (const p of PLANS) expect(p.yearly).toBe(p.monthly * 10);
  });
});
