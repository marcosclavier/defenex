CREATE TYPE "public"."confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."consent_basis" AS ENUM('conspicuous_publication', 'express_consent', 'existing_business_relationship', 'role_address', 'none');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('found', 'guessed', 'verified', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."finding_category" AS ENUM('COUNTERFEIT', 'PHISHING', 'DOMAIN_SQUAT', 'IMPERSONATION', 'UNAUTHORIZED_RESALE', 'TRADEMARK_MISUSE', 'PIRACY', 'LEGITIMATE');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('new', 'confirmed', 'dismissed', 'actioned', 'removed', 'reappeared');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."scan_trigger" AS ENUM('user', 'scheduled', 'outreach');--> statement-breakpoint
CREATE TYPE "public"."takedown_status" AS ENUM('draft', 'pending_approval', 'submitted', 'accepted', 'rejected', 'removed', 'escalated');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"industry" text DEFAULT 'generic' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowlist_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"social_handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"full_name" text,
	"title" text,
	"linkedin_url" text,
	"email" text,
	"email_status" "email_status",
	"country_code" text,
	"seniority" text,
	"source" text,
	"consent_basis" "consent_basis" DEFAULT 'none' NOT NULL,
	"consent_evidence_url" text,
	"consent_evidence_key" text,
	"consent_captured_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cse_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"queries" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"domain" text NOT NULL,
	"category" "finding_category" NOT NULL,
	"severity" integer NOT NULL,
	"confidence" "confidence" NOT NULL,
	"title" text NOT NULL,
	"evidence_quote" text NOT NULL,
	"reasoning" text,
	"source_query" text,
	"screenshot_key" text,
	"status" "finding_status" DEFAULT 'new' NOT NULL,
	"dismissed_reason" text,
	"missed_scans" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"scan_id" uuid,
	"step" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"provider_msg_id" text,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "query_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"public_token" text NOT NULL,
	"pdf_key" text,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rights_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"reg_number" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"registry_url" text,
	"document_key" text,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"trigger" "scan_trigger" DEFAULT 'user' NOT NULL,
	"progress_stage" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"queries_run" integer DEFAULT 0 NOT NULL,
	"results_seen" integer DEFAULT 0 NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"error" text,
	"requested_by_email" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"domain" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takedowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"notice_body" text,
	"evidence_bundle_key" text,
	"status" "takedown_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"outcome_note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD CONSTRAINT "rights_verifications_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD CONSTRAINT "rights_verifications_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_domain_idx" ON "brands" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contacts_brand_idx" ON "contacts" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "cse_usage_day_idx" ON "cse_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_brand_url_idx" ON "findings" USING btree ("brand_id","url_hash");--> statement-breakpoint
CREATE INDEX "findings_brand_status_idx" ON "findings" USING btree ("brand_id","status","severity");--> statement-breakpoint
CREATE INDEX "findings_scan_idx" ON "findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "outreach_contact_idx" ON "outreach_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "query_cache_key_idx" ON "query_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_token_idx" ON "reports" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "reports_scan_idx" ON "reports" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "rights_brand_idx" ON "rights_verifications" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "scans_brand_started_idx" ON "scans" USING btree ("brand_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_email_idx" ON "suppressions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "takedowns_finding_idx" ON "takedowns" USING btree ("finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");