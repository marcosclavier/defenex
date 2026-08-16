/**
 * Strips credentials and personal data from anything on its way to Sentry.
 *
 * Kept free of any env dependency so it can be tested directly — importing
 * `sentry.ts` boots the whole worker configuration, and an outbound
 * data-protection control should not be verifiable only by starting the app.
 *
 * Deliberately not the same list pino redacts. Pino matches six known field
 * paths one level deep and misses `RESEND_API_KEY`, the Stripe keys,
 * `DATABASE_URL`, `AUTH_SECRET` and every email address. Sentry receives whole
 * serialised objects — request headers, job payloads, arbitrary properties
 * hanging off a thrown error — so the value has to be walked rather than a
 * fixed set of names trusted.
 */

const SECRET_KEY = /(api[_-]?key|secret|token|password|authorization|cookie|dsn|database_url|redis_url)/i;

/** Credential shapes, wherever they appear inside a string. */
const SECRET_VALUES: RegExp[] = [
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\bwhsec_[A-Za-z0-9]{8,}/g, // Stripe webhook signing
  /\bre_[A-Za-z0-9_-]{10,}/g, // Resend
  /\bpostgres(ql)?:\/\/[^\s"']+/gi,
  /\bredis(s)?:\/\/[^\s"']+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
];

/**
 * Customer addresses are personal data and are never needed to read a stack
 * trace — the user id identifies the account.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MAX_DEPTH = 8;

export function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUES) out = out.replace(pattern, "[redacted]");
  return out.replace(EMAIL, "[email]");
}

export function scrub<T>(value: T, depth = 0): T {
  // Deep nesting is real in serialised errors; bail rather than recurse forever.
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1),
      ]),
    ) as T;
  }
  return value;
}
