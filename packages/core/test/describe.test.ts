import { describe, it, expect } from "vitest";
import { sanitizeDescription, fallbackDescription, type DescribeInput } from "../src/takedown/describe.js";

const url = "https://www.dhgate.com/wholesale/replica+yeti+cooler.html";
const good =
  "The page offers a cooler described as a replica of the brand's product, sold by a third-party seller. The listing uses the brand name in its title and product description.";

describe("sanitizeDescription", () => {
  it("accepts a plain factual paragraph", () => {
    const result = sanitizeDescription(good, url);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(good);
  });

  it("collapses whitespace so the notice reads as one paragraph", () => {
    expect(sanitizeDescription(`  ${good}\n\n  `, url).text).toBe(good);
  });

  // A model that writes its own sworn statement has produced a second,
  // unreviewed one — and the two need not agree with the fixed frame.
  it.each([
    ["I declare under penalty of perjury that this is accurate."],
    ["I have a good faith belief that the use is unauthorised."],
    ["This notice is submitted under 17 U.S.C. §512(c)."],
    ["The complainant is authorized to act on behalf of the owner."],
    ["/s/ A Model"],
  ])("rejects reserved legal wording: %s", (phrase) => {
    const result = sanitizeDescription(`${good} ${phrase}`, url);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("reserved legal wording");
  });

  // A hallucinated URL points a provider at a page that may belong to someone
  // entirely uninvolved.
  it("rejects a URL that is not the one under complaint", () => {
    const result = sanitizeDescription(`${good} See also https://evil.example/other.`, url);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("unrelated URL");
  });

  it("allows the URL under complaint, including a different path on that host", () => {
    expect(sanitizeDescription(`${good} The listing is at ${url}.`, url).ok).toBe(true);
    expect(sanitizeDescription(`${good} See https://dhgate.com/other.html.`, url).ok).toBe(true);
  });

  // Registration numbers are the one fact a notice cannot afford to invent.
  it("rejects a registration number, which must come from the rights record", () => {
    const result = sanitizeDescription(`${good} Registration No. 1234567 covers it.`, url);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("registration number");
  });

  it.each([[""], ["Too short."], ["a".repeat(1500)]])("rejects an unusable length", (text) => {
    expect(sanitizeDescription(text, url).ok).toBe(false);
  });

  // Observed for real: a token budget consumed by thinking left the paragraph
  // ending "...explicitly use the YET". It was otherwise well-formed enough to
  // look deliberate in a finished notice.
  it("rejects a paragraph cut off mid-sentence", () => {
    const result = sanitizeDescription("The page offers coolers that explicitly use the YET", url);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("cut off");
  });

  it.each([
    ["ends with a full stop."],
    ['ends with a quoted phrase "like this."'],
    ["ends with a question?"],
  ])("accepts a complete sentence: %s", (tail) => {
    expect(sanitizeDescription(`${good.slice(0, -1)}, and it ${tail}`, url).ok).toBe(true);
  });

  it("reports every problem at once rather than the first", () => {
    const result = sanitizeDescription(
      `${good} Under penalty of perjury. See https://evil.example/x. Registration No. 1.`,
      url,
    );
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("fallbackDescription", () => {
  const base: DescribeInput = {
    brandName: "YETI",
    category: "COUNTERFEIT",
    noticeKind: "trademark",
    url,
    pageTitle: "Replica YETI Tundra 45",
    evidenceQuote: "Replica YETI Tundra 45 cooler",
    markText: "YETI",
  };

  // The fallback is what a notice falls back to, so it has to survive the same
  // guardrails the model's output does.
  it("is itself acceptable to the sanitiser", () => {
    for (const category of ["COUNTERFEIT", "PHISHING", "DOMAIN_SQUAT", "PIRACY", "IMPERSONATION"] as const) {
      const text = fallbackDescription({ ...base, category });
      expect(sanitizeDescription(text, url).ok, category).toBe(true);
    }
  });

  it("describes the category rather than asserting anything extra", () => {
    expect(fallbackDescription(base)).toContain("did not originate with the rights holder");
    expect(fallbackDescription({ ...base, category: "PHISHING" })).toContain("collect credentials");
  });

  it("is deterministic", () => {
    expect(fallbackDescription(base)).toBe(fallbackDescription(base));
  });

  it("omits the title when there is none", () => {
    expect(fallbackDescription({ ...base, pageTitle: null })).not.toContain("titled");
  });
});
