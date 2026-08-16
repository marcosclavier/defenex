"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RightsDecision({ rightsId }: { rightsId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(verified: boolean) {
    // A rejection the owner cannot act on is a support ticket waiting to happen.
    if (!verified && reason.trim().length < 3) {
      setError("Say why, so the customer can fix it.");
      return;
    }
    setPending(true);
    setError(null);

    const res = await fetch(`/api/admin/rights/${rightsId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verified, ...(verified ? {} : { reason: reason.trim() }) }),
    }).catch(() => null);

    setPending(false);
    if (!res?.ok) {
      setError("That did not go through.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason, if rejecting"
        className="w-full border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
      />
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => decide(true)}
          disabled={pending}
          className="bg-paper px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
        >
          {pending ? "…" : "Verify"}
        </button>
        <button
          onClick={() => decide(false)}
          disabled={pending}
          className="border border-line-strong px-4 py-2 text-sm transition-colors hover:border-paper disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </div>
  );
}
