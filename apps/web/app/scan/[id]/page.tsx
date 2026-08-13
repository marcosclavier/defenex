import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header, Footer } from "@/components/Shell";
import { Progress } from "./Progress";

export const metadata: Metadata = { title: "Scanning" };

export default async function ScanProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-16 pb-20">
        <p className="t-eyebrow">Scan in progress</p>
        <h1 className="t-h2 mt-3">Searching the open web</h1>
        <p className="t-small measure mt-3 text-ink-dim">
          We are running the search, fetching each candidate page and checking whether the
          evidence holds up. Leave this open — it updates on its own.
        </p>
        <Progress scanId={id} />
      </main>
      <Footer />
    </>
  );
}
