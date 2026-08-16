import { describe, it, expect } from "vitest";
import { evidenceBundleKey } from "../src/storage/keys.js";
import { evidenceJobId } from "../src/job-ids.js";

describe("evidence keys", () => {
  it("puts one bundle per takedown under a stable prefix", () => {
    expect(evidenceBundleKey("abc-123")).toBe("evidence/abc-123.zip");
  });

  // BullMQ rejects a custom id containing ":", which is why the separator is a
  // hyphen everywhere.
  it("uses a job id BullMQ accepts", () => {
    expect(evidenceJobId("abc-123")).toBe("evidence-abc-123");
    expect(evidenceJobId("abc-123")).not.toContain(":");
  });
});
