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

/** SERP-derived signals that adjust severity beyond what the page text shows. */
export type SerpSignals = Pick<SearchResult, "flaggedMalicious" | "resultType" | "position">;

/**
 * Final severity, 0-100. Category sets the band; confidence scales it; reach,
 * actionability and SERP signals adjust within the band.
 */
export function severityFor(
  classification: Classification,
  url: string,
  signals: SerpSignals = {},
): number {
  if (classification.category === "LEGITIMATE") return 0;

  const host = rootHost(url);
  let score = CATEGORY_BASE[classification.category];
  score *= CONFIDENCE_FACTOR[classification.confidence];

  if (HIGH_REACH_HOSTS.has(host)) score += 8;
  if (ENFORCEABLE_HOSTS.has(host)) score += 5;

  // Google's own malware/phishing flag. Independent corroboration from the
  // platform itself is stronger evidence than anything in the page text.
  if (signals.flaggedMalicious) score += 15;

  // A product carousel entry is a live commercial offer, not just a page
  // mentioning the brand — money is already changing hands.
  if (signals.resultType === "product") score += 7;

  // A paid ad means someone is spending money to rank on the brand's name.
  if (signals.resultType === "paid") score += 5;

  // Rank as a proxy for reach: page-one results reach far more customers.
  if (typeof signals.position === "number" && signals.position <= 10) score += 4;

  return Math.max(1, Math.min(100, Math.round(score)));
}

/**
 * Paths that mean "the brand's own plumbing" rather than a threat: login pages,
 * careers, support, coupons. Cheap to spot and a large share of wasted budget.
 */
const BENIGN_PATH = /\/(login|signin|sign-in|auth|account|careers?|jobs?|contact|support|help|privacy|terms|coupon|customer-service|recruitment|press|about)(\/|$|\?)/i;

/** Credential-harvest vocabulary. On a lookalike host this IS the phishing pattern. */
const AUTH_SIGNALS = /(login|sign-?in|verify|verification|account|password|billing|payment|suspend)/i;

const INFRINGEMENT_SIGNALS = [
  "replica", "fake", "knockoff", "counterfeit", "aaa quality", "dupe",
  "wholesale", "cheap", "outlet", "crack", "keygen", "nulled", "license key",
];

/**
 * Cheap pre-classification prior used only to decide which results are worth
 * fetching. No network, no model — it ranks candidates so the fetch budget is
 * spent on the most promising ones first.
 *
 * Calibration note: an earlier version gave a large bonus for the brand name
 * appearing in the hostname. On a live YETI scan that promoted the brand's own
 * Canadian store, Salesforce portal and careers site over actual counterfeit
 * listings — the brand's own properties have its name in the hostname more
 * reliably than infringers do. The signal is kept but small, and evidence of
 * infringement now dominates.
 */
export function priorScore(result: SearchResult, kind: QueryKind, brand: string): number {
  let score = 30;

  // Signals the SERP already gave us, before we spend anything on this URL.
  if (result.flaggedMalicious) score += 40;
  if (result.resultType === "product") score += 18;
  if (result.resultType === "paid") score += 8;

  switch (kind) {
    case "marketplace": score += 30; break;
    case "domain_abuse": score += 20; break;
    case "counterfeit_terms": score += 18; break;
    case "social": score += 10; break;
    case "appstore": score += 10; break;
  }

  // Evidence of infringement in the text we already have is the strongest
  // cheap predictor that fetching this page will be worth the money.
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  const hits = INFRINGEMENT_SIGNALS.filter((s) => haystack.includes(s)).length;
  score += Math.min(hits, 3) * 12;

  const host = normalizeDomain(result.url);
  if (ENFORCEABLE_HOSTS.has(rootHost(result.url))) score += 22;

  const brandToken = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hostHasBrand =
    brandToken.length >= 4 && host.replace(/[^a-z0-9]/g, "").includes(brandToken);

  let path = "";
  try {
    path = new URL(result.url).pathname;
  } catch {
    /* keep default */
  }

  // A brand-named host asking for credentials is the phishing pattern, and
  // phishing is the highest-severity category we detect. Scored before the
  // benign-path rule so that rule cannot suppress it: an earlier version
  // penalised `/login` uniformly and dropped a real credential-harvesting page
  // (yeti-login.webflow.io) out of the candidate set entirely.
  const looksLikeCredentialHarvest =
    hostHasBrand && (AUTH_SIGNALS.test(path) || AUTH_SIGNALS.test(host) || AUTH_SIGNALS.test(haystack));

  if (looksLikeCredentialHarvest) {
    score += 35;
  } else {
    // Brand token alone selects first-party sites, so it needs corroboration.
    if (hostHasBrand && hits > 0) score += 10;
    if (BENIGN_PATH.test(path)) score -= 30;
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
