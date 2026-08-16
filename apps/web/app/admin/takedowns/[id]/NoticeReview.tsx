"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The point at which a draft becomes a document someone is answerable for.
 *
 * The text is editable because the reviewer must be free to disagree with it.
 * That freedom is exactly why the worker re-validates the edited body against
 * every element the notice type requires — deleting a sworn clause along with a
 * sentence you disliked is an easy mistake, and it is refused here rather than
 * discovered by a recipient.
 */
export function NoticeReview({
  takedownId,
  status,
  subject,
  body,
  hasEvidence,
  submittedTo,
  approverName,
}: {
  takedownId: string;
  status: string;
  subject: string | null;
  body: string | null;
  hasEvidence: boolean;
  submittedTo: string | null;
  approverName: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(body ?? "");
  const [reason, setReason] = useState("");
  const [filedTo, setFiledTo] = useState(submittedTo ?? "");
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const decidable = status === "pending_approval";
  const awaitingFiling = status === "awaiting_filing";

  async function decide(approve: boolean) {
    if (!approve && reason.trim().length < 3) {
      setError("Say why. It goes on the record.");
      return;
    }
    setPending(true);
    setError(null);
    setProblems([]);

    const res = await fetch(`/api/admin/takedowns/${takedownId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        approve ? { approve: true, noticeBody: text } : { approve: false, reason: reason.trim() },
      ),
    }).catch(() => null);

    const payload = await res?.json().catch(() => null);
    setPending(false);

    if (res?.status === 422) {
      // The edited notice lost something it is required to contain.
      setProblems(payload?.problems ?? ["The notice is incomplete."]);
      return;
    }
    if (!res?.ok) {
      setError("That did not go through.");
      return;
    }
    router.refresh();
  }

  async function markFiled() {
    if (filedTo.trim().length < 3) {
      setError("Record where it went.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/takedowns/${takedownId}/mark-filed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submittedTo: filedTo.trim() }),
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      setError("That did not go through.");
      return;
    }
    router.refresh();
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="mt-10">
      <h2 className="t-h3">The notice</h2>

      {subject && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="t-data flex-1 text-ink">{subject}</p>
          <button
            onClick={() => copy("subject", subject)}
            className="border border-line px-2.5 py-1 font-mono text-xs text-ink-dim transition-colors hover:border-line-strong"
          >
            {copied === "subject" ? "copied" : "copy subject"}
          </button>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={26}
        spellCheck={false}
        disabled={!decidable}
        className="mt-4 w-full border border-line bg-surface px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink transition-colors hover:border-line-strong disabled:opacity-70"
      />

      <p className="t-small mt-2 text-ink-mute">
        Signed as {approverName} on approval. The statements in this notice become yours.
      </p>

      {problems.length > 0 && (
        <div className="mt-4 border-l-2 border-critical pl-4">
          <p className="t-eyebrow text-critical">Cannot be approved as written</p>
          <ul className="t-small mt-2 space-y-1 text-ink-dim">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {decidable && (
        <div className="mt-6 space-y-4">
          {!hasEvidence && (
            <p className="t-small border-l-2 border-critical pl-4 text-ink-dim">
              There is no preserved evidence for this finding. Approving it would file a notice
              about a page nobody can show.
            </p>
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason, if declining"
            className="w-full border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
          />
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => decide(true)}
              disabled={pending}
              className="bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
            >
              {pending ? "…" : "Approve and sign"}
            </button>
            <button
              onClick={() => decide(false)}
              disabled={pending}
              className="border border-line-strong px-4 py-2.5 text-sm transition-colors hover:border-paper disabled:opacity-50"
            >
              Decline
            </button>
          </div>
          <p className="t-small text-ink-mute">Declining costs the customer nothing.</p>
        </div>
      )}

      {awaitingFiling && (
        <div className="mt-8 border-t border-line pt-6">
          <h3 className="t-h3">File it</h3>
          <p className="t-small measure mt-2 text-ink-dim">
            This channel is a portal, so it goes in by hand. Copy the notice, submit it on the
            platform&rsquo;s form, then record that it went — that is when the customer&rsquo;s
            enforcement is counted, not before.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => copy("body", text)}
              className="border border-line-strong px-4 py-2.5 text-sm transition-colors hover:border-paper"
            >
              {copied === "body" ? "Copied" : "Copy notice"}
            </button>
            {submittedTo?.startsWith("http") && (
              <a
                href={submittedTo}
                target="_blank"
                rel="noreferrer noopener"
                className="border border-line-strong px-4 py-2.5 text-sm transition-colors hover:border-paper"
              >
                Open the form
              </a>
            )}
          </div>
          <input
            value={filedTo}
            onChange={(e) => setFiledTo(e.target.value)}
            placeholder="Where it was filed"
            className="mt-4 w-full border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
          />
          <button
            onClick={markFiled}
            disabled={pending}
            className="mt-4 bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
          >
            {pending ? "…" : "Mark as filed"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-critical">{error}</p>}
    </section>
  );
}
