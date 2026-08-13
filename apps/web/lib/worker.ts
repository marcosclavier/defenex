import "server-only";

/**
 * Client for the Railway worker.
 *
 * The web app holds no database or queue credentials: Postgres and Redis stay
 * on Railway's private network, and this authenticated HTTPS call is the only
 * way in. Never import this from a client component.
 */
const BASE = process.env.WORKER_API_URL;
const SECRET = process.env.WORKER_API_SECRET;

export class WorkerError extends Error {
  constructor(readonly status: number, message: string, readonly issues?: unknown) {
    super(message);
    this.name = "WorkerError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE || !SECRET) {
    throw new WorkerError(500, "worker API is not configured");
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new WorkerError(res.status, String(body.error ?? res.statusText), body.issues);
  }
  return body as T;
}

export interface StartScanInput {
  brand: string;
  domain: string;
  industry: string;
  aliases?: string[];
  allowlistDomains?: string[];
  email?: string;
}

export function startScan(input: StartScanInput, clientIp: string) {
  return call<{ scanId: string; status: string }>("/api/scan", {
    method: "POST",
    body: JSON.stringify(input),
    // Rate limiting lives on the worker, which owns Redis; it needs the real
    // caller, not Vercel's egress address.
    headers: { "x-client-ip": clientIp },
  });
}

export interface ScanStatus {
  scanId: string;
  status: "queued" | "running" | "completed" | "failed" | "partial";
  stage: string | null;
  percent: number;
  findingsCount: number;
  resultsSeen: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  reportToken: string | null;
}

export function getScanStatus(id: string) {
  return call<ScanStatus>(`/api/scan/${encodeURIComponent(id)}`);
}

export interface ReportFinding {
  url: string;
  domain: string;
  title: string;
  category: string;
  severity: number;
  severityLabel: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  evidenceQuote: string;
  reasoning: string | null;
  evidenceSource: "browser" | "stealth" | null;
  firstSeenAt: string;
  screenshotUrl: string | null;
}

export interface ReportPayload {
  brand: { name: string; domain: string; industry: string } | null;
  scan: { id: string; finishedAt: string | null; resultsSeen: number };
  findings: ReportFinding[];
}

export function getReport(token: string) {
  return call<ReportPayload>(`/api/report/${encodeURIComponent(token)}`);
}
