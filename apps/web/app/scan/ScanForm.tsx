"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const INDUSTRIES = [
  ["generic", "Other / mixed"],
  ["fashion", "Apparel & accessories"],
  ["electronics", "Electronics & hardware"],
  ["cosmetics", "Beauty & cosmetics"],
  ["supplements", "Supplements & wellness"],
  ["software", "Software & digital"],
] as const;

export function ScanForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setFormError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();

      if (!res.ok) {
        if (body.fields) setFields(body.fields);
        else setFormError(body.message ?? "We could not start that scan. Try again in a moment.");
        setPending(false);
        return;
      }
      router.push(`/scan/${body.scanId}`);
    } catch {
      setFormError("We could not reach the scanner. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 space-y-6" noValidate>
      <Field
        name="brand"
        label="Brand name"
        hint="Exactly as it appears on your products."
        placeholder="Acme Tools"
        error={fields.brand}
        required
      />
      <Field
        name="domain"
        label="Official domain"
        hint="Used to rule out your own pages. Paste a URL if easier."
        placeholder="acmetools.com"
        error={fields.domain}
        required
        mono
      />

      <div className="space-y-2">
        <label htmlFor="industry" className="block text-sm font-medium">Industry</label>
        <p className="t-small text-ink-mute">
          Selects the vocabulary we search for. Counterfeiters of apparel and of software
          advertise with completely different words.
        </p>
        <select
          id="industry"
          name="industry"
          defaultValue="generic"
          className="w-full border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors hover:border-line-strong"
        >
          {INDUSTRIES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <Field
        name="email"
        type="email"
        label="Where should we send the report?"
        hint="Optional. Results appear on screen either way."
        placeholder="you@acmetools.com"
        error={fields.email}
      />

      {formError && (
        <p role="alert" className="border-l-2 border-critical pl-3 text-sm text-ink-dim">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-paper px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-paper-dim disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Starting scan…" : "Start scan"}
      </button>
    </form>
  );
}

function Field({
  name, label, hint, placeholder, error, required, type = "text", mono,
}: {
  name: string; label: string; hint?: string; placeholder?: string;
  error?: string; required?: boolean; type?: string; mono?: boolean;
}) {
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(" ");
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {!required && <span className="ml-2 text-ink-mute">optional</span>}
      </label>
      {hint && <p id={`${name}-hint`} className="t-small text-ink-mute">{hint}</p>}
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`w-full border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute transition-colors hover:border-line-strong ${
          mono ? "font-mono" : ""
        } ${error ? "border-critical" : "border-line"}`}
      />
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm text-critical">{error}</p>
      )}
    </div>
  );
}
