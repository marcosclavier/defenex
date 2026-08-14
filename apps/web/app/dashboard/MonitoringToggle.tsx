"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MonitoringToggle({
  brandId, paused, plan,
}: { brandId: string; paused: boolean; plan: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  if (plan === "free") {
    return <span className="font-mono text-xs text-ink-mute">monitoring off · free plan</span>;
  }

  async function toggle() {
    setPending(true);
    setError(false);
    const res = await fetch(`/api/brands/${brandId}/monitoring`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: !paused }),
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) { setError(true); return; }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-ink-mute">
        {paused ? "monitoring paused" : plan === "monitor" ? "rescans weekly" : "rescans daily"}
      </span>
      <button
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={!paused}
        className="border border-line px-2.5 py-1 font-mono text-xs text-ink-dim transition-colors hover:border-line-strong disabled:opacity-50"
      >
        {pending ? "…" : paused ? "Resume" : "Pause"}
      </button>
      {error && <span className="text-xs text-critical">Could not update</span>}
    </div>
  );
}
