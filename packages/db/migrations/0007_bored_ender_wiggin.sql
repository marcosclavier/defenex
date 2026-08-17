ALTER TABLE "scans" ADD COLUMN "queries_planned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "queries_failed" integer DEFAULT 0 NOT NULL;