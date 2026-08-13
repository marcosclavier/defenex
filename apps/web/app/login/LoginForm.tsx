"use client";

import { useState } from "react";

export function LoginForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [email, setEmail] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    await fetch("/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    // Always the same outcome, whether or not the address has an account.
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="mt-10 border-l-2 border-paper pl-4">
        <p className="text-sm text-ink">Check your email.</p>
        <p className="t-small mt-2 text-ink-dim">
          If <span className="font-mono">{email}</span> has an account, a sign-in link is on
          its way. It expires in 15 minutes and works once.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@acmetools.com"
          className="w-full border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong"
        />
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="t-small text-ink-mute">
        No password. We email you a link that signs you in.
      </p>
    </form>
  );
}
