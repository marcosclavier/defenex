import Link from "next/link";
import { Header, Footer } from "@/components/Shell";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-24 pb-20">
        <p className="t-eyebrow">404</p>
        <h1 className="t-h2 mt-3">That page is not here</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          Report links expire when a report is deleted, and scan links are only valid for the
          scan that created them.
        </p>
        <Link
          href="/scan"
          className="mt-8 inline-block bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim"
        >
          Run a scan
        </Link>
      </main>
      <Footer />
    </>
  );
}
