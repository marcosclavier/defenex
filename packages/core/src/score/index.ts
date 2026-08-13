import type { Classification, Confidence, FindingCategory, SearchResult } from "@defenex/shared";
import { normalizeDomain } from "../enrich/allowlist.js";
import type { QueryKind } from "../queries/templates.js";

/**
 * Marketplaces and platforms with a working IP-enforcement channel. Actionability
 * matters commercially: a report full of unremovable findings converts worse than
 * a shorter one of removable ones, so it is scored, not just noted.
 */
const ENFORCEABLE_HOSTS = new Set([
  "amazon.com", "ebay.com", "etsy.com", "aliexpress.com", "alibaba.com",
  "dhgate.com", "wish.com", "poshmark.com", "facebook.com", "instagram.com",
  "tiktok.com", "x.com", "play.google.com", "apps.apple.com", "shopify.com",
]);

/** High-traffic hosts — the same listing reaches far more customers here. */
const HIGH_REACH_HOSTS = new Set([
  "amazon.com", "ebay.com", "aliexpress.com", "alibaba.com", "facebook.com",
  "instagram.com", "tiktok.com", "dhgate.com", "play.google.com", "apps.apple.com",
]);

/** Commercial harm and confusion likelihood, by category. */
const CATEGORY_BASE: Record<FindingCategory, number> = {
  PHISHING: 88,
  COUNTERFEIT: 74,
  IMPERSONATION: 66,
  PIRACY: 62,
  DOMAIN_SQUAT: 55,
  TRADEMARK_MISUSE: 38,
  UNAUTHORIZED_RESALE: 34,
  LEGITIMATE: 0,
};

const CONFIDENCE_FACTOR: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.78,
  low: 0.55,
};

function rootHost(url: string): string {
  const host = normalizeDomain(url);
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

/**
 * Final severity, 0-100. Category sets the band; confidence scales it; reach and
 * actionability adjust within the band.
 */
export function severityFor(classification: Classification, url: string): number {
  if (classification.category === "LEGITIMATE") return 0;

  const host = rootHost(url);
  let score = CATEGORY_BASE[classification.category];
  score *= CONFIDENCE_FACTOR[classification.confidence];

  if (HIGH_REACH_HOSTS.has(host)) score += 8;
  if (ENFORCEABLE_HOSTS.has(host)) score += 5;

  return Math.max(1, Math.min(100, Math.round(score)));
}

/**
 * Cheap pre-classification prior used only to decide which results are worth
 * fetching. No network, no model — it ranks candidates so the fetch budget is
 * spent on the most promising ones first.
 */
export function priorScore(result: SearchResult, kind: QueryKind, brand: string): number {
  let score = 50;

  switch (kind) {
    case "marketplace": score += 25; break;
    case "domain_abuse": score += 20; break;
    case "counterfeit_terms": score += 15; break;
    case "social": score += 10; break;
    case "appstore": score += 10; break;
  }

  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  const signals = ["replica", "fake", "cheap", "wholesale", "outlet", "crack", "keygen", "discount"];
  score += signals.filter((s) => haystack.includes(s)).length * 6;

  // The brand name inside the hostname is a strong squatting/impersonation signal.
  const host = normalizeDomain(result.url);
  const brandToken = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (brandToken.length >= 4 && host.replace(/[^a-z0-9]/g, "").includes(brandToken)) {
    score += 20;
  }

  return score;
}

export const SEVERITY_BANDS = [
  { min: 80, label: "critical" },
  { min: 60, label: "high" },
  { min: 35, label: "medium" },
  { min: 0, label: "low" },
] as const;

export function severityLabel(severity: number): string {
  return SEVERITY_BANDS.find((b) => severity >= b.min)?.label ?? "low";
}
