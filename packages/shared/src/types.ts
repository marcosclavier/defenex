import { z } from "zod";

export const FindingCategory = z.enum([
  "COUNTERFEIT",
  "PHISHING",
  "DOMAIN_SQUAT",
  "IMPERSONATION",
  "UNAUTHORIZED_RESALE",
  "TRADEMARK_MISUSE",
  "PIRACY",
  "LEGITIMATE",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Industry = z.enum([
  "fashion",
  "electronics",
  "software",
  "cosmetics",
  "supplements",
  "generic",
]);
export type Industry = z.infer<typeof Industry>;

export const ScanStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "partial",
]);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const FindingStatus = z.enum([
  "new",
  "confirmed",
  "dismissed",
  "actioned",
  "removed",
  "reappeared",
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Categories that represent an actual threat. LEGITIMATE is suppressed from reports. */
export const THREAT_CATEGORIES = FindingCategory.options.filter(
  (c) => c !== "LEGITIMATE",
) as Exclude<FindingCategory, "LEGITIMATE">[];

/** Input for a scan, validated at every boundary (CLI, API, queue). */
export const ScanInput = z.object({
  brand: z.string().min(2).max(100),
  domain: z
    .string()
    .min(4)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "must be a bare domain, e.g. acme.com"),
  industry: Industry.default("generic"),
  aliases: z.array(z.string().min(2).max(100)).max(10).default([]),
  /** Domains the brand authorizes — excluded before classification. */
  allowlistDomains: z.array(z.string()).max(50).default([]),
  queryBudget: z.number().int().min(1).max(50).optional(),
});
export type ScanInput = z.infer<typeof ScanInput>;

/**
 * Where a hit sat on the results page. Paid ads and shopping listings carry
 * different weight from organic results: an ad bidding on the brand name is
 * trademark misuse, and a product listing is a live commercial offer.
 */
export type SearchResultType = "organic" | "paid" | "product";

/** One raw search hit, before enrichment or classification. */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  displayLink: string;
  /** Which generated query surfaced this, for debugging query packs. */
  sourceQuery: string;
  resultType?: SearchResultType;
  /** 1-indexed SERP position. Rank is a proxy for reach. */
  position?: number;
  /** Google's own "potentially malicious" flag — a direct phishing signal. */
  flaggedMalicious?: boolean;
  /** Present on shopping/product results. */
  price?: string;
}

/**
 * How a page's content was obtained. Only the browser path yields a screenshot,
 * and screenshots are the visual evidence a takedown notice needs — so this is
 * recorded per finding rather than assumed.
 */
export type EvidenceSource = "browser" | "stealth";

/** A search hit after we fetched the real page. */
export interface EnrichedResult extends SearchResult {
  finalUrl: string;
  httpStatus: number;
  pageTitle: string | null;
  pageText: string | null;
  screenshot: Buffer | null;
  fetchError: string | null;
  evidenceSource: EvidenceSource | null;
}

/** The classifier's verdict on one result. */
export interface Classification {
  category: FindingCategory;
  confidence: Confidence;
  /** Must appear verbatim in the source text — verified, not trusted. */
  evidenceQuote: string;
  reasoning: string;
}

export interface Finding {
  url: string;
  domain: string;
  title: string;
  category: FindingCategory;
  confidence: Confidence;
  severity: number;
  evidenceQuote: string;
  reasoning: string;
  sourceQuery: string;
  screenshot: Buffer | null;
  evidenceSource: EvidenceSource | null;
}

/**
 * Why a fetched page ended up with no category.
 *
 * A missing verdict used to be reported as `NOT_CLASSIFIED` and nothing else,
 * which put four unrelated events under one label: a page we never fetched, a
 * page the model silently skipped, a verdict whose quote could not be verified,
 * and a whole batch lost to an API error. The first is expected, the last is an
 * outage. Telling them apart is the difference between "the model looked and
 * found nothing" and "we never asked".
 */
export type ClassifyStatus =
  | "classified"
  /** No text to send — the fetch failed or the page rendered to nothing. */
  | "not_fetched"
  /** Sent, the batch came back, and the model did not mention this page. */
  | "model_omitted"
  /** The model answered and its quote failed verification. */
  | "evidence_rejected"
  /** The batch this page was in was dropped after its retries. */
  | "batch_failed";

/** Per-page trace of what the pipeline did. Essential for tuning precision. */
export interface PageDiagnostic {
  url: string;
  prior: number;
  evidenceSource: EvidenceSource | null;
  textChars: number;
  httpStatus: number;
  fetchError: string | null;
  category: FindingCategory | "NOT_CLASSIFIED";
  /** Present on every row: `classified`, or the reason there is no category. */
  classifyStatus: ClassifyStatus;
  /** The rejected verdict and the rule it failed, or the batch's error. */
  classifyDetail?: string;
  confidence: Confidence | null;
}

export interface ScanResult {
  input: ScanInput;
  findings: Finding[];
  diagnostics: PageDiagnostic[];
  stats: {
    queriesRun: number;
    queriesPlanned: number;
    /**
     * Queries the provider could not answer. Non-zero means the scan covered
     * less ground than it planned to, which the report has to say rather than
     * present a short list of findings as a complete one.
     */
    queriesFailed: number;
    /**
     * Which provider actually answered. A fallback covers less ground and
     * scores without signals the primary supplies, so "why did this scan find
     * three things" should be answerable from the record a month later.
     */
    searchProvider: string;
    resultsSeen: number;
    resultsAfterAllowlist: number;
    resultsEnriched: number;
    fetchFailures: number;
    stealthCallsUsed: number;
    findingsPublished: number;
    rejectedForBadEvidence: number;
    /**
     * Pages sent to the classifier that came back with no verdict at all. The
     * model omits entries from a batch fairly often, and every omission is a
     * candidate that was fetched and paid for and then never judged.
     */
    classifierOmitted: number;
    /**
     * Pages lost because the whole batch they were in was dropped after its
     * retries. One schema mismatch or one 500 costs up to `batchSize`
     * candidates at once — a quarter of a default scan — and used to be
     * indistinguishable from ten pages judged legitimate.
     */
    classifierBatchFailures: number;
    searchCostMicros: number;
    stealthCostMicros: number;
    costMicros: number;
    durationMs: number;
    categoryCounts: Record<string, number>;
  };
}
