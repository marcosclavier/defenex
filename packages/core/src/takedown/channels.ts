import type { FindingCategory } from "@defenex/shared";
import { normalizeDomain } from "../enrich/allowlist.js";

/**
 * Where a notice goes, and under which body of law.
 *
 * These are two independent questions and conflating them is the most common
 * way an enforcement programme gets an account banned. The *route* follows from
 * the domain: a marketplace has its own IP portal and ignores anything sent
 * elsewhere. The *legal frame* follows from the category: the DMCA is copyright
 * law, and a counterfeit cooler is a trademark matter with no §512 hook at all.
 */

export type NoticeKind = "trademark" | "copyright" | "phishing_abuse";

export type TakedownChannel =
  | "amazon"
  | "ebay_vero"
  | "alibaba_ipp"
  | "dhgate"
  | "etsy"
  | "shopify"
  | "meta"
  | "tiktok"
  | "google_delist"
  /**
   * Named for the recipient, not for the DMCA. Most of what we file with a host
   * is a trademark complaint, and labelling the audit record "dmca_host" would
   * misdescribe the majority of it.
   */
  | "host_abuse"
  | "registrar_abuse"
  /** Nothing routable was found; an admin decides. */
  | "manual";

export type SubmissionMethod = "portal" | "email";

export interface ChannelRoute {
  channel: TakedownChannel;
  platform: string;
  method: SubmissionMethod;
  /** Portal URL or abuse mailbox. Null when the route is known but the address is not. */
  destination: string | null;
}

export interface ChannelDecision extends ChannelRoute {
  noticeKind: NoticeKind;
  /** Further routes worth filing, in the order they should be tried. */
  alternatives: ChannelRoute[];
  /** Shown to the approving admin: why here and not somewhere else. */
  rationale: string;
  /** Reasons this cannot be filed as-is. Non-empty means it needs a human first. */
  blockers: string[];
}

/**
 * The legal frame. Getting this wrong is not a formatting error: a DMCA notice
 * swears, under penalty of perjury, that the sender is authorised to act for
 * the owner of *an exclusive right under copyright*. Swearing that over a
 * trademark claim is a false statement made under oath, and §512(f) is written
 * for exactly that.
 */
export function noticeKindFor(category: FindingCategory): NoticeKind {
  switch (category) {
    case "PIRACY":
      return "copyright";
    case "PHISHING":
      return "phishing_abuse";
    default:
      // COUNTERFEIT, TRADEMARK_MISUSE, IMPERSONATION, DOMAIN_SQUAT,
      // UNAUTHORIZED_RESALE — all trademark, none of them DMCA.
      return "trademark";
  }
}

interface Platform {
  channel: TakedownChannel;
  name: string;
  /** Matched against the registrable domain and any subdomain of it. */
  domains: string[];
  portal: string;
  /** Notice kinds this portal accepts; anything else has to go elsewhere. */
  accepts: NoticeKind[];
  note?: string;
}

/**
 * Portals for the platforms our findings actually land on. Every one of these
 * requires submission through its own form — mailing a notice to the company's
 * general abuse address gets it discarded.
 */
const PLATFORMS: Platform[] = [
  {
    channel: "amazon",
    name: "Amazon Brand Registry / Report Infringement",
    domains: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de", "amazon.fr", "amazon.co.jp", "amazon.com.au", "amazon.in", "amazon.it", "amazon.es", "amazon.com.mx", "amazon.com.br"],
    portal: "https://www.amazon.com/report/infringement",
    accepts: ["trademark", "copyright"],
    note: "Requires the ASIN. Repeated inaccurate reports cost Brand Registry access.",
  },
  {
    channel: "ebay_vero",
    name: "eBay VeRO",
    domains: ["ebay.com", "ebay.co.uk", "ebay.ca", "ebay.de", "ebay.com.au", "ebay.fr", "ebay.it", "ebay.es"],
    portal: "https://www.ebay.com/sellercenter/protections/vero-program",
    accepts: ["trademark", "copyright"],
    note: "VeRO requires enrolment before the first notice; a Notice of Claimed Infringement is filed per item number.",
  },
  {
    channel: "alibaba_ipp",
    name: "Alibaba IP Protection Platform",
    domains: ["alibaba.com", "aliexpress.com", "aliexpress.us", "1688.com", "taobao.com", "tmall.com", "lazada.com"],
    portal: "https://ipp.alibabagroup.com",
    accepts: ["trademark", "copyright"],
    note: "IPP requires a verified rights holder account; registration takes days, so enrol before the first filing.",
  },
  {
    channel: "dhgate",
    name: "DHgate IPR Complaint",
    domains: ["dhgate.com"],
    portal: "https://www.dhgate.com/contact/ipr.html",
    accepts: ["trademark", "copyright"],
    note: "DHgate blocks automated access, so evidence for these listings usually has to be captured by hand.",
  },
  {
    channel: "etsy",
    name: "Etsy Intellectual Property Policy",
    domains: ["etsy.com"],
    portal: "https://www.etsy.com/legal/ip",
    accepts: ["trademark", "copyright"],
  },
  {
    channel: "shopify",
    name: "Shopify IP Complaint",
    domains: ["myshopify.com", "shopify.com"],
    portal: "https://www.shopify.com/legal/ip-complaint",
    accepts: ["trademark", "copyright"],
    note: "Only reaches shops on the myshopify.com subdomain; a shop on its own domain is a host matter.",
  },
  {
    channel: "meta",
    name: "Meta IP Reporting",
    domains: ["facebook.com", "fb.com", "instagram.com", "messenger.com", "threads.net"],
    portal: "https://www.facebook.com/help/contact/1758255661104383",
    accepts: ["trademark", "copyright", "phishing_abuse"],
  },
  {
    channel: "tiktok",
    name: "TikTok IP Reporting",
    domains: ["tiktok.com"],
    portal: "https://www.tiktok.com/legal/report/IP",
    accepts: ["trademark", "copyright"],
  },
];

