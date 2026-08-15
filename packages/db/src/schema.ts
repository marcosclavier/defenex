import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  date,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums

export const scanStatusEnum = pgEnum("scan_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "partial",
]);

export const scanTriggerEnum = pgEnum("scan_trigger", [
  "user",
  "scheduled",
  "outreach",
]);

export const findingCategoryEnum = pgEnum("finding_category", [
  "COUNTERFEIT",
  "PHISHING",
  "DOMAIN_SQUAT",
  "IMPERSONATION",
  "UNAUTHORIZED_RESALE",
  "TRADEMARK_MISUSE",
  "PIRACY",
  "LEGITIMATE",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "new",
  "confirmed",
  "dismissed",
  "actioned",
  "removed",
  "reappeared",
]);

export const confidenceEnum = pgEnum("confidence", ["high", "medium", "low"]);

/**
 * How the page content was obtained. Only the browser path yields a screenshot,
 * and a takedown notice needs visual evidence — so stealth-sourced findings must
 * be re-captured before they can be filed.
 */
export const evidenceSourceEnum = pgEnum("evidence_source", ["browser", "stealth"]);

export const emailStatusEnum = pgEnum("email_status", [
  "found",
  "guessed",
  "verified",
  "invalid",
]);

/**
 * Lawful basis for contacting someone. The user sends from Canada, so CASL
 * applies and the SENDER carries the burden of proving consent.
 * `conspicuous_publication` requires the recipient to have published the address
 * themselves — appended or pattern-guessed addresses do NOT qualify.
 */
export const consentBasisEnum = pgEnum("consent_basis", [
  "conspicuous_publication",
  "express_consent",
  "existing_business_relationship",
  "role_address",
  "none",
]);

/** Mirrors the Stripe catalogue. `free` is the default for a claimed brand. */
export const planEnum = pgEnum("plan", ["free", "monitor", "protect", "managed"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "trialing", "past_due", "canceled", "incomplete",
]);

export const takedownStatusEnum = pgEnum("takedown_status", [
  "draft",
  "capturing_evidence",
  /** Capture failed, so there is no image to file with. Never auto-submitted. */
  "blocked_no_evidence",
  "pending_approval",
  /** An admin declined to file it. Costs the customer nothing. */
  "declined",
  "submitted",
  "accepted",
  "rejected",
  "removed",
  "escalated",
]);

export const rightsStatusEnum = pgEnum("rights_status", ["pending", "verified", "rejected"]);

// ---------------------------------------------------------------- core

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Null for outbound targets we scanned but who have no account yet. */
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  industry: text("industry").notNull().default("generic"),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  /** First-party + authorized reseller domains, filtered before classification. */
  allowlistDomains: jsonb("allowlist_domains").$type<string[]>().notNull().default([]),
  socialHandles: jsonb("social_handles").$type<Record<string, string>>().notNull().default({}),
  /** Owner can pause monitoring without losing history or their plan. */
  monitoringPaused: boolean("monitoring_paused").notNull().default(false),
  /**
   * When the scheduler last enqueued a rescan. Tracked separately from the
   * scans table so a user-triggered scan does not reset the schedule, and so a
   * scan that failed to enqueue is retried on the next tick.
   */
  lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
  /** Suppresses alerts below this severity. Defaults to the `high` band. */
  alertMinSeverity: integer("alert_min_severity").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("brands_domain_idx").on(t.domain),
  index("brands_owner_idx").on(t.ownerUserId),
  index("brands_schedule_idx").on(t.monitoringPaused, t.lastScheduledAt),
]);

export const scans = pgTable("scans", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  status: scanStatusEnum("status").notNull().default("queued"),
  trigger: scanTriggerEnum("trigger").notNull().default("user"),
  /** Free-text stage for the progress UI: "searching", "analyzing 47 results". */
  progressStage: text("progress_stage"),
  progressPercent: integer("progress_percent").notNull().default(0),
  queriesRun: integer("queries_run").notNull().default(0),
  resultsSeen: integer("results_seen").notNull().default(0),
  findingsCount: integer("findings_count").notNull().default(0),
  costMicros: integer("cost_micros").notNull().default(0),
  error: text("error"),
  requestedByEmail: text("requested_by_email"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("scans_brand_started_idx").on(t.brandId, t.startedAt)]);

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  scanId: uuid("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  /** sha256(normalized url) — the dedupe key that turns rescans into a diff. */
  urlHash: text("url_hash").notNull(),
  domain: text("domain").notNull(),
  category: findingCategoryEnum("category").notNull(),
  severity: integer("severity").notNull(),
  confidence: confidenceEnum("confidence").notNull(),
  title: text("title").notNull(),
  /** Verified to appear verbatim in the fetched page before this row is written. */
  evidenceQuote: text("evidence_quote").notNull(),
  reasoning: text("reasoning"),
  sourceQuery: text("source_query"),
  screenshotKey: text("screenshot_key"),
  evidenceSource: evidenceSourceEnum("evidence_source"),
  status: findingStatusEnum("status").notNull().default("new"),
  dismissedReason: text("dismissed_reason"),
  /** Consecutive scans in which this URL was absent; 2 flips status to removed. */
  missedScans: integer("missed_scans").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("findings_brand_url_idx").on(t.brandId, t.urlHash),
  index("findings_brand_status_idx").on(t.brandId, t.status, t.severity),
  index("findings_scan_idx").on(t.scanId),
]);

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  scanId: uuid("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
  /** 32 random bytes, base64url. Never a sequential id — these are public URLs. */
  publicToken: text("public_token").notNull(),
  pdfKey: text("pdf_key"),
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("reports_token_idx").on(t.publicToken),
  index("reports_scan_idx").on(t.scanId),
]);

