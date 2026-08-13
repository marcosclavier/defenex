import { describe, it, expect } from "vitest";
import { verifyEvidence } from "../src/classify/verify.js";

const SOURCE =
  "Welcome to our store. We sell AAA quality replica Acme watches at wholesale prices. Free shipping worldwide.";

describe("verifyEvidence", () => {
  it("accepts a verbatim quote", () => {
    expect(verifyEvidence("AAA quality replica Acme watches", SOURCE).ok).toBe(true);
  });

  it("tolerates whitespace and case differences", () => {
    expect(verifyEvidence("aaa   QUALITY replica acme watches", SOURCE).ok).toBe(true);
  });

  it("normalizes smart quotes and dashes", () => {
    const src = "This is a “premium” replica — best price";
    expect(verifyEvidence('this is a "premium" replica - best price', src).ok).toBe(true);
  });

  it("rejects a paraphrase the model invented", () => {
    const check = verifyEvidence("they sell fake Acme products here", SOURCE);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("quote_not_in_source");
  });

  it("rejects quotes too short to prove anything", () => {
    expect(verifyEvidence("replica", SOURCE).reason).toBe("quote_too_short");
  });

  it("rejects empty quotes and empty sources", () => {
    expect(verifyEvidence("", SOURCE).reason).toBe("empty_quote");
    expect(verifyEvidence("AAA quality replica", "").reason).toBe("no_source_text");
  });
});
