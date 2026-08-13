"use client";

import { useState } from "react";

export function CheckoutButton({ slug, name }: { slug: string; name: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(cadence: "monthly" | "yearly") {
    setPending(true);
    setError(null);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, cadence }),
    }).catch(() => null);

    if (res?.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/pricing")}`;
      return;
    }
    const body = await res?.json().catch(() => null);
    if (body?.url) {
      window.location.href = body.url;
      return;
    }
    setPending(false);
    setError("We could not start checkout. Try again in a moment.");
  }

  return (
    <div className="mt-6 space-y-2">
      <button
        onClick={() => void start("monthly")}
        disabled={pending}
        className="w-full bg-paper px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
      >
        {pending ? "Starting…" : `Choose ${name}`}
      </button>
      <button
        onClick={() => void start("yearly")}
        disabled={pending}
        className="w-full border border-line px-4 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong disabled:opacity-50"
      >
        Pay yearly
      </button>
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
    </div>
  );
}
