import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BlockedUrlError } from "../errors.js";

/**
 * Anyone can submit a domain to the scanner, and the worker then fetches it.
 * Without this guard an attacker can point us at internal services or the
 * cloud metadata endpoint and read the response back out of a report.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

const V4_BLOCKS: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "this-network"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade-nat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud metadata"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "ietf-protocol"],
  ["192.0.2.0", 24, "test-net"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmark"],
  ["198.51.100.0", 24, "test-net"],
  ["203.0.113.0", 24, "test-net"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

function blockedV4Reason(ip: string): string | null {
  const n = ipv4ToInt(ip);
  if (n === null) return "malformed-ipv4";
  for (const [base, bits, label] of V4_BLOCKS) {
    const b = ipv4ToInt(base);
    if (b === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (b & mask)) return label;
  }
  return null;
}

function blockedV6Reason(ip: string): string | null {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (a === "::1") return "loopback";
  if (a === "::") return "unspecified";
  // IPv4-mapped (::ffff:10.0.0.1) must be judged on the embedded v4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped?.[1]) return blockedV4Reason(mapped[1]);
  const head = a.split(":")[0] ?? "";
  if (/^f[cd]/.test(head)) return "unique-local";
  if (/^fe[89ab]/.test(head)) return "link-local";
  if (/^ff/.test(head)) return "multicast";
  return null;
}

export function blockedIpReason(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) return blockedV4Reason(ip);
  if (v === 6) return blockedV6Reason(ip);
  return "not-an-ip";
}

/**
 * Validate a URL before any network request.
 *
 * Residual risk: DNS rebinding. We resolve and check here, but Chromium
 * resolves again when it navigates, and a hostile resolver can return a
 * different address the second time. Closing that fully requires pinning the
 * validated IP or routing fetches through an egress proxy that enforces the
 * same rules — worth doing before this is exposed to untrusted volume.
 */
export async function assertUrlIsFetchable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(rawUrl, "unparseable URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(rawUrl, `scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError(rawUrl, "embedded credentials are not allowed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new BlockedUrlError(rawUrl, `hostname ${host} is not allowed`);
  }

  // Literal IP in the URL — check it directly, no DNS involved.
  if (isIP(host)) {
    const reason = blockedIpReason(host);
    if (reason) throw new BlockedUrlError(rawUrl, `address ${host} is ${reason}`);
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(rawUrl, `DNS lookup failed for ${host}`);
  }
  if (addresses.length === 0) {
    throw new BlockedUrlError(rawUrl, `${host} resolved to no addresses`);
  }

  // Every resolved address must be public — one bad answer is enough to refuse.
  for (const { address } of addresses) {
    const reason = blockedIpReason(address);
    if (reason) {
      throw new BlockedUrlError(rawUrl, `${host} resolves to ${address} (${reason})`);
    }
  }

  return url;
}
