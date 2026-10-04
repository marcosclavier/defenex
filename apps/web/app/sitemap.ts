import type { MetadataRoute } from "next";
import { listArticles } from "@/lib/blog";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://defenex.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/scan", "/pricing", "/blog", "/privacy", "/terms", "/acceptable-use"];
  return [
    ...pages.map((p) => ({ url: `${BASE}${p}` })),
    ...listArticles().map((a) => ({ url: `${BASE}/blog/${a.slug}`, lastModified: a.publishDate })),
  ];
}
