import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";

/*
 * Articles are Markdown files in content/blog, read at build time. Every blog
 * page is statically generated, so nothing here runs per request.
 *
 * Filenames carry a two-digit order prefix (01-…); the URL slug comes from
 * frontmatter and has no prefix. Articles link to each other by filename
 * (./02-report-counterfeits-by-platform.md) so they read correctly in an
 * editor, and those links are rewritten to /blog/<slug> here.
 */

const DIR = path.join(process.cwd(), "content/blog");

export interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  pillar: string;
  publishDate: string;
  image: string;
  imageAlt: string;
  readingTime: string;
}

export interface Article extends ArticleMeta {
  html: string;
}

const REQUIRED = [
  "slug", "title", "description", "pillar", "publishDate", "image", "imageAlt", "readingTime",
] as const;

/** Flat `key: value` frontmatter only, which is all the articles use. */
export function parseFrontmatter(source: string, file: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match?.[1]) throw new Error(`${file}: missing frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [, key, value] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
    if (key && value !== undefined) meta[key] = value.replace(/^"(.*)"$/, "$1");
  }
  for (const key of REQUIRED) {
    if (!meta[key]) throw new Error(`${file}: frontmatter is missing "${key}"`);
  }
  return { meta: meta as unknown as ArticleMeta, body: source.slice(match[0].length) };
}

function files() {
  return readdirSync(DIR).filter((f) => /^\d{2}-.*\.md$/.test(f)).sort();
}

function load(file: string) {
  const { meta, body } = parseFrontmatter(readFileSync(path.join(DIR, file), "utf8"), file);
  // Images live in public/blog; frontmatter names them relative to the article.
  return { meta: { ...meta, image: `/blog/${path.basename(meta.image)}` }, body };
}

/** In reading order: the filename prefix is the order the series builds in. */
export function listArticles(): ArticleMeta[] {
  return files().map((f) => load(f).meta);
}

export function renderMarkdown(body: string, slugByFile: Map<string, string>): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type !== "link") return;
      const [, file, anchor = ""] = /^\.\/([\w-]+\.md)(#.*)?$/.exec(token.href) ?? [];
      if (!file) return;
      const slug = slugByFile.get(file);
      if (!slug) throw new Error(`broken article link: ${token.href}`);
      token.href = `/blog/${slug}${anchor}`;
    },
    renderer: {
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        return external
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<a href="${href}">${text}</a>`;
      },
    },
    hooks: {
      // Wide tables scroll inside their own container, never the page.
      postprocess: (html) =>
        html.replace(/<table>/g, '<div class="scroll-x"><table>').replace(/<\/table>/g, "</table></div>"),
    },
  });
  // The page renders the title itself; drop a leading H1 that repeats it.
  return marked.parse(body.replace(/^\s*# .*\n/, ""), { async: false });
}

export function getArticle(slug: string): Article | undefined {
  const all = files().map((f) => ({ file: f, ...load(f) }));
  const found = all.find((a) => a.meta.slug === slug);
  if (!found) return undefined;
  const slugByFile = new Map(all.map((a) => [a.file, a.meta.slug]));
  return { ...found.meta, html: renderMarkdown(found.body, slugByFile) };
}
