import type { ScanInput, SearchResult } from "@defenex/shared";

/**
 * Domains that are never brand infringement. Filtering these before the
 * classifier runs is the cheapest precision win available: it costs nothing
 * and removes the most common false-positive class (the brand's own pages,
 * press coverage, reference sites).
 *
 * Deliberately conservative. Marketplaces are NOT here — eBay and Etsy host
 * both legitimate resale and counterfeits, so they must be classified, not
 * assumed innocent.
 */
const NEVER_FLAG = new Set([
  "wikipedia.org",
  "wikimedia.org",
  "crunchbase.com",
  "bloomberg.com",
  "reuters.com",
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "forbes.com",
  "techcrunch.com",
  "theguardian.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "apnews.com",
  "linkedin.com",
  "glassdoor.com",
  "indeed.com",
  "trustpilot.com",
  "bbb.org",
  "sec.gov",
  "uspto.gov",
  "europa.eu",
  "archive.org",
  "google.com",
  "youtube.com",
]);

/** Strip protocol, port, www., and lowercase. Returns "" for unparseable input. */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    return "";
  }
  host = host.split(":")[0] ?? "";
  return host.replace(/^www\./, "").replace(/\.$/, "");
}

/** True when `host` is `base` or a subdomain of it. */
export function isSameOrSubdomain(host: string, base: string): boolean {
  if (!host || !base) return false;
  return host === base || host.endsWith(`.${base}`);
}

export interface AllowlistDecision {
  kept: SearchResult[];
  dropped: Array<{ result: SearchResult; reason: string }>;
}

/**
 * Remove results that cannot be infringement before spending classifier tokens.
 *
 * Order matters only for the reason label; every rule is independent.
 */
export function applyAllowlist(results: SearchResult[], input: ScanInput): AllowlistDecision {
  const brandDomain = normalizeDomain(input.domain);
  const allowed = input.allowlistDomains.map(normalizeDomain).filter(Boolean);

  const kept: SearchResult[] = [];
  const dropped: AllowlistDecision["dropped"] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const host = normalizeDomain(result.url);

    if (!host) {
      dropped.push({ result, reason: "unparseable_url" });
      continue;
    }
    // Deduplicate across queries — the same listing surfaces from several.
    if (seen.has(result.url)) {
      dropped.push({ result, reason: "duplicate_url" });
      continue;
    }
    seen.add(result.url);

    if (isSameOrSubdomain(host, brandDomain)) {
      dropped.push({ result, reason: "first_party" });
      continue;
    }
    if (allowed.some((a) => isSameOrSubdomain(host, a))) {
      dropped.push({ result, reason: "allowlisted" });
      continue;
    }
    if ([...NEVER_FLAG].some((d) => isSameOrSubdomain(host, d))) {
      dropped.push({ result, reason: "reference_site" });
      continue;
    }

    kept.push(result);
  }

  return { kept, dropped };
}

export const __testing = { NEVER_FLAG };
