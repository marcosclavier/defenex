import { describe, it, expect } from "vitest";
import { scanJobId, reportJobId } from "../src/job-ids.js";

const UUID = "3f7c1a2e-9b44-4d1a-8c77-0f2b6d5e1a90";

describe("job ids", () => {
  // Regression: colons were rejected at runtime with "Custom Id cannot contain :",
  // because BullMQ uses ":" to namespace its own Redis keys. The API returned a
  // 500 on every scan request until this was fixed.
  it.each([
    ["scan", scanJobId(UUID)],
    ["report", reportJobId(UUID)],
  ])("%s id contains no colon", (_kind, id) => {
    expect(id).not.toContain(":");
  });

  it("stays deterministic so a double submit cannot enqueue twice", () => {
    expect(scanJobId(UUID)).toBe(scanJobId(UUID));
    expect(scanJobId(UUID)).not.toBe(scanJobId("other-id"));
  });

  it("keeps scan and report ids distinct for the same scan", () => {
    expect(scanJobId(UUID)).not.toBe(reportJobId(UUID));
  });
});
