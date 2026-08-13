"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Status {
  status: "queued" | "running" | "completed" | "failed" | "partial";
  stage: string | null;
  percent: number;
  findingsCount: number;
  resultsSeen: number;
  error: string | null;
  reportToken: string | null;
}

/** Honest stage labels: say what is happening, not a generic spinner. */
function describe(s: Status): string {
  if (s.status === "queued") return "Waiting for a scanner";
  if (s.status === "failed") return "Scan failed";
  if (s.status === "completed" || s.status === "partial") return "Scan complete";
  return s.stage ? s.stage.charAt(0).toUpperCase() + s.stage.slice(1) : "Working";
}

export function Progress({ scanId }: { scanId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let misses = 0;

    async function poll() {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/scan/${scanId}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Status;
        misses = 0;
        setUnreachable(false);
        setStatus(body);

        if ((body.status === "completed" || body.status === "partial") && body.reportToken) {
          stopped.current = true;
          window.location.href = `/r/${body.reportToken}`;
          return;
        }
        // Scan finished but the report job has not written its row yet — keep
        // polling rather than sending the visitor to a 404.
        if (body.status === "failed") {
          stopped.current = true;
          return;
        }
      } catch {
        // A single blip should not look like a failure to the user.
        if (++misses >= 4) setUnreachable(true);
      }
      timer = setTimeout(poll, 2000);
    }

    void poll();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [scanId]);

  const pct = status?.percent ?? 0;
  const done = status?.status === "completed" || status?.status === "partial";
  const failed = status?.status === "failed";

  return (
    <div className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-sm text-ink">{status ? describe(status) : "Starting"}</p>
        <p className="font-mono text-sm tabular-nums text-ink-mute">{pct}%</p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Scan progress"
        className="relative mt-3 h-[3px] w-full overflow-hidden bg-line"
      >
        <div
          className={`h-full transition-[width] duration-700 ease-out ${
            failed ? "bg-critical" : "bg-paper"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
        {!done && !failed && (
          <div aria-hidden className="sweep absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-ink-mute to-transparent opacity-40" />
        )}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px border border-line bg-line">
        <Stat label="Results examined" value={status?.resultsSeen ?? 0} />
        <Stat label="Findings so far" value={status?.findingsCount ?? 0} />
      </dl>

      {unreachable && (
        <p role="status" className="mt-6 border-l-2 border-high pl-3 text-sm text-ink-dim">
          We have lost contact with the scanner. The scan is probably still running — this page
          will pick it up again automatically.
        </p>
      )}

      {failed && (
        <div className="mt-6 border-l-2 border-critical pl-3">
          <p className="text-sm text-ink">This scan did not finish.</p>
          <p className="t-small mt-1 text-ink-dim">
            Nothing was charged and no report was produced.{" "}
            <Link href="/scan" className="underline underline-offset-4 hover:text-ink">
              Try another scan
            </Link>.
          </p>
        </div>
      )}

      {done && (
        <p role="status" className="mt-6 text-sm text-ink-dim">
          Found {status?.findingsCount ?? 0}{" "}
          {status?.findingsCount === 1 ? "finding" : "findings"}. Opening your report…
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-canvas p-4">
      <dt className="t-eyebrow">{label}</dt>
      <dd className="mt-1 font-mono text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
