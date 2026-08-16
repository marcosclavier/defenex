import { describe, it, expect } from "vitest";
import { scrub, scrubString } from "../src/scrub.js";

describe("scrubString", () => {
  // Credentials should not be in an event at all, but a serialised error
  // routinely carries a whole config object along with it.
  it.each([
    ["sk_live_51AbCdEfGhIjKlMnOp", "Stripe live secret"],
    ["rk_test_51AbCdEfGhIjKlMnOp", "Stripe restricted key"],
    ["whsec_AbCdEf123456789", "Stripe webhook secret"],
    ["re_AbCdEf123456789", "Resend key"],
    ["postgres://user:pw@host:5432/db", "database URL with password"],
    ["rediss://default:pw@host:6379", "redis URL with password"],
    ["Bearer eyJhbGciOiJIUzI1NiJ9.abcdefgh", "bearer token"],
  ])("redacts %s (%s)", (secret) => {
    const out = scrubString(`connection failed using ${secret} at boot`);
    expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
  });

  // Personal data. The user id identifies the account; the address adds nothing
  // to a stack trace and everything to a breach.
  it("replaces email addresses", () => {
    expect(scrubString("send to marcos.clavier33@gmail.com failed")).toBe(
      "send to [email] failed",
    );
  });

  it("handles several secrets in one string", () => {
    const out = scrubString("sk_live_AAAAAAAAAAAA then re_BBBBBBBBBBBB for a@b.com");
    expect(out).not.toMatch(/sk_live|re_B|a@b\.com/);
  });

  it("leaves ordinary text alone", () => {
    const msg = "scan failed after 3 attempts: timeout fetching page 12";
    expect(scrubString(msg)).toBe(msg);
  });
});

describe("scrub", () => {
  it("redacts by key name regardless of the value", () => {
    const out = scrub({ apiKey: "plainlooking", AUTHORIZATION: "x", nested: { secret: "y" } });
    expect(out).toEqual({ apiKey: "[redacted]", AUTHORIZATION: "[redacted]", nested: { secret: "[redacted]" } });
  });

  it("walks arrays and nested objects", () => {
    const out = scrub({ items: [{ email: "a@b.com" }, { note: "sk_live_AAAAAAAAAAAA" }] });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.com|sk_live/);
  });

  it("preserves the shape and the non-sensitive values", () => {
    const out = scrub({ queue: "submit", attempt: 2, ok: false, at: null });
    expect(out).toEqual({ queue: "submit", attempt: 2, ok: false, at: null });
  });

  // A Sentry event is a deep structure; the walk must terminate.
  it("stops at the depth limit instead of recursing forever", () => {
    let deep: Record<string, unknown> = { email: "a@b.com" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => scrub(deep)).not.toThrow();
  });

  it("scrubs a realistic event payload end to end", () => {
    const event = {
      message: "resend send failed",
      request: {
        headers: { authorization: "Bearer abcdefghijklmnop", "user-agent": "node" },
        url: "https://defenex.com/api/admin/takedowns/1/decide",
      },
      extra: {
        to: "abuse@markmonitor.com",
        DATABASE_URL: "postgres://u:p@h/db",
        takedownId: "6f1b",
      },
    };
    const json = JSON.stringify(scrub(event));
    expect(json).not.toContain("abuse@markmonitor.com");
    expect(json).not.toContain("abcdefghijklmnop");
    expect(json).not.toContain("postgres://");
    // Still useful for debugging.
    expect(json).toContain("resend send failed");
    expect(json).toContain("6f1b");
    expect(json).toContain("node");
  });
});
