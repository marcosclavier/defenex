import { Header, Footer } from "@/components/Shell";

export function LegalPage({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="w-full flex-1 mx-auto max-w-2xl px-6 pt-16 pb-20">
        <p className="t-eyebrow">Last updated {updated}</p>
        <h1 className="t-h2 mt-3">{title}</h1>
        <div className="mt-8 space-y-6 text-ink-dim [&_h2]:mt-10 [&_h2]:text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:leading-relaxed [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
