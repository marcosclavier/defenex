import type { Metadata } from "next";
import { Header, Footer } from "@/components/Shell";
import { ScanForm } from "./ScanForm";

export const metadata: Metadata = { title: "Run a scan" };

export default function ScanPage() {
  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-16 pb-20">
        <p className="t-eyebrow">Free scan</p>
        <h1 className="t-h2 mt-3">Scan your brand</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          We search the open web, fetch each candidate page, and report only what we can
          quote. Takes about 90 seconds.
        </p>
        <ScanForm />
      </main>
      <Footer />
    </>
  );
}
