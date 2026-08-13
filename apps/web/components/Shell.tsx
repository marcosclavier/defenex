import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="h-2 w-2 bg-paper" />
          <span className="font-mono text-sm tracking-[0.2em] uppercase">Defenex</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-ink-dim">
          <Link href="/scan" className="transition-colors hover:text-ink">
            Run a scan
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-ink-mute sm:flex-row sm:items-center sm:justify-between">
        <p className="measure">
          Findings describe what a page appears to do. They are not legal conclusions.
        </p>
        <nav className="flex gap-5">
          <Link href="/privacy" className="transition-colors hover:text-ink-dim">Privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-ink-dim">Terms</Link>
          <Link href="/acceptable-use" className="transition-colors hover:text-ink-dim">Acceptable use</Link>
        </nav>
      </div>
    </footer>
  );
}