// ---------------------------------------------------------------- outreach (M7)

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  email: text("email"),
  emailStatus: emailStatusEnum("email_status"),
  countryCode: text("country_code"),
  seniority: text("seniority"),
  source: text("source"),
  /**
   * CASL: the sender must prove consent. No message may be sent unless
   * consentBasis is set and consentEvidenceUrl points at the page where the
   * recipient published this address. Enforced in the send path, not just the UI.
   */
  consentBasis: consentBasisEnum("consent_basis").notNull().default("none"),
  consentEvidenceUrl: text("consent_evidence_url"),
  consentEvidenceKey: text("consent_evidence_key"),
  consentCapturedAt: timestamp("consent_captured_at", { withTimezone: true }),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("contacts_brand_idx").on(t.brandId),
  uniqueIndex("contacts_email_idx").on(t.email),
]);

export const outreachMessages = pgTable("outreach_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
  step: integer("step").notNull().default(0),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  providerMsgId: text("provider_msg_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
}, (t) => [index("outreach_contact_idx").on(t.contactId)]);

/** Checked before every send, forever. Opt-outs are permanent. */
export const suppressions = pgTable("suppressions", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  domain: text("domain"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("suppressions_email_idx").on(t.email)]);

// ---------------------------------------------------------------- takedowns (M6)

/**
 * Proof that a customer owns or represents the mark, required before any notice
 * is filed. §512(f) makes a knowingly false notice actionable, so this gate is
 * enforced in the service layer rather than only in the UI.
 */
export const rightsVerifications = pgTable("rights_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  regNumber: text("reg_number").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("US"),
  registryUrl: text("registry_url"),
  /** Uploaded certificate in R2. */
  documentKey: text("document_key"),
  status: rightsStatusEnum("status").notNull().default("pending"),
  /**
   * What the register said at submission time: mark text, owner, live status.
   * Advisory only — it proves the registration exists, not that the requester
   * owns it, which is why a human still confirms.
   */
  registrySnapshot: jsonb("registry_snapshot").$type<Record<string, unknown>>(),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
  verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("rights_brand_idx").on(t.brandId),
  uniqueIndex("rights_brand_reg_idx").on(t.brandId, t.regNumber),
]);

export const takedowns = pgTable("takedowns", {
  id: uuid("id").defaultRandom().primaryKey(),
  findingId: uuid("finding_id").notNull().references(() => findings.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
  /** The rights record that authorised this filing, captured at request time. */
  rightsVerificationId: uuid("rights_verification_id").references(() => rightsVerifications.id),
  channel: text("channel").notNull(),
  noticeBody: text("notice_body"),
  evidenceBundleKey: text("evidence_bundle_key"),
  status: takedownStatusEnum("status").notNull().default("draft"),
  /** Never null once submitted — a human signs every notice. */
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  declinedReason: text("declined_reason"),
  /** Where the notice went: an email address, or the portal URL used. */
  submittedTo: text("submitted_to"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  outcomeNote: text("outcome_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("takedowns_finding_idx").on(t.findingId),
  index("takedowns_brand_status_idx").on(t.brandId, t.status),
]);

// ---------------------------------------------------------------- ops

/**
 * Billing state, mirrored from Stripe by the webhook. Stripe remains the source
 * of truth; this exists so entitlement checks do not make a network call on
 * every request.
 */
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: planEnum("plan").notNull().default("free"),
  status: subscriptionStatusEnum("status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** Enforcements included per period, and how many are spent. */
  enforcementsIncluded: integer("enforcements_included").notNull().default(0),
  enforcementsUsed: integer("enforcements_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("customers_user_idx").on(t.userId),
  uniqueIndex("customers_stripe_idx").on(t.stripeCustomerId),
]);

/**
 * Processed Stripe events. Stripe retries deliveries, so the webhook must be
 * idempotent or a retry double-provisions.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily search-call counter backing the spend circuit breaker. */
export const searchUsage = pgTable("search_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  day: date("day").notNull(),
  provider: text("provider").notNull().default("yepapi"),
  queries: integer("queries").notNull().default(0),
}, (t) => [uniqueIndex("cse_usage_day_idx").on(t.day, t.provider)]);

/** Response cache keyed on sha256(query + params). Cuts cost and rate-limit pressure. */
export const queryCache = pgTable("query_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  cacheKey: text("cache_key").notNull(),
  response: jsonb("response").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("query_cache_key_idx").on(t.cacheKey)]);
