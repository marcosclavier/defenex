import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, Footer } from "@/components/Shell";
import { listArticles } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "How counterfeits, lookalike domains, phishing and impersonation work — and how to find and remove them.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  const [lead, ...rest] = listArticles();
  if (!lead) notFound();

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-5xl px-6 pt-16 pb-20">
        <p className="t-eyebrow">Blog</p>
        <h1 className="t-h2 mt-3">Finding and removing brand infringement</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          How counterfeits, lookalike domains, phishing and impersonation work, and what
          to do about each — written for brands without a legal team on call.
        </p>

        <Link href={`/blog/${lead.slug}`} className="group mt-12 grid gap-6 border border-line bg-surface md:grid-cols-2">
          <Image
            src={lead.image}
            alt={lead.imageAlt}
            width={1376}
            height={768}
            priority
            sizes="(min-width: 768px) 512px, 100vw"
            className="h-full w-full object-cover"
          />
          <div className="flex flex-col justify-center p-6 md:pl-0">
            <p className="t-eyebrow">{lead.pillar} · {lead.readingTime}</p>
            <h2 className="t-h3 mt-3 group-hover:underline">{lead.title}</h2>
            <p className="t-small mt-3 text-ink-dim">{lead.description}</p>
          </div>
        </Link>

        <div className="mt-px grid gap-px border border-t-0 border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((a) => (
            <Link key={a.slug} href={`/blog/${a.slug}`} className="group flex flex-col bg-canvas">
              <Image
                src={a.image}
                alt={a.imageAlt}
                width={1376}
                height={768}
                sizes="(min-width: 1024px) 336px, (min-width: 640px) 50vw, 100vw"
                className="w-full"
              />
              <div className="flex flex-1 flex-col p-5">
                <p className="t-eyebrow">{a.pillar} · {a.readingTime}</p>
                <h2 className="t-h3 mt-2 group-hover:underline">{a.title}</h2>
                <p className="t-small mt-2 text-ink-dim">{a.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
