import { lookup } from "node:dns/promises";
import { silentLogger, type Logger } from "../ports.js";

/**
 * RDAP — the IETF successor to WHOIS. Returns JSON over HTTPS, needs no key or
 * registration, and unlike WHOIS is not rate limited into uselessness.
 *
 * We need two facts a takedown notice cannot be filed without: who the
 * registrar is (so a `dmca_registrar` notice has an addressee) and who runs the
 * network hosting the site (so a `dmca_host` notice does). Both come with an
 * abuse contact published by the operator specifically to receive complaints.
 *
 * `rdap.org` is a bootstrap redirector: it reads the IANA registry and forwards
 * to the authoritative server for the TLD or the RIR for the address block, so
 * one base URL covers every namespace.
 */

const RDAP_BOOTSTRAP = "https://rdap.org";

/**
 * Registries we query directly, skipping the bootstrap hop.
 *
 * `rdap.org` is convenient but is a single redirector in front of every
 * registry on the internet, and it is intermittently slow — measured at 10s for
 * one .com and a hard hang for another, against 0.4s straight to Verisign.
 * Infringing listings live overwhelmingly on these three TLDs, so they get the
 * fast path and everything else falls back to the bootstrap.
 *
 * Deliberately short: a wrong URL here costs a round trip before the fallback,
 * so the list holds only servers worth being sure about.
 */
const DIRECT_REGISTRIES: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1",
  net: "https://rdap.verisign.com/net/v1",
  org: "https://rdap.publicinterestregistry.org/rdap",
};

export class RdapError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RdapError";
  }
}

export interface RdapContact {
  name: string | null;
  email: string | null;
}

export interface RdapDomainRecord {
  domain: string;
  registrar: string | null;
  /** IANA registrar id — the stable identifier; names get rebranded. */
  registrarIanaId: string | null;
  registrarAbuse: RdapContact | null;
  registeredAt: string | null;
  expiresAt: string | null;
  statuses: string[];
  nameservers: string[];
  source: string;
  raw: unknown;
}

export interface RdapIpRecord {
  ip: string;
  /** The allocated block, e.g. "104.16.0.0 - 104.31.255.255". */
  range: string | null;
  networkName: string | null;
  /** Best available name for the operator: the org entity, else the registrant. */
  operator: string | null;
  abuse: RdapContact | null;
  country: string | null;
  source: string;
  raw: unknown;
}

// ------------------------------------------------------------ parsing

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * jCard (RFC 7095) is a positional format: ["vcard", [[name, params, type, value], ...]].
 * The value at index 3 can itself be an array (a structured address), so only
 * plain strings are lifted out.
 */
