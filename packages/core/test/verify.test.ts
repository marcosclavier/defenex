import { describe, it, expect } from "vitest";
import { verifyEvidence, isProbative } from "../src/classify/verify.js";

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

describe("isProbative", () => {
  it("accepts a quote naming the brand", () => {
    expect(isProbative("Wholesale Cheap Yeti Cup - Buy in Bulk", "YETI")).toBe(true);
  });

  it("accepts deliberately mangled marks used to evade detection", () => {
    // Counterfeit listings run the mark into adjacent words on purpose.
    expect(isProbative("Patagoniamens Women Designer Unisex Patagoniapants", "Patagonia")).toBe(true);
    expect(isProbative("Patagoniafleece Jacket Designer Zippe Jackets", "Patagonia")).toBe(true);
  });

  it("accepts infringement vocabulary even without the brand name", () => {
    expect(isProbative("AAA quality replica goods shipped worldwide", "Acme")).toBe(true);
    expect(isProbative("download the cracked version with keygen", "Acme")).toBe(true);
  });

  it("accepts credential-harvest vocabulary for phishing findings", () => {
    expect(isProbative("verify your login credentials and payment card details", "Acme")).toBe(true);
  });

  it("rejects generic marketing boilerplate", () => {
    // Real DHgate text that three Patagonia findings cited as their evidence.
    expect(isProbative("Every mobile clothing is inspired by high-quality designers.", "Patagonia")).toBe(false);
  });

  it.each([
    "Free shipping on all orders over twenty dollars",
    "Wholesale prices available for bulk buyers",
    "Add to cart and checkout securely today",
  ])("rejects ordinary commerce copy: %s", (quote) => {
    expect(isProbative(quote, "Patagonia")).toBe(false);
  });

  it("accepts a quote naming an alias", () => {
    expect(isProbative("genuine AcmeTool parts here", "Acme Tools", ["AcmeTool"])).toBe(true);
  });
});

describe("verifyEvidence with a brand", () => {
  const source = "Every mobile clothing is inspired by high-quality designers. Buy now.";

  it("rejects a present-but-unprobative quote", () => {
    const check = verifyEvidence(
      "Every mobile clothing is inspired by high-quality designers.",
      source,
      { brand: "Patagonia" },
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("quote_not_probative");
  });

  it("still requires the quote to exist before judging whether it proves anything", () => {
    expect(verifyEvidence("replica Patagonia jacket", source, { brand: "Patagonia" }).reason).toBe(
      "quote_not_in_source",
    );
  });

  it("stays permissive when no brand is supplied", () => {
    expect(verifyEvidence("Every mobile clothing is inspired by high", source).ok).toBe(true);
  });
});
