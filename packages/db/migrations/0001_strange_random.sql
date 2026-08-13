CREATE TYPE "public"."evidence_source" AS ENUM('browser', 'stealth');--> statement-breakpoint
ALTER TABLE "cse_usage" RENAME TO "search_usage";--> statement-breakpoint
DROP INDEX "cse_usage_day_idx";--> statement-breakpoint
ALTER TABLE "search_usage" ADD COLUMN "provider" text DEFAULT 'yepapi' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "evidence_source" "evidence_source";--> statement-breakpoint
CREATE UNIQUE INDEX "cse_usage_day_idx" ON "search_usage" USING btree ("day","provider");