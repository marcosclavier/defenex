import type { Industry, ScanInput } from "@defenex/shared";

export type QueryKind =
  | "marketplace"
  | "counterfeit_terms"
  | "domain_abuse"
  | "social"
  | "appstore";

export interface PlannedQuery {
  q: string;
  kind: QueryKind;
  /** Lower runs first. When the budget is tight, high numbers get dropped. */
  priority: number;
  /** Geo-target for this query, when regional targeting adds signal. */
  gl?: string;
}

/**
 * Vocabulary that signals infringement, per industry. This is the highest-leverage
 * knob in the whole engine — a fashion brand needs "replica", a SaaS brand needs
 * "license key", and using the wrong pack returns noise.
 */
const INFRINGEMENT_TERMS: Record<Industry, string[]> = {
  fashion: ["replica", "fake", "knockoff", "AAA quality", "dupe", "inspired by"],
  electronics: ["replica", "clone", "counterfeit", "refurbished original", "copy"],
  software: ["crack", "cracked", "nulled", "license key", "keygen", "activation code", "torrent"],
  cosmetics: ["replica", "fake", "dupe", "wholesale authentic", "tester"],
  supplements: ["counterfeit", "fake", "wholesale", "bulk authentic", "grey market"],
  generic: ["replica", "fake", "knockoff", "counterfeit", "unauthorized"],
};

/** Marketplaces worth a targeted site: query, by industry. */
const MARKETPLACES: Record<Industry, string[]> = {
  fashion: ["dhgate.com", "aliexpress.com", "etsy.com", "ebay.com", "poshmark.com"],
  electronics: ["aliexpress.com", "alibaba.com", "ebay.com", "dhgate.com", "wish.com"],
  software: ["github.com", "sourceforge.net", "telegram.me", "t.me"],
  cosmetics: ["dhgate.com", "aliexpress.com", "ebay.com", "alibaba.com"],
  supplements: ["alibaba.com", "ebay.com", "aliexpress.com"],
  generic: ["aliexpress.com", "alibaba.com", "dhgate.com", "ebay.com"],
};

const SOCIAL_PLATFORMS = [
  "facebook.com",
  "instagram.com",
  "t.me",
  "x.com",
  "tiktok.com",
];

const APP_STORES = ["play.google.com", "apps.apple.com"];

/** Regional geo-targets. The same query in a different locale surfaces different sites. */
const GEO_TARGETS = ["cn", "ru", "tr"];

function quote(term: string): string {
  // Google treats a bare double quote as a phrase delimiter; strip any the
  // brand name contains rather than emitting a malformed query.
  return `"${term.replace(/"/g, "")}"`;
}

/**
 * Build a deterministic, priority-ordered query plan for a brand.
 *
 * Every query excludes the brand's own domain — first-party pages are the single
 * largest source of noise, and filtering them at the search layer is free,
 * whereas filtering them later costs a classifier call.
 */
export function buildQueries(input: ScanInput, budget: number): PlannedQuery[] {
  const { brand, domain, industry } = input;
  const b = quote(brand);
  const exclude = `-site:${domain}`;
  const terms = INFRINGEMENT_TERMS[industry];
  const markets = MARKETPLACES[industry];
  const planned: PlannedQuery[] = [];

  // 1. Marketplace listings — highest yield and most actionable (removable).
  markets.forEach((site, i) => {
    planned.push({ q: `site:${site} ${b}`, kind: "marketplace", priority: 10 + i });
  });

  // 2. Infringement vocabulary, in OR groups of three to conserve queries.
  for (let i = 0; i < terms.length; i += 3) {
    const group = terms.slice(i, i + 3);
    if (group.length === 0) continue;
    planned.push({
      q: `${b} (${group.map((t) => quote(t)).join(" OR ")}) ${exclude}`,
      kind: "counterfeit_terms",
      priority: 20 + i,
    });
  }

  // 3. Cheap-purchase intent — catches gray market and unauthorized resale.
  planned.push({
    q: `${b} (wholesale OR "buy cheap" OR outlet OR clearance) ${exclude}`,
    kind: "counterfeit_terms",
    priority: 30,
  });

  // 4. Domain and brand abuse. The login/verify variant is the phishing signal.
  planned.push({
    q: `${b} "official site" ${exclude}`,
    kind: "domain_abuse",
    priority: 40,
  });
  planned.push({
    q: `${b} (login OR account OR verify OR support) ${exclude}`,
    kind: "domain_abuse",
    priority: 41,
  });

  // 5. Social impersonation.
  SOCIAL_PLATFORMS.forEach((site, i) => {
    planned.push({ q: `site:${site} ${b}`, kind: "social", priority: 50 + i });
  });

  // 6. Fake mobile apps.
  APP_STORES.forEach((site, i) => {
    planned.push({ q: `site:${site} ${b}`, kind: "appstore", priority: 60 + i });
  });

  // 7. Regional sweeps. A US-geo query buries results that a cn/ru/tr query surfaces.
  GEO_TARGETS.forEach((gl, i) => {
    planned.push({
      q: `${b} ${quote(terms[0] ?? "replica")} ${exclude}`,
      kind: "counterfeit_terms",
      priority: 70 + i,
      gl,
    });
  });

  // 8. Aliases get one marketplace sweep each — misspellings are common in listings.
  input.aliases.forEach((alias, i) => {
    planned.push({
      q: `${quote(alias)} (${terms.slice(0, 2).map((t) => quote(t)).join(" OR ")}) ${exclude}`,
      kind: "counterfeit_terms",
      priority: 80 + i,
    });
  });

  return planned.sort((a, b2) => a.priority - b2.priority).slice(0, budget);
}

export const __testing = { INFRINGEMENT_TERMS, MARKETPLACES, quote };
