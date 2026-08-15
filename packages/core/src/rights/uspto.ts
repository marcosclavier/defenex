/**
 * USPTO Trademark Status & Document Retrieval (TSDR) lookup.
 *
 * This is an ADVISORY check, not an authorisation. It confirms a registration
 * exists and is live and names the recorded owner; it cannot confirm that the
 * person asking us to file is that owner. A human makes that call — which is
 * the whole point of the approval gate, because §512(f) attaches liability to
 * a notice filed without a good-faith basis.
 *
 * Rate limited by USPTO to 60 requests/minute per key.
 */
import { RightsLookupError } from "../errors.js";

const BASE = "https://tsdrapi.uspto.gov/ts/cd/casestatus";

/** Status codes USPTO uses for a registration that is alive and enforceable. */
const LIVE_STATUS_PREFIXES = ["6", "7", "8"];

export interface RegistrationRecord {
  regNumber: string;
  markText: string | null;
  ownerName: string | null;
  statusCode: string | null;
  statusText: string | null;
  /** False for abandoned, cancelled or expired registrations. */
  isLive: boolean;
  filingDate: string | null;
  registrationDate: string | null;
  registryUrl: string;
  raw: Record<string, unknown>;
}

export interface UsptoConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Registration numbers are 7-8 digits; strip the punctuation people paste in. */
export function normalizeRegNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export class UsptoClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: UsptoConfig) {
    if (!config.apiKey) throw new RightsLookupError("USPTO_API_KEY is not set");
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async lookup(regNumberInput: string): Promise<RegistrationRecord> {
    const regNumber = normalizeRegNumber(regNumberInput);
    if (regNumber.length < 6 || regNumber.length > 8) {
      throw new RightsLookupError(`"${regNumberInput}" is not a valid registration number`);
    }

    const url = `${BASE}/rn${regNumber}/info.json`;
    const res = await this.doFetch(url, {
      headers: { "USPTO-API-KEY": this.config.apiKey, accept: "application/json" },
    });

    if (res.status === 404) {
      throw new RightsLookupError(`No US registration found for ${regNumber}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new RightsLookupError("USPTO rejected the API key");
    }
    if (res.status === 429) {
      throw new RightsLookupError("USPTO rate limit reached; try again shortly");
    }
    if (!res.ok) {
      throw new RightsLookupError(`USPTO returned ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    return parseTsdr(regNumber, body);
  }
}

/** Exported for tests: TSDR's shape is deeply nested and worth pinning down. */
export function parseTsdr(regNumber: string, body: Record<string, unknown>): RegistrationRecord {
  const bag = body as {
    trademarks?: Array<{
      status?: {
        markElement?: string;
        statusCode?: number | string;
        statusDate?: string;
        usRegistrationNumber?: string;
        filingDate?: string;
        registrationDate?: string;
      };
      parties?: {
        ownerGroups?: Record<string, Array<{ partyName?: string }>>;
      };
    }>;
  };

  const tm = bag.trademarks?.[0];
  const status = tm?.status ?? {};
  const statusCode = status.statusCode != null ? String(status.statusCode) : null;

  // Owner sits under a group keyed by role; the current owner is what matters.
  const groups = tm?.parties?.ownerGroups ?? {};
  const ownerName =
    Object.values(groups)
      .flat()
      .map((o) => o?.partyName)
      .find((n): n is string => Boolean(n)) ?? null;

  return {
    regNumber,
    markText: status.markElement ?? null,
    ownerName,
    statusCode,
    statusText: statusCode ? describeStatus(statusCode) : null,
    isLive: statusCode ? LIVE_STATUS_PREFIXES.includes(statusCode[0]!) : false,
    filingDate: status.filingDate ?? null,
    registrationDate: status.registrationDate ?? null,
    registryUrl: `https://tsdr.uspto.gov/#caseNumber=${regNumber}&caseType=US_REGISTRATION_NO&searchType=statusSearch`,
    raw: body,
  };
}

/**
 * TSDR status codes are grouped by leading digit. We only need to distinguish
 * "enforceable" from "not", and to show the admin something readable.
 */
function describeStatus(code: string): string {
  switch (code[0]) {
    case "6":
      return `Registered (${code})`;
    case "7":
      return `Registered — renewal or post-registration activity (${code})`;
    case "8":
      return `Registered — under review (${code})`;
    case "4":
      return `Pending application (${code})`;
    case "5":
      return `Published for opposition (${code})`;
    case "9":
      return `Dead — abandoned, cancelled or expired (${code})`;
    default:
      return `Status ${code}`;
  }
}