function vcardField(entity: unknown, field: string): string | null {
  const vcard = (entity as Json | undefined)?.["vcardArray"];
  if (!Array.isArray(vcard) || vcard.length < 2) return null;
  for (const entry of asArray(vcard[1])) {
    if (!Array.isArray(entry) || entry[0] !== field) continue;
    const value = entry[3];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function hasRole(entity: unknown, role: string): boolean {
  return asArray((entity as Json | undefined)?.["roles"]).some(
    (r) => typeof r === "string" && r.toLowerCase() === role,
  );
}

/** Entities nest — the abuse contact hangs off the registrar, not the domain. */
function walkEntities(root: unknown, depth = 0): unknown[] {
  if (depth > 4) return [];
  const out: unknown[] = [];
  for (const entity of asArray((root as Json | undefined)?.["entities"])) {
    out.push(entity, ...walkEntities(entity, depth + 1));
  }
  return out;
}

function contactFrom(entity: unknown): RdapContact | null {
  const name = vcardField(entity, "fn");
  const email = vcardField(entity, "email");
  if (!name && !email) return null;
  return { name, email };
}

function abuseContact(root: unknown): RdapContact | null {
  for (const entity of walkEntities(root)) {
    if (hasRole(entity, "abuse")) {
      const contact = contactFrom(entity);
      if (contact?.email) return contact;
    }
  }
  return null;
}

function eventDate(root: unknown, action: string): string | null {
  for (const event of asArray((root as Json | undefined)?.["events"])) {
    const e = event as Json;
    if (asString(e["eventAction"])?.toLowerCase() === action) return asString(e["eventDate"]);
  }
  return null;
}

export function parseRdapDomain(json: unknown, fallbackDomain: string, source = RDAP_BOOTSTRAP): RdapDomainRecord {
  const root = (json ?? {}) as Json;
  const registrarEntity = walkEntities(root).find((e) => hasRole(e, "registrar")) ?? null;

  const ianaId =
    asArray((registrarEntity as Json | null)?.["publicIds"])
      .map((p) => (p as Json)?.["identifier"])
      .find((v): v is string => typeof v === "string") ??
    asString((registrarEntity as Json | null)?.["handle"]);

  return {
    domain: (asString(root["ldhName"]) ?? fallbackDomain).toLowerCase(),
    registrar: registrarEntity ? vcardField(registrarEntity, "fn") : null,
    registrarIanaId: ianaId ?? null,
    // Prefer the registrar's own abuse desk; fall back to any abuse role on the record.
    registrarAbuse: (registrarEntity && abuseContact(registrarEntity)) ?? abuseContact(root),
    registeredAt: eventDate(root, "registration"),
    expiresAt: eventDate(root, "expiration"),
    statuses: asArray(root["status"]).filter((s): s is string => typeof s === "string"),
    nameservers: asArray(root["nameservers"])
      .map((n) => asString((n as Json)["ldhName"]))
      .filter((n): n is string => Boolean(n))
      .map((n) => n.toLowerCase()),
    source,
    raw: json,
  };
}

export function parseRdapIp(json: unknown, fallbackIp: string, source = RDAP_BOOTSTRAP): RdapIpRecord {
  const root = (json ?? {}) as Json;
  const entities = walkEntities(root);
  const operatorEntity =
    entities.find((e) => hasRole(e, "registrant")) ??
    entities.find((e) => hasRole(e, "administrative")) ??
    entities.find((e) => hasRole(e, "technical")) ??
    entities[0] ??
    null;

  const start = asString(root["startAddress"]);
  const end = asString(root["endAddress"]);

  return {
    ip: fallbackIp,
    range: start && end ? `${start} - ${end}` : start,
    networkName: asString(root["name"]),
    operator: operatorEntity ? vcardField(operatorEntity, "fn") ?? asString((operatorEntity as Json)["handle"]) : null,
    abuse: abuseContact(root),
    country: asString(root["country"]),
    source,
    raw: json,
  };
}

// ------------------------------------------------------------ domain shaping

/**
 * Multi-label public suffixes we are likely to meet. RDAP is queried on the
 * registrable domain, and asking for `shop.example.co.uk` returns 404.
 *
 * This is a shortlist, not the Public Suffix List — pulling in the full PSL for
 * a metadata lookup is not worth the dependency, and a miss degrades to a
 * failed lookup that the notice records as unknown rather than to a wrong
 * answer.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "co.jp", "or.jp", "ne.jp",
  "com.au", "net.au", "org.au", "co.nz", "com.br", "com.cn", "com.hk",
  "com.mx", "com.tr", "com.sg", "com.tw", "co.in", "co.za", "co.kr",
]);

/** `https://shop.example.co.uk/x` → `example.co.uk`. Returns null for an IP or garbage. */
export function registrableDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host || !host.includes(".")) return null;
  // An address literal has no registrable domain; the caller wants the IP path.
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;

  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const want = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < want) return null;
  return labels.slice(-want).join(".");
}

/**
 * Records which IP served the page. Informational only — it is never fetched,
 * so this second resolution is not an SSRF bypass; the guard runs against the
 * URL the browser actually loads.
 */
export async function resolveIpv4(hostname: string): Promise<string | null> {
  try {
    const { address } = await lookup(hostname, { family: 4 });
    return address;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ client

export interface RdapConfig {
  baseUrl?: string;
  timeoutMs?: number;
  logger?: Logger;
}

export class RdapClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly log: Logger;

  constructor(config: RdapConfig = {}) {
    this.baseUrl = (config.baseUrl ?? RDAP_BOOTSTRAP).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.log = config.logger ?? silentLogger;
  }

  private async get(path: string, base = this.baseUrl): Promise<unknown> {
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/rdap+json, application/json" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) throw new RdapError(`rdap ${res.status} for ${path}`, res.status);
      return await res.json();
    } catch (err) {
      if (err instanceof RdapError) throw err;
      throw new RdapError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async lookupDomain(input: string): Promise<RdapDomainRecord> {
    const domain = registrableDomain(input);
    if (!domain) throw new RdapError(`no registrable domain in "${input}"`);
    const path = `/domain/${encodeURIComponent(domain)}`;
    const tld = domain.split(".").pop() ?? "";
    const direct = this.baseUrl === RDAP_BOOTSTRAP ? DIRECT_REGISTRIES[tld] : undefined;
    this.log.info("rdap domain lookup", { domain, via: direct ?? this.baseUrl });

    if (direct) {
      try {
        return parseRdapDomain(await this.get(path, direct), domain, direct);
      } catch (err) {
        // A registry that moved, rate limited us, or is down is exactly what
        // the bootstrap exists for. Fall through rather than fail.
        this.log.warn("direct rdap registry failed; falling back to bootstrap", {
          domain,
          registry: direct,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return parseRdapDomain(await this.get(path), domain, this.baseUrl);
  }

  async lookupIp(ip: string): Promise<RdapIpRecord> {
    this.log.info("rdap ip lookup", { ip });
    return parseRdapIp(await this.get(`/ip/${encodeURIComponent(ip)}`), ip, this.baseUrl);
  }
}
