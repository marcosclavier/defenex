import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import { brands, findings, queryCache, reports, scans, searchUsage } from "./schema.js";

type Db = ReturnType<typeof getDb>;

/** Reuse a brand row per domain so rescans diff against the same history. */
export async function upsertBrand(
  input: { name: string; domain: string; industry: string; aliases: string[]; allowlistDomains: string[] },
  db: Db = getDb(),
) {
  const [row] = await db
    .insert(brands)
    .values(input)
    .onConflictDoUpdate({
      target: brands.domain,
      set: { name: input.name, industry: input.industry, aliases: input.aliases, allowlistDomains: input.allowlistDomains },
    })
    .returning();
  return row!;
}

export async function createScan(
  input: { brandId: string; trigger: "user" | "scheduled" | "outreach"; requestedByEmail?: string | null },
  db: Db = getDb(),
) {
  const [row] = await db
    .insert(scans)
    .values({
      brandId: input.brandId,
      trigger: input.trigger,
      requestedByEmail: input.requestedByEmail ?? null,
      status: "queued",
    })
    .returning();
  return row!;
}

export async function updateScanProgress(
  scanId: string,
  patch: Partial<typeof scans.$inferInsert>,
  db: Db = getDb(),
) {
  await db.update(scans).set(patch).where(eq(scans.id, scanId));
}

export async function getScan(scanId: string, db: Db = getDb()) {
  return db.query.scans.findFirst({ where: eq(scans.id, scanId) });
}

export interface FindingUpsert {
  brandId: string;
  scanId: string;
  url: string;
  urlHash: string;
  domain: string;
  category: (typeof findings.$inferInsert)["category"];
  severity: number;
  confidence: (typeof findings.$inferInsert)["confidence"];
  title: string;
  evidenceQuote: string;
  reasoning: string | null;
  sourceQuery: string | null;
  screenshotKey: string | null;
  evidenceSource: "browser" | "stealth" | null;
}

/**
 * Write this scan's findings and reconcile them against the brand's history.
 *
 * The unique index on (brand_id, url_hash) is what turns a rescan into a diff:
 * a URL seen again has last_seen_at bumped and its miss counter cleared, while
 * one absent for two consecutive scans flips to `removed` — which is also the
 * evidence that a takedown worked.
 */
export async function reconcileFindings(
  brandId: string,
  scanId: string,
  rows: FindingUpsert[],
  db: Db = getDb(),
) {
  const now = new Date();
  let created = 0;
  let reappeared = 0;

  for (const row of rows) {
    const existing = await db.query.findings.findFirst({
      where: and(eq(findings.brandId, brandId), eq(findings.urlHash, row.urlHash)),
    });

    if (!existing) created += 1;
    else if (existing.status === "removed") reappeared += 1;

    await db
      .insert(findings)
      .values({ ...row, status: "new", firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [findings.brandId, findings.urlHash],
        set: {
          scanId,
          severity: row.severity,
          category: row.category,
          confidence: row.confidence,
          title: row.title,
          evidenceQuote: row.evidenceQuote,
          reasoning: row.reasoning,
          screenshotKey: row.screenshotKey,
          evidenceSource: row.evidenceSource,
          lastSeenAt: now,
          missedScans: 0,
          // A URL that comes back after removal is materially interesting:
          // it usually means the seller relisted after a takedown.
          status: sql`case when ${findings.status} = 'removed' then 'reappeared'::finding_status else ${findings.status} end`,
        },
      });
  }

  const seenHashes = rows.map((r) => r.urlHash);
  const stale = await db.query.findings.findMany({
    where: and(
      eq(findings.brandId, brandId),
      seenHashes.length ? sql`${findings.urlHash} not in ${seenHashes}` : sql`true`,
      inArray(findings.status, ["new", "confirmed", "reappeared"]),
    ),
  });

  let removed = 0;
  for (const row of stale) {
    const missed = row.missedScans + 1;
    await db
      .update(findings)
      .set({ missedScans: missed, ...(missed >= 2 ? { status: "removed" as const } : {}) })
      .where(eq(findings.id, row.id));
    if (missed >= 2) removed += 1;
  }

  return { created, reappeared, removed, total: rows.length };
}

export async function listFindings(scanId: string, db: Db = getDb()) {
  return db.query.findings.findMany({
    where: eq(findings.scanId, scanId),
    orderBy: (f, { desc }) => [desc(f.severity)],
  });
}

export async function createReport(scanId: string, publicToken: string, db: Db = getDb()) {
  const [row] = await db.insert(reports).values({ scanId, publicToken }).returning();
  return row!;
}

export async function getReportByToken(token: string, db: Db = getDb()) {
  return db.query.reports.findFirst({ where: eq(reports.publicToken, token) });
}

/** Lets the progress UI find the report once the scan finishes. */
export async function getReportByScanId(scanId: string, db: Db = getDb()) {
  return db.query.reports.findFirst({ where: eq(reports.scanId, scanId) });
}

// ------------------------------------------------------------ engine ports

export async function cacheGet(key: string, ttlMs: number, db: Db = getDb()) {
  const row = await db.query.queryCache.findFirst({ where: eq(queryCache.cacheKey, key) });
  if (!row) return null;
  if (Date.now() - row.fetchedAt.getTime() > ttlMs) return null;
  return row.response;
}

export async function cacheSet(key: string, value: unknown, db: Db = getDb()) {
  await db
    .insert(queryCache)
    .values({ cacheKey: key, response: value as object })
    .onConflictDoUpdate({
      target: queryCache.cacheKey,
      set: { response: value as object, fetchedAt: new Date() },
    });
}

/** Prune expired cache rows so the table does not grow without bound. */
export async function cachePrune(ttlMs: number, db: Db = getDb()) {
  const cutoff = new Date(Date.now() - ttlMs);
  await db.delete(queryCache).where(lt(queryCache.fetchedAt, cutoff));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function searchCallsUsedToday(provider: string, db: Db = getDb()) {
  const row = await db.query.searchUsage.findFirst({
    where: and(eq(searchUsage.day, today()), eq(searchUsage.provider, provider)),
  });
  return row?.queries ?? 0;
}

/** Atomic increment — two concurrent scans must not both read-then-write. */
export async function consumeSearchCalls(provider: string, n: number, db: Db = getDb()) {
  await db
    .insert(searchUsage)
    .values({ day: today(), provider, queries: n })
    .onConflictDoUpdate({
      target: [searchUsage.day, searchUsage.provider],
      set: { queries: sql`${searchUsage.queries} + ${n}` },
    });
}
