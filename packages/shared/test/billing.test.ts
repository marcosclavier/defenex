import { describe, it, expect } from "vitest";
import { enforcementAllowance, overagePriceFor } from "../src/billing.js";

describe("overagePriceFor", () => {
  it.each([
    ["protect", 85],
    ["managed", 85],
    ["monitor", 195],
    ["free", 195],
  ])("%s pays $%i", (plan, price) => {
    expect(overagePriceFor(plan)).toBe(price);
  });

  // An unknown plan slug must fall back to the full price, never to the
  // discounted one — a typo in a Stripe price mapping should not hand out a
  // discount.
  it.each([[null], [undefined], ["enterprise"]])("falls back to $195 for %s", (plan) => {
    expect(overagePriceFor(plan as string | null)).toBe(195);
  });
});

describe("enforcementAllowance", () => {
  // The boundary that matters: the last included enforcement is still included.
  it("allows the final included enforcement", () => {
    const state = enforcementAllowance({ plan: "protect", enforcementsUsed: 9, enforcementsIncluded: 10 });
    expect(state.exhausted).toBe(false);
    expect(state.remaining).toBe(1);
  });

  it("is exhausted once used reaches included", () => {
    const state = enforcementAllowance({ plan: "protect", enforcementsUsed: 10, enforcementsIncluded: 10 });
    expect(state.exhausted).toBe(true);
    expect(state.remaining).toBe(0);
    expect(state.overageUsd).toBe(85);
  });

  it("stays exhausted rather than going negative if usage overshoots", () => {
    const state = enforcementAllowance({ plan: "protect", enforcementsUsed: 12, enforcementsIncluded: 10 });
    expect(state.remaining).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  // Absence of a billing record must never grant entitlement.
  it.each([[null], [undefined], [{}]])("treats %s as no allowance", (customer) => {
    const state = enforcementAllowance(customer as null);
    expect(state.included).toBe(0);
    expect(state.exhausted).toBe(true);
    expect(state.overageUsd).toBe(195);
  });

  it("gives Monitor no included enforcements even though it is a paid plan", () => {
    const state = enforcementAllowance({ plan: "monitor", enforcementsUsed: 0, enforcementsIncluded: 0 });
    expect(state.exhausted).toBe(true);
    expect(state.overageUsd).toBe(195);
  });

  it("clamps corrupt negative counters instead of trusting them", () => {
    const state = enforcementAllowance({ plan: "managed", enforcementsUsed: -3, enforcementsIncluded: 50 });
    expect(state.used).toBe(0);
    expect(state.remaining).toBe(50);
  });
});