/** Search results are delisted separately from the page being removed. */
const GOOGLE_DELIST: Record<NoticeKind, string> = {
  copyright: "https://reportcontent.google.com/forms/dmca_search",
  trademark: "https://support.google.com/legal/troubleshooter/1114905",
  phishing_abuse: "https://safebrowsing.google.com/safebrowsing/report_phish/",
};

function platformFor(domain: string): Platform | null {
  const host = normalizeDomain(domain) || domain.toLowerCase();
  for (const platform of PLATFORMS) {
    if (platform.domains.some((d) => host === d || host.endsWith(`.${d}`))) return platform;
  }
  return null;
}

export interface ResolveChannelInput {
  /** Finding URL or domain. */
  url: string;
  category: FindingCategory;
  /** From the evidence bundle's RDAP capture. */
  registrarAbuseEmail?: string | null;
  registrarName?: string | null;
  hostAbuseEmail?: string | null;
  hostOperator?: string | null;
}

export function resolveChannel(input: ResolveChannelInput): ChannelDecision {
  const noticeKind = noticeKindFor(input.category);
  const platform = platformFor(input.url);

  const registrar: ChannelRoute | null = input.registrarAbuseEmail
    ? {
        channel: "registrar_abuse",
        platform: input.registrarName ?? "Domain registrar",
        method: "email",
        destination: input.registrarAbuseEmail,
      }
    : null;

  const host: ChannelRoute | null = input.hostAbuseEmail
    ? {
        channel: "host_abuse",
        platform: input.hostOperator ?? "Hosting provider",
        method: "email",
        destination: input.hostAbuseEmail,
      }
    : null;

  const delist: ChannelRoute = {
    channel: "google_delist",
    platform: "Google Search removal",
    method: "portal",
    destination: GOOGLE_DELIST[noticeKind],
  };

  // A marketplace listing goes to the marketplace. Its host is a datacentre
  // that will not touch one product page, and its registrar can only suspend
  // the whole of amazon.com.
  if (platform) {
    const blockers = platform.accepts.includes(noticeKind)
      ? []
      : [`${platform.name} does not accept ${noticeKind.replace("_", " ")} reports through this route`];

    return {
      channel: platform.channel,
      platform: platform.name,
      method: "portal",
      destination: platform.portal,
      noticeKind,
      alternatives: [delist],
      rationale: [
        `${platform.name} operates the listing and is the only party that can remove it.`,
        platform.note,
      ]
        .filter(Boolean)
        .join(" "),
      blockers,
    };
  }

  // A squatted domain is the domain: the registrar is the party with the power
  // to suspend it, and the host merely rents it space.
  const registrarFirst = input.category === "DOMAIN_SQUAT" || input.category === "PHISHING";
  const ordered = registrarFirst ? [registrar, host] : [host, registrar];
  const primary = ordered.find((r): r is ChannelRoute => r !== null);

  if (!primary) {
    return {
      channel: "manual",
      platform: "Unrouted",
      method: "email",
      destination: null,
      noticeKind,
      alternatives: [delist],
      rationale:
        "No platform portal matched and neither the registrar nor the hosting provider published an abuse address in RDAP.",
      blockers: ["no abuse contact found; the recipient has to be identified by hand"],
    };
  }

  const secondary = ordered.filter((r): r is ChannelRoute => r !== null && r !== primary);

  return {
    ...primary,
    noticeKind,
    alternatives: [...secondary, delist],
    rationale: registrarFirst
      ? "The registrar can suspend the domain itself, which is the remedy this category calls for; the host is the fallback."
      : "The hosting provider can remove the page without taking down the whole domain, so it is asked first; the registrar is the escalation.",
    blockers: [],
  };
}

/** Exposed for the admin queue and for tests; not used to route. */
export function knownPlatforms(): ReadonlyArray<{ channel: TakedownChannel; name: string; portal: string }> {
  return PLATFORMS.map((p) => ({ channel: p.channel, name: p.name, portal: p.portal }));
}
