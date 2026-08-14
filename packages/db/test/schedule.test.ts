import { describe, it, expect } from "vitest";
import { isDueForScan, CADENCE_HOURS } from "../src/repo.js";

const NOW = new Date("2026-08-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const base = {
  plan: "protect",
  status: "active" as string | null,
  monitoringPaused: false,
  lastScheduledAt: hoursAgo(48),
  now: NOW,
};

describe("isDueForScan", () => {
  it("schedules a paid brand whose cadence has elapsed", () => {
    expect(isDueForScan(base)).toBe(true);
  });

  it("never schedules a free brand", () => {
    // An unclaimed brand scanned once through the free tool must not turn into
    // a recurring cost.
    expect(isDueForScan({ ...base, plan: "free" })).toBe(false);
    expect(CADENCE_HOURS.free).toBeNull();
  });

  it("respects each plan's cadence", () => {
    // Monitor is weekly, so a scan 48h ago is not yet due.
    expect(isDueForScan({ ...base, plan: "monitor", lastScheduledAt: hoursAgo(48) })).toBe(false);
    expect(isDueForScan({ ...base, plan: "monitor", lastScheduledAt: hoursAgo(24 * 8) })).toBe(true);
    // Protect and Managed are daily.
    expect(isDueForScan({ ...base, plan: "protect", lastScheduledAt: hoursAgo(23) })).toBe(false);
    expect(isDueForScan({ ...base, plan: "managed", lastScheduledAt: hoursAgo(25) })).toBe(true);
  });

  it("schedules a brand that has never been scanned", () => {
    expect(isDueForScan({ ...base, lastScheduledAt: null })).toBe(true);
  });

  it("does not schedule while paused", () => {
    expect(isDueForScan({ ...base, monitoringPaused: true })).toBe(false);
  });

  it("keeps scanning a past_due account while Stripe retries the card", () => {
    // Cutting monitoring off on the first declined payment punishes a customer
    // for an expired card, before dunning has even run.
    expect(isDueForScan({ ...base, status: "past_due" })).toBe(true);
  });

  it.each(["canceled", "incomplete", null])("does not schedule status %s", (status) => {
    expect(isDueForScan({ ...base, status })).toBe(false);
  });

  it("treats an unknown plan as unscheduled rather than daily", () => {
    expect(isDueForScan({ ...base, plan: "enterprise_custom" })).toBe(false);
  });
});
