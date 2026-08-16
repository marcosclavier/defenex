import { describe, it, expect } from "vitest";
import {
  isDueForVerification,
  VERIFY_FIRST_DELAY_HOURS,
  VERIFY_INTERVAL_HOURS,
  VERIFY_MAX_ATTEMPTS,
} from "../src/repo.js";

const now = new Date("2026-08-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function due(overrides: Partial<Parameters<typeof isDueForVerification>[0]> = {}) {
  return isDueForVerification({
    status: "submitted",
    submittedAt: hoursAgo(VERIFY_FIRST_DELAY_HOURS + 1),
    lastVerifiedAt: null,
    verifyAttempts: 0,
    now,
    ...overrides,
  });
}

describe("isDueForVerification", () => {
  // Only a notice that actually went out has anything to verify.
  it.each([
    ["draft"],
    ["pending_approval"],
    ["awaiting_filing"],
    ["declined"],
    ["removed"],
    ["blocked_no_evidence"],
  ])("never checks a takedown in %s", (status) => {
    expect(due({ status })).toBe(false);
  });

  it.each([["submitted"], ["accepted"]])("checks a takedown in %s", (status) => {
    expect(due({ status })).toBe(true);
  });

  // Hosts do not act within the hour, and checking sooner only burns fetches.
  it("waits the initial delay before the first check", () => {
    expect(due({ submittedAt: hoursAgo(VERIFY_FIRST_DELAY_HOURS - 1) })).toBe(false);
    expect(due({ submittedAt: hoursAgo(VERIFY_FIRST_DELAY_HOURS) })).toBe(true);
  });

  it("then settles into the recurring interval", () => {
    const submittedAt = hoursAgo(240);
    expect(due({ submittedAt, lastVerifiedAt: hoursAgo(VERIFY_INTERVAL_HOURS - 1) })).toBe(false);
    expect(due({ submittedAt, lastVerifiedAt: hoursAgo(VERIFY_INTERVAL_HOURS) })).toBe(true);
  });

  // A notice that has produced nothing in thirty checks belongs in front of a
  // person deciding on escalation, not in a loop.
  it("stops after the attempt limit", () => {
    expect(due({ verifyAttempts: VERIFY_MAX_ATTEMPTS - 1 })).toBe(true);
    expect(due({ verifyAttempts: VERIFY_MAX_ATTEMPTS })).toBe(false);
  });

  it("cannot be due without a submission time", () => {
    expect(due({ submittedAt: null })).toBe(false);
  });

  it("defaults to the current clock when none is given", () => {
    expect(
      isDueForVerification({
        status: "submitted",
        submittedAt: new Date(Date.now() - (VERIFY_FIRST_DELAY_HOURS + 1) * 3_600_000),
        lastVerifiedAt: null,
        verifyAttempts: 0,
      }),
    ).toBe(true);
  });
});
