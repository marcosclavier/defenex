ALTER TYPE "public"."takedown_status" ADD VALUE 'awaiting_filing' BEFORE 'submitted';--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "signed_by_name" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "verify_miss_streak" integer DEFAULT 0 NOT NULL;