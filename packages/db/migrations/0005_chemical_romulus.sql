ALTER TABLE "rights_verifications" ADD COLUMN "attested_by_name" text;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "attested_title" text;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "attestation_text" text;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "attested_ip" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "notice_kind" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "notice_subject" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "evidence_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "review_notes" text;