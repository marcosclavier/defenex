import { and, eq, gte, inArray, lt, not, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import {
  brands, customers, findings, queryCache, reports, rightsVerifications, scans,
  searchUsage, stripeEvents, takedowns, users,
} from "./schema.js";

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
  const createdOrReturned: string[] = [];
  let created = 0;
  let reappeared = 0;

  for (const row of rows) {
    const existing = await db.query.findings.findFirst({
      where: and(eq(findings.brandId, brandId), eq(findings.urlHash, row.urlHash)),
    });

    if (!existing) {
      created += 1;
      createdOrReturned.push(row.urlHash);
    } else if (existing.status === "removed") {
      reappeared += 1;
      createdOrReturned.push(row.urlHash);
    }

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

  // Hashes of findings that are new or have come back, so the caller can alert
  // on those alone rather than on the whole standing list.
  return { created, reappeared, removed, total: rows.length, changedHashes: createdOrReturned };
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

// ------------------------------------------------------------ accounts

export async function getUserById(userId: string, db: Db = getDb()) {
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

export async function listBrandsForUser(userId: string, db: Db = getDb()) {
  return db.query.brands.findMany({
    where: eq(brands.ownerUserId, userId),
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

export async function listScansForBrand(brandId: string, limit = 10, db: Db = getDb()) {
  return db.query.scans.findMany({
    where: eq(scans.brandId, brandId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
    limit,
  });
}

export async function countOpenFindings(brandId: string, db: Db = getDb()) {
  const rows = await db
    .select({ severity: findings.severity })
    .from(findings)
    .where(and(eq(findings.brandId, brandId), inArray(findings.status, ["new", "confirmed", "reappeared"])));
  return {
    total: rows.length,
    critical: rows.filter((r) => r.severity >= 80).length,
    high: rows.filter((r) => r.severity >= 60 && r.severity < 80).length,
  };
}

/**
 * Attach an unowned brand to a user.
 *
 * Deliberately refuses a brand someone else already owns rather than
 * reassigning it: outbound reports are public-token links, so anyone holding
 * one could otherwise take over a claimed brand.
 */
export async function claimBrand(domain: string, userId: string, db: Db = getDb()) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.domain, domain.toLowerCase()) });
  if (!brand) return { ok: false as const, reason: "not_found" as const };
  if (brand.ownerUserId && brand.ownerUserId !== userId) {
    return { ok: false as const, reason: "already_claimed" as const };
  }
  if (brand.ownerUserId === userId) return { ok: true as const, brand };

  const [updated] = await db
    .update(brands)
    .set({ ownerUserId: userId })
    .where(eq(brands.id, brand.id))
    .returning();
  return { ok: true as const, brand: updated! };
}

export async function getCustomer(userId: string, db: Db = getDb()) {
  return db.query.customers.findFirst({ where: eq(customers.userId, userId) });
}

export async function upsertCustomer(
  userId: string,
  patch: Partial<typeof customers.$inferInsert>,
  db: Db = getDb(),
) {
  const [row] = await db
    .insert(customers)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: customers.userId, set: patch })
    .returning();
  return row!;
}

export async function findCustomerByStripeId(stripeCustomerId: string, db: Db = getDb()) {
  return db.query.customers.findFirst({
    where: eq(customers.stripeCustomerId, stripeCustomerId),
  });
}

/**
 * Records a Stripe event id, returning false if it was already handled.
 * Stripe retries deliveries, so without this a retry double-provisions.
 */
export async function claimStripeEvent(id: string, type: string, db: Db = getDb()) {
  const inserted = await db
    .insert(stripeEvents)
    .values({ id, type })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

// ------------------------------------------------------------ monitoring

/** Rescan cadence in hours, by plan. Free brands are never scheduled. */
export const CADENCE_HOURS: Record<string, number | null> = {
  free: null,
  monitor: 24 * 7,
  protect: 24,
  managed: 24,
};

/**
 * Whether a brand has earned a scheduled rescan. Pure, so the rules that decide
 * when we spend money are testable without a database.
 *
 * past_due still scans: Stripe retries a declined card for days, and cutting
 * monitoring off on the first failure punishes a customer for an expired card.
 * canceled does not, and neither does free — an unclaimed brand scanned once
 * through the free tool must never become a recurring cost.
 */
export function isDueForScan(input: {
  plan: string;
  status: string | null;
  monitoringPaused: boolean;
  lastScheduledAt: Date | null;
  now?: Date;
}): boolean {
  if (input.monitoringPaused) return false;
  if (!input.status || !["active", "trialing", "past_due"].includes(input.status)) return false;

  const cadence = CADENCE_HOURS[input.plan] ?? null;
  if (cadence === null) return false;

  const now = (input.now ?? new Date()).getTime();
  const last = input.lastScheduledAt?.getTime() ?? 0;
  return now - last >= cadence * 3600_000;
}

export interface DueBrand {
  id: string;
  name: string;
  domain: string;
  industry: string;
  aliases: string[];
  allowlistDomains: string[];
  ownerUserId: string;
  ownerEmail: string;
  plan: string;
}

/**
 * Brands whose next scheduled rescan is due.
 *
 * Only owned brands on a paying plan are eligible: an unclaimed brand scanned
 * once through the free scanner must never turn into a recurring cost.
 */
export async function listBrandsDueForScan(limit = 50, db: Db = getDb()): Promise<DueBrand[]> {
  const rows = await db
    .select({
      id: brands.id,
      name: brands.name,
      domain: brands.domain,
      industry: brands.industry,
      aliases: brands.aliases,
      allowlistDomains: brands.allowlistDomains,
      ownerUserId: brands.ownerUserId,
      ownerEmail: users.email,
      plan: customers.plan,
      status: customers.status,
      lastScheduledAt: brands.lastScheduledAt,
    })
    .from(brands)
    .innerJoin(users, eq(brands.ownerUserId, users.id))
    .innerJoin(customers, eq(customers.userId, users.id))
    .where(eq(brands.monitoringPaused, false))
    .limit(500);

  const now = Date.now();
  const due: DueBrand[] = [];

  for (const r of rows) {
    if (!r.ownerUserId) continue;
    if (!isDueForScan({
      plan: r.plan,
      status: r.status,
      monitoringPaused: false, // already filtered in SQL
      lastScheduledAt: r.lastScheduledAt,
      now: new Date(now),
    })) continue;

    due.push({
      id: r.id,
      name: r.name,
      domain: r.domain,
      industry: r.industry,
      aliases: r.aliases,
      allowlistDomains: r.allowlistDomains,
      ownerUserId: r.ownerUserId,
      ownerEmail: r.ownerEmail,
      plan: r.plan,
    });
    if (due.length >= limit) break;
  }

  return due;
}

/** Claim the slot before enqueueing, so a crash cannot double-charge a scan. */
export async function markScheduled(brandId: string, db: Db = getDb()) {
  await db.update(brands).set({ lastScheduledAt: new Date() }).where(eq(brands.id, brandId));
}

export async function setMonitoringPaused(brandId: string, userId: string, paused: boolean, db: Db = getDb()) {
  const updated = await db
    .update(brands)
    .set({ monitoringPaused: paused })
    .where(and(eq(brands.id, brandId), eq(brands.ownerUserId, userId)))
    .returning();
  return updated.length > 0;
}

/** Findings from this scan that are new or returned, above the alert threshold. */
export async function alertableFindings(
  brandId: string,
  scanId: string,
  changedHashes: string[],
  minSeverity: number,
  db: Db = getDb(),
) {
  if (changedHashes.length === 0) return [];
  return db.query.findings.findMany({
    where: and(
      eq(findings.brandId, brandId),
      eq(findings.scanId, scanId),
      inArray(findings.urlHash, changedHashes),
      gte(findings.severity, minSeverity),
    ),
    orderBy: (f, { desc }) => [desc(f.severity)],
  });
}

// ------------------------------------------------------------ rights

export async function submitRightsClaim(
  input: {
    brandId: string;
    regNumber: string;
    jurisdiction: string;
    submittedByUserId: string;
    registryUrl?: string | null;
    documentKey?: string | null;
    registrySnapshot?: Record<string, unknown> | null;
  },
  db: Db = getDb(),
) {
  const [row] = await db
    .insert(rightsVerifications)
    .values({
      brandId: input.brandId,
      regNumber: input.regNumber,
      jurisdiction: input.jurisdiction,
      submittedByUserId: input.submittedByUserId,
      registryUrl: input.registryUrl ?? null,
      documentKey: input.documentKey ?? null,
      registrySnapshot: input.registrySnapshot ?? null,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: [rightsVerifications.brandId, rightsVerifications.regNumber],
      set: {
        registryUrl: input.registryUrl ?? null,
        documentKey: input.documentKey ?? null,
        registrySnapshot: input.registrySnapshot ?? null,
        // Re-submitting returns the claim to pending; a previously rejected
        // claim must be re-reviewed rather than silently staying rejected.
        status: "pending",
        rejectedReason: null,
      },
    })
    .returning();
  return row!;
}

export async function decideRightsClaim(
  id: string,
  decision: { verified: boolean; adminUserId: string; reason?: string },
  db: Db = getDb(),
) {
  const [row] = await db
    .update(rightsVerifications)
    .set({
      status: decision.verified ? "verified" : "rejected",
      verifiedByUserId: decision.adminUserId,
      verifiedAt: decision.verified ? new Date() : null,
      rejectedReason: decision.verified ? null : (decision.reason ?? "not stated"),
    })
    .where(eq(rightsVerifications.id, id))
    .returning();
  return row ?? null;
}

/**
 * The gate. No notice may be drafted or filed for a brand without a verified
 * registration, and this is checked in the service layer rather than the UI.
 */
export async function verifiedRightsFor(brandId: string, db: Db = getDb()) {
  return db.query.rightsVerifications.findFirst({
    where: and(eq(rightsVerifications.brandId, brandId), eq(rightsVerifications.status, "verified")),
  });
}

export async function listRightsForBrand(brandId: string, db: Db = getDb()) {
  return db.query.rightsVerifications.findMany({
    where: eq(rightsVerifications.brandId, brandId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}

export async function listPendingRights(db: Db = getDb()) {
  return db.query.rightsVerifications.findMany({
    where: eq(rightsVerifications.status, "pending"),
    orderBy: (r, { asc }) => [asc(r.createdAt)],
    limit: 100,
  });
}

// ------------------------------------------------------------ takedowns

export type TakedownRefusal =
  | "not_found"
  | "not_owner"
  | "no_verified_rights"
  | "allowance_exhausted"
  | "already_requested";

/**
 * Creates a takedown request, refusing rather than proceeding when any
 * precondition fails. Every refusal here is deliberate:
 *
 * - `no_verified_rights` is the §512(f) gate.
 * - `allowance_exhausted` stops silent overage billing.
 * - `already_requested` stops a double click spending two enforcements.
 */
export async function requestTakedown(
  input: { findingId: string; userId: string },
  db: Db = getDb(),
): Promise<{ ok: true; takedownId: string } | { ok: false; reason: TakedownRefusal }> {
  const finding = await db.query.findings.findFirst({ where: eq(findings.id, input.findingId) });
  if (!finding) return { ok: false, reason: "not_found" };

  const brand = await db.query.brands.findFirst({ where: eq(brands.id, finding.brandId) });
  if (!brand || brand.ownerUserId !== input.userId) return { ok: false, reason: "not_owner" };

  const rights = await verifiedRightsFor(brand.id, db);
  if (!rights) return { ok: false, reason: "no_verified_rights" };

  const existing = await db.query.takedowns.findFirst({
    where: and(
      eq(takedowns.findingId, input.findingId),
      not(inArray(takedowns.status, ["declined", "rejected"])),
    ),
  });
  if (existing) return { ok: false, reason: "already_requested" };

  const customer = await getCustomer(input.userId, db);
  const used = customer?.enforcementsUsed ?? 0;
  const included = customer?.enforcementsIncluded ?? 0;
  if (used >= included) return { ok: false, reason: "allowance_exhausted" };

  const [row] = await db
    .insert(takedowns)
    .values({
      findingId: finding.id,
      brandId: brand.id,
      requestedByUserId: input.userId,
      rightsVerificationId: rights.id,
      channel: "unresolved",
      status: "draft",
    })
    .returning();

  return { ok: true, takedownId: row!.id };
}

export async function getTakedown(id: string, db: Db = getDb()) {
  return db.query.takedowns.findFirst({ where: eq(takedowns.id, id) });
}

export async function updateTakedown(
  id: string,
  patch: Partial<typeof takedowns.$inferInsert>,
  db: Db = getDb(),
) {
  const [row] = await db.update(takedowns).set(patch).where(eq(takedowns.id, id)).returning();
  return row ?? null;
}

export async function listTakedownsForBrand(brandId: string, db: Db = getDb()) {
  return db.query.takedowns.findMany({
    where: eq(takedowns.brandId, brandId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export async function listTakedownsAwaitingApproval(db: Db = getDb()) {
  return db.query.takedowns.findMany({
    where: inArray(takedowns.status, ["pending_approval", "blocked_no_evidence"]),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    limit: 100,
  });
}

/** Spent on submission, never on request, so a declined draft costs nothing. */
export async function consumeEnforcement(userId: string, db: Db = getDb()) {
  await db
    .update(customers)
    .set({ enforcementsUsed: sql`${customers.enforcementsUsed} + 1` })
    .where(eq(customers.userId, userId));
}
