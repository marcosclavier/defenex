import { describe, it, expect } from "vitest";
import { htmlToText, extractTitle, extractMetadataText, extractReadableText } from "../src/enrich/html.js";
import { isUsableScrape, MIN_USEFUL_TEXT } from "../src/enrich/scrape.js";

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

describe("extractMetadataText", () => {
  const meta = (tags: string) => `<html><head>${tags}</head><body></body></html>`;

  it("reads a client-rendered page's own description of itself", () => {
    // An AliExpress listing arrives as 64KB of HTML that reduces to thirty
    // characters: window.runParams is empty and the product is fetched by
    // script afterwards. og:title is the only place the server says what the
    // page is, and it carries the full listing title, brand included.
    const html = meta(
      `<meta property="og:title" content="Screw Top Lid Replacement Compatible with Rambler Yeti">`,
    );
    expect(extractMetadataText(html)).toBe(
      "Screw Top Lid Replacement Compatible with Rambler Yeti",
    );
  });

  it("reads attributes in either order", () => {
    expect(extractMetadataText(meta(`<meta content="Acme Cooler" property="og:title">`))).toBe(
      "Acme Cooler",
    );
  });

  it("does not repeat the same string from two tags", () => {
    const html = meta(
      `<meta property="og:title" content="Acme Cooler"><meta name="twitter:title" content="Acme Cooler">`,
    );
    expect(extractMetadataText(html)).toBe("Acme Cooler");
  });

  it("decodes entities", () => {
    expect(extractMetadataText(meta(`<meta property="og:title" content="Bob&#39;s &amp; Co">`))).toBe(
      "Bob's & Co",
    );
  });

  it("returns nothing when there is no metadata", () => {
    expect(extractMetadataText("<html><body><p>hi</p></body></html>")).toBe("");
  });
});

describe("extractReadableText", () => {
  it("prefers the body when there is one", () => {
    const body = `<p>${"real page content. ".repeat(20)}</p>`;
    const html = `<html><head><meta property="og:title" content="ignored"></head><body>${body}</body></html>`;
    const out = extractReadableText(html);
    expect(out.text).not.toContain("ignored");
    expect(out.bodyChars).toBe(out.text.length);
  });

  it("falls back to metadata when the body is a shell", () => {
    const html = `<html><head><meta property="og:title" content="Replica Acme Cooler 20oz"></head><body><div></div></body></html>`;
    const out = extractReadableText(html);
    expect(out.text).toBe("Replica Acme Cooler 20oz");
    // The page still served no document, and everything that asks whether we
    // saw the page has to keep getting "no".
    expect(out.bodyChars).toBe(0);
  });

  it("reports body length separately so metadata cannot pass as a page we read", () => {
    const html = `<html><head><meta property="og:description" content="${"x".repeat(400)}"></head><body>tiny</body></html>`;
    const out = extractReadableText(html);
    expect(out.text.length).toBeGreaterThan(MIN_USEFUL_TEXT);
    expect(out.bodyChars).toBeLessThan(MIN_USEFUL_TEXT);
    expect(isUsableScrape({ statusCode: 200, text: out.text, bodyChars: out.bodyChars, title: null, finalUrl: "u", costMicros: 0 }))
      .toBe(false);
  });
});

describe("extractTitle", () => {
  it("prefers the title tag", () => {
    expect(extractTitle(`<html><head><title>Real</title><meta property="og:title" content="Meta"></head></html>`))
      .toBe("Real");
  });

  it("falls back to og:title when the title tag is empty", () => {
    // AliExpress serves <title></title> and puts the product name in og:title;
    // taking the tag literally reported those listings as untitled.
    expect(extractTitle(`<html><head><title></title><meta property="og:title" content="Acme Cooler"></head></html>`))
      .toBe("Acme Cooler");
  });

  it("returns null when there is neither", () => {
    expect(extractTitle("<html><body>hi</body></html>")).toBeNull();
  });
});
