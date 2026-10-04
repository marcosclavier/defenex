import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { getArticle, listArticles, parseFrontmatter, renderMarkdown } from "../lib/blog";

describe("blog content", () => {
  const articles = listArticles();

  it("has unique slugs", () => {
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length);
  });

  it("has a hero image on disk for every article", () => {
    for (const a of articles) {
      expect(existsSync(path.join(process.cwd(), "public", a.image)), a.image).toBe(true);
    }
  });

  // getArticle throws on a link to a file that does not exist.
  it("renders every article with internal links resolved", () => {
    for (const a of articles) {
      const html = getArticle(a.slug)!.html;
      expect(html).not.toMatch(/href="\.\/[^"]*\.md/);
      expect(html).not.toMatch(/<h1/);
    }
  });
});

describe("renderMarkdown", () => {
  const slugs = new Map([["02-report-counterfeits-by-platform.md", "report-counterfeits-by-platform"]]);

  it("rewrites article links to blog routes, keeping the anchor", () => {
    const html = renderMarkdown("See [the guide](./02-report-counterfeits-by-platform.md#amazon).", slugs);
    expect(html).toContain('href="/blog/report-counterfeits-by-platform#amazon"');
  });

  it("throws on a link to an article that does not exist", () => {
    expect(() => renderMarkdown("[x](./99-missing.md)", slugs)).toThrow(/broken article link/);
  });

  it("opens external links in a new tab", () => {
    expect(renderMarkdown("[a](https://example.com)", slugs)).toContain('rel="noopener noreferrer"');
  });

  it("wraps tables so they scroll inside their own container", () => {
    expect(renderMarkdown("| a |\n|---|\n| b |", slugs)).toContain('<div class="scroll-x"><table>');
  });
});

describe("parseFrontmatter", () => {
  it("rejects an article missing a required field", () => {
    expect(() => parseFrontmatter("---\ntitle: x\n---\nbody", "x.md")).toThrow(/missing "slug"/);
  });
});
