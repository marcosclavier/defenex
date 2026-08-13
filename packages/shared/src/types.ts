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

/** Per-page trace of what the pipeline did. Essential for tuning precision. */
export interface PageDiagnostic {
  url: string;
  prior: number;
  evidenceSource: EvidenceSource | null;
  textChars: number;
  httpStatus: number;
  fetchError: string | null;
  category: FindingCategory | "NOT_CLASSIFIED";
  confidence: Confidence | null;
  evidenceRejected?: boolean;
}

export interface ScanResult {
  input: ScanInput;
  findings: Finding[];
  diagnostics: PageDiagnostic[];
  stats: {
    queriesRun: number;
    resultsSeen: number;
    resultsAfterAllowlist: number;
    resultsEnriched: number;
    fetchFailures: number;
    stealthCallsUsed: number;
    findingsPublished: number;
    rejectedForBadEvidence: number;
    searchCostMicros: number;
    stealthCostMicros: number;
    costMicros: number;
    durationMs: number;
    categoryCounts: Record<string, number>;
  };
}
