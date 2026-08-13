import { describe, it, expect } from "vitest";
import { createStealthBudget } from "../src/enrich/fetch.js";

describe("stealth budget", () => {
  it("is a fresh allowance per run, not shared state", () => {
    // Regression: the budget used to live on the PageFetcher singleton, so two
    // concurrent scans drew from one allowance and reported each other's spend.
    const a = createStealthBudget(5);
    const b = createStealthBudget(5);
    a.remaining -= 3;
    a.used += 3;
    expect(b.remaining).toBe(5);
    expect(b.used).toBe(0);
  });

  it("clamps a negative limit to zero rather than granting infinite calls", () => {
    expect(createStealthBudget(-4).remaining).toBe(0);
  });

  it("supports a zero budget, which disables the paid tier entirely", () => {
    expect(createStealthBudget(0).remaining).toBe(0);
  });
});
