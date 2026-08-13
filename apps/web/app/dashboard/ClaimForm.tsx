"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClaimForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const res = await fetch("/api/brands/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain }),
    }).catch(() => null);

    const body = await res?.json().catch(() => null);
    setPending(false);

    if (res?.ok) {
      setMessage({ tone: "ok", text: `${body.brand.name} is now on your account.` });
      setDomain("");
      router.refresh();
      return;
    }
    setMessage({
      tone: "error",
      text:
        body?.error === "already_claimed"
          ? "That brand is already on another account. Contact support if it should be yours."
          : body?.error === "not_found"
            ? "We have not scanned that domain yet. Run a scan first."
            : "We could not claim that brand. Try again in a moment.",
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-wrap items-start gap-3">
      <input
        aria-label="Brand domain"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="acmetools.com"
        required
        className="min-w-56 flex-1 border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
      />
      <button
        type="submit"
        disabled={pending}
        className="border border-line-strong px-4 py-2.5 text-sm transition-colors hover:border-paper disabled:opacity-50"
      >
        {pending ? "Claiming…" : "Claim"}
      </button>
      {message && (
        <p
          role="status"
          className={`w-full text-sm ${message.tone === "error" ? "text-critical" : "text-ink-dim"}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
