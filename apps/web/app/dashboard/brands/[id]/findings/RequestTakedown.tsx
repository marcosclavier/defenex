"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RequestTakedown({
  findingId,
  disabled,
  brandId,
}: {
  findingId: string;
  disabled: boolean;
  brandId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function request() {
    setPending(true);
    setMessage(null);

    const res = await fetch(`/api/findings/${findingId}/takedown`, { method: "POST" }).catch(
      () => null,
    );
    const body = await res?.json().catch(() => null);
    setPending(false);

    if (res?.ok) {
      router.refresh();
      return;
    }

    // Each refusal is a different thing to do next, so each gets its own words.
    setMessage(
      body?.error === "no_verified_rights"
        ? "Add a verified trademark registration first."
        : body?.error === "allowance_exhausted"
          ? `No enforcements left this period. Further removals are $${body.overageUsd ?? 195} each.`
          : body?.error === "already_requested"
            ? "A removal is already under way for this finding."
            : "We could not start that. Try again shortly.",
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={request}
        disabled={pending || disabled}
        title={disabled ? "Needs a verified trademark registration" : undefined}
        className="border border-line-strong px-4 py-2 text-sm transition-colors hover:border-paper disabled:opacity-40"
      >
        {pending ? "Starting…" : "Request removal"}
      </button>
      {message && (
        <p role="status" className="t-small text-ink-dim">
          {message}{" "}
          {message.startsWith("Add a verified") && (
            <a
              href={`/dashboard/brands/${brandId}/rights`}
              className="underline underline-offset-4 hover:text-ink"
            >
              Add one
            </a>
          )}
        </p>
      )}
    </div>
  );
}
