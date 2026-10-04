import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, Footer } from "@/components/Shell";
import { getArticle, listArticles } from "@/lib/blog";

type Params = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return listArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const article = getArticle((await params).slug);
  if (!article) return {};
  const images = [{ url: article.image, width: 1376, height: 768, alt: article.imageAlt }];
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.description,
      publishedTime: article.publishDate,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
      images: [article.image],
    },
  };
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export default async function ArticlePage({ params }: Params) {
  const article = getArticle((await params).slug);
  if (!article) notFound();

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-16 pb-20">
        <Link href="/blog" className="t-eyebrow transition-colors hover:text-ink-dim">← Blog</Link>
        <h1 className="t-h2 mt-6">{article.title}</h1>
        <p className="mt-4 font-mono text-xs text-ink-mute">
          {article.pillar} · {formatDate(article.publishDate)} · {article.readingTime}
        </p>
        <Image
          src={article.image}
          alt={article.imageAlt}
          width={1376}
          height={768}
          priority
          sizes="(min-width: 672px) 624px, 100vw"
          className="mt-8 w-full border border-line"
        />
        <article
          className={[
            "mt-10 space-y-5 text-ink-dim",
            "[&_p]:leading-relaxed [&_strong]:text-ink [&_em]:text-ink-dim",
            "[&_h2]:pt-6 [&_h2]:text-ink [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
            "[&_h3]:pt-2 [&_h3]:text-ink [&_h3]:font-semibold",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1.5 [&_li]:leading-relaxed",
            "[&_a]:text-ink [&_a]:underline [&_a]:decoration-line-strong [&_a]:underline-offset-2 hover:[&_a]:decoration-ink",
            "[&_code]:font-mono [&_code]:text-[0.875em] [&_code]:text-ink",
            "[&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface [&_pre]:p-4",
            "[&_blockquote]:border-l [&_blockquote]:border-line-strong [&_blockquote]:pl-4",
            "[&_hr]:border-line",
            "[&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-line-strong [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_th]:text-ink",
            "[&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top",
          ].join(" ")}
          dangerouslySetInnerHTML={{ __html: article.html }}
        />
      </main>
      <Footer />
    </>
  );
}
