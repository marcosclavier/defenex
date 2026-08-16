import { zipSync } from "fflate";
import { sha256Of, type EvidenceArtifact } from "./capture.js";
import type { RdapDomainRecord, RdapIpRecord } from "../enrich/rdap.js";

/**
 * A single self-describing archive per takedown.
 *
 * The point of the manifest is not convenience: a platform or a court asks
 * whether the screenshot is the one that was taken on the day, and the answer
 * has to be checkable without trusting us. Every artifact carries its SHA-256,
 * so anyone holding the bundle can recompute the digests and see for
 * themselves. The bundle hash is returned to the caller for the same reason —
 * recorded outside the archive it cannot be quietly regenerated.
 */

export const EVIDENCE_FORMAT_VERSION = 1;

/**
 * Fixed entry timestamp. Noon, so that converting to local time cannot push it
 * outside the 1980-2099 window the ZIP format can represent.
 */
const ZIP_EPOCH = Date.UTC(1990, 0, 1, 12);

export interface ManifestEntry {
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface EvidenceManifest {
  formatVersion: number;
  takedownId: string;
  findingId: string;
  brandId: string;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  pageTitle: string | null;
  capturedAt: string;
  capturedBy: string;
  screenshotFullPage: boolean;
  responseHeaders: Record<string, string>;
  registrar: {
    domain: string;
    name: string | null;
    ianaId: string | null;
    abuseEmail: string | null;
    registeredAt: string | null;
    statuses: string[];
  } | null;
  host: {
    ip: string;
    operator: string | null;
    networkName: string | null;
    abuseEmail: string | null;
    country: string | null;
  } | null;
  /** Why registrar or host is null, when a lookup was attempted and failed. */
  lookupErrors: string[];
  artifacts: ManifestEntry[];
}

export interface BundleInput {
  takedownId: string;
  findingId: string;
  brandId: string;
  capture: {
    capturedAt: string;
    requestedUrl: string;
    finalUrl: string | null;
    httpStatus: number | null;
    pageTitle: string | null;
    screenshotFullPage: boolean;
    responseHeaders: Record<string, string>;
    artifacts: EvidenceArtifact[];
  };
  rdapDomain?: RdapDomainRecord | null;
  rdapIp?: RdapIpRecord | null;
  lookupErrors?: string[];
  capturedBy?: string;
}

export interface EvidenceBundle {
  zip: Uint8Array;
  manifest: EvidenceManifest;
  /** SHA-256 of the archive itself. Store this outside the archive. */
  sha256: string;
}

export function buildEvidenceBundle(input: BundleInput): EvidenceBundle {
  const { capture } = input;

  // The RDAP responses are archived whole, not just the fields we parsed: our
  // parser is a convenience, the registry's own answer is the record.
  const artifacts = [...capture.artifacts];
  if (input.rdapDomain) {
    artifacts.push(jsonEntry("rdap-domain.json", input.rdapDomain.raw));
  }
  if (input.rdapIp) {
    artifacts.push(jsonEntry("rdap-ip.json", input.rdapIp.raw));
  }

  const manifest: EvidenceManifest = {
    formatVersion: EVIDENCE_FORMAT_VERSION,
    takedownId: input.takedownId,
    findingId: input.findingId,
    brandId: input.brandId,
    requestedUrl: capture.requestedUrl,
    finalUrl: capture.finalUrl,
    httpStatus: capture.httpStatus,
    pageTitle: capture.pageTitle,
    capturedAt: capture.capturedAt,
    capturedBy: input.capturedBy ?? "defenex-evidence/1",
    screenshotFullPage: capture.screenshotFullPage,
    responseHeaders: capture.responseHeaders,
    registrar: input.rdapDomain
      ? {
          domain: input.rdapDomain.domain,
          name: input.rdapDomain.registrar,
          ianaId: input.rdapDomain.registrarIanaId,
          abuseEmail: input.rdapDomain.registrarAbuse?.email ?? null,
          registeredAt: input.rdapDomain.registeredAt,
          statuses: input.rdapDomain.statuses,
        }
      : null,
    host: input.rdapIp
      ? {
          ip: input.rdapIp.ip,
          operator: input.rdapIp.operator,
          networkName: input.rdapIp.networkName,
          abuseEmail: input.rdapIp.abuse?.email ?? null,
          country: input.rdapIp.country,
        }
      : null,
    lookupErrors: input.lookupErrors ?? [],
    artifacts: artifacts.map((a) => ({
      name: a.name,
      contentType: a.contentType,
      sizeBytes: a.bytes.byteLength,
      sha256: a.sha256,
    })),
  };

  const files: Record<string, Uint8Array> = {
    "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  };
  for (const a of artifacts) files[a.name] = a.bytes;

  // Entry mtimes are pinned rather than taken from the clock, so rebuilding a
  // bundle from the same capture yields the same bytes and the recorded digest
  // stays checkable. ZIP stores timestamps in local time, so the pin is a
  // constant and the authoritative capture time lives in the manifest instead.
  const zip = zipSync(files, { level: 6, mtime: ZIP_EPOCH });
  return { zip, manifest, sha256: sha256Of(zip) };
}

function jsonEntry(name: string, value: unknown): EvidenceArtifact {
  const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  return { name, contentType: "application/json", bytes, sha256: sha256Of(bytes) };
}
