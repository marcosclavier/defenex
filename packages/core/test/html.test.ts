import { describe, it, expect } from "vitest";
import { htmlToText, extractTitle } from "../src/enrich/html.js";

/**
 * Shared by every paid fetch provider, which is the point: the classifier and
 * the evidence verifier must read the same text whichever tier answered.
 */
describe("htmlToText", () => {
  it("drops script, style and comment content entirely", () => {
    const html = `<div>Real text</div><script>var evil="hidden text"</script><style>.a{color:red}</style><!-- note -->`;
    const text = htmlToText(html);
    expect(text).toContain("Real text");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("note");
  });

  it("decodes entities so quotes can be matched verbatim", () => {
    // Evidence verification compares the model's quote against this text, so a
    // stray &amp; here becomes a rejected finding later.
    expect(htmlToText("<p>Tom &amp; Jerry&#39;s &quot;replica&quot; &lt;deal&gt;</p>")).toBe(
      'Tom & Jerry\'s "replica" <deal>',
    );
  });

  it("keeps block boundaries as newlines rather than running words together", () => {
    expect(htmlToText("<li>One</li><li>Two</li>")).toBe("One\nTwo");
    expect(htmlToText("<p>A</p><p>B</p>")).not.toContain("AB");
  });

  it("collapses whitespace without destroying words", () => {
    expect(htmlToText("<div>  lots   of\n\n  space </div>")).toBe("lots of space");
  });
});

describe("extractTitle", () => {
  it("pulls and cleans the document title", () => {
    expect(extractTitle("<html><head><title> Cheap &amp; Fake </title></head></html>")).toBe(
      "Cheap & Fake",
    );
  });
  it("returns null when absent", () => {
    expect(extractTitle("<html><body>x</body></html>")).toBeNull();
  });
});

const scraper = (fetchImpl: typeof fetch) =>
  new StealthScraper({ apiKey: "k", fetchImpl });

const body = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, data }), { status });
