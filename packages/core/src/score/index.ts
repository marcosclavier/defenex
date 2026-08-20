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
 * Hosts handing out free subdomains, where a brand-named host is a lookalike
 * far more often than it is a company that happens to share the word.
 *
 * Used to keep the credential-harvest bonus reachable for a phishing page whose
 * hostname carries no auth vocabulary of its own.
 */
const DISPOSABLE_HOST =
  /(^|\.)(webflow\.io|weebly\.com|wixsite\.com|github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com|glitch\.me|repl\.co|blogspot\.com|square\.site|myshopify\.com|000webhostapp\.com|godaddysites\.com)$/i;

/**
 * Writing *about* counterfeiting, rather than committing it.
 *
 * These pages are the reason "fake" and "replica" are weak signals on their
 * own: a forum thread titled "Fake Yeti Mugs", a news post about the brand
 * suing counterfeiters and a video comparing a real cooler to a fake all score
 * as though they were listings. On a live YETI scan nine of the forty fetched
 * pages were this, every one classified LEGITIMATE — the single largest block
 * of wasted budget after the login pages below.
 *
 * Deliberately literal. Anything looser ("review", "unboxing") matches the
 * customer-review furniture on real marketplace listings.
 */
const COMMENTARY =
  /\b(how to (spot|tell|know|identify|avoid)|real vs\.? fake|fake vs\.? real|vs\.? (a )?fake|spot(ting)? (a )?fake|is (it|my|this) .{0,24}\b(real|fake)|difference between|we tested|is accusing|lawsuit|sues|sued|crackdown|seiz(ed|ure)|scam warning|beware)\b/i;

/**
 * A URL path as prose, so the phrasing above can be matched against it.
 *
 * `decodeURIComponent` throws on a malformed escape, and this runs inside the
 * scoring loop over every search result — a single stray `%` in one URL out of
 * five hundred would take down the whole scan from the cheapest function in the
 * pipeline. Undecoded is a fine answer.
 */
function readablePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* leave it encoded */
  }
  return decoded.replace(/[-_+]/g, " ");
}

/** Discussion surfaces: people talking about a brand, not trading on it. */
const DISCUSSION_HOST = /^community\./i;
const DISCUSSION_PATH = /\/(t5|forums?|topic|thread|discussions?|discover|questions?)\//i;
const DISCUSSION_SITES = new Set([
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "sitejabber.com",
]);

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
  //
  // `product` and `paid` are worth what they say, but measure how often they
  // arrive before relying on them: across 531 live candidates on both vendors,
  // every single result came back `organic`. Carousels and ad blocks are not
  // returned for `site:`-scoped queries or ones carrying `-site:`, which is
  // what the planner emits almost exclusively. These bonuses are therefore
  // close to dead in practice — kept because they cost nothing and do fire on
  // the unscoped queries, but not something to design the ranking around.
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
  //
  // The auth signal must appear in the *hostname*, not merely in the path.
  // Matching the path made the bonus fire on any company whose name happens to
  // contain the brand as a substring, and one-word brands have a lot of those:
  // a YETI scan spent eight of its forty fetch slots on the login pages of
  // yetiairlines.com, yeticycles.com, checkyeti.com, importyeti.com,
  // yetisoftware.com, yetiacademy.com and jobs.yetitowork.com, none of them
  // related to the brand and every one classified LEGITIMATE. `/login` is
  // ordinary furniture on a real company's site; `yeti-login.` as a hostname is
  // not. The exception is a free-subdomain host, where the lookalike does not
  // need to encode the word because the domain was never the brand's to begin
  // with.
  const looksLikeCredentialHarvest =
    hostHasBrand &&
    (AUTH_SIGNALS.test(host) ||
      (DISPOSABLE_HOST.test(host) && (AUTH_SIGNALS.test(path) || AUTH_SIGNALS.test(haystack))));

  if (looksLikeCredentialHarvest) {
    score += 35;
  } else {
    // Brand token alone selects first-party sites, so it needs corroboration.
    if (hostHasBrand && hits > 0) score += 10;
    if (BENIGN_PATH.test(path)) score -= 30;
  }

  // Commentary about infringement outranks the infringement itself, because it
  // uses the same vocabulary far more explicitly than a seller ever would: a
  // listing says "replica" once, an article about replicas says it in the
  // title. Subtract at least what that vocabulary earned above, so a page that
  // only discusses counterfeiting cannot outrank one that commits it.
  const isDiscussion =
    DISCUSSION_HOST.test(host) ||
    DISCUSSION_PATH.test(path) ||
    DISCUSSION_SITES.has(rootHost(result.url));
  if (isDiscussion) score -= 25;
  if (COMMENTARY.test(haystack) || COMMENTARY.test(readablePath(path))) {
    score -= 30;
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
