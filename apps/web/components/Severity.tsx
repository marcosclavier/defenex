const TONE: Record<string, { bar: string; text: string }> = {
  critical: { bar: "bg-critical", text: "text-critical" },
  high: { bar: "bg-high", text: "text-high" },
  medium: { bar: "bg-medium", text: "text-medium" },
  low: { bar: "bg-low", text: "text-low" },
};

/**
 * Severity always carries its label in text.
 *
 * Colour alone would fail colour-blind readers and die entirely in the
 * grayscale PDF print of a report, which is the form a lawyer is most likely
 * to read it in.
 */
export function SeverityChip({ label, score }: { label: string; score: number }) {
  const tone = TONE[label] ?? TONE.low!;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={`h-3 w-[3px] ${tone.bar}`} />
      <span className={`font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${tone.text}`}>
        {label}
      </span>
      <span className="font-mono text-[0.6875rem] tabular-nums text-ink-mute">{score}</span>
    </span>
  );
}

export function SeverityRule({ label }: { label: string }) {
  const tone = TONE[label] ?? TONE.low!;
  return <span aria-hidden className={`absolute left-0 top-0 h-full w-[2px] ${tone.bar}`} />;
}
