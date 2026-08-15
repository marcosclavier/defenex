"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Snapshot {
  markText?: string | null;
  ownerName?: string | null;
  statusText?: string | null;
  isLive?: boolean;
}

export function RightsForm({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [regNumber, setRegNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ snapshot: Snapshot | null; lookupError: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const res = await fetch(`/api/brands/${brandId}/rights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regNumber, jurisdiction }),
    }).catch(() => null);

    const body = await res?.json().catch(() => null);
    setPending(false);

    if (!res?.ok) {
      setError("We could not record that registration. Check the number and try again.");
      return;
    }
    setResult({ snapshot: body.registry ?? null, lookupError: body.lookupError ?? null });
    router.refresh();
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div className="space-y-2">
          <label htmlFor="regNumber" className="block text-sm font-medium">Registration number</label>
          <p className="t-small text-ink-mute">
            The registration number, not the serial number of a pending application. We check it
            against the public register.
          </p>
          <input
            id="regNumber"
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            required
            placeholder="4213456"
            className="w-full border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="jurisdiction" className="block text-sm font-medium">Jurisdiction</label>
          <select
            id="jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="w-full border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors hover:border-line-strong"
          >
            <option value="US">United States (USPTO)</option>
            <option value="EU">European Union (EUIPO)</option>
            <option value="CA">Canada (CIPO)</option>
            <option value="GB">United Kingdom (IPO)</option>
            <option value="WO">International (WIPO)</option>
          </select>
          <p className="t-small text-ink-mute">
            Only US registrations are checked automatically. Others are reviewed by hand.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
        >
          {pending ? "Checking the register…" : "Submit registration"}
        </button>
        {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      </form>

      {result && (
        <div className="mt-8 border border-line bg-surface p-5">
          <p className="t-eyebrow">What the register says</p>
          {result.snapshot ? (
            <dl className="mt-3 space-y-1.5 font-mono text-xs">
              <Row label="mark" value={result.snapshot.markText ?? "—"} />
              <Row label="owner" value={result.snapshot.ownerName ?? "—"} />
              <Row label="status" value={result.snapshot.statusText ?? "—"} />
              <Row
                label="live"
                value={result.snapshot.isLive ? "yes" : "NO — cannot be used to file"}
                tone={result.snapshot.isLive ? undefined : "critical"}
              />
            </dl>
          ) : (
            <p className="t-small mt-2 text-ink-dim">
              {result.lookupError
                ? `Automatic check unavailable (${result.lookupError}). Your submission was recorded and will be reviewed by hand.`
                : "This jurisdiction is reviewed by hand. Your submission was recorded."}
            </p>
          )}
          <p className="t-small mt-4 text-ink-mute">
            Recorded, and now awaiting review. We confirm ownership before filing anything on your
            behalf — the register shows a registration exists, not that it is yours.
          </p>
        </div>
      )}
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "critical" }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-ink-mute">{label}</dt>
      <dd className={tone === "critical" ? "text-critical" : "text-ink"}>{value}</dd>
    </div>
  );
}
