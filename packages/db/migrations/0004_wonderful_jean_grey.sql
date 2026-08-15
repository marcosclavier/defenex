CREATE TYPE "public"."rights_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."takedown_status" ADD VALUE 'capturing_evidence' BEFORE 'pending_approval';--> statement-breakpoint
ALTER TYPE "public"."takedown_status" ADD VALUE 'blocked_no_evidence' BEFORE 'pending_approval';--> statement-breakpoint
ALTER TYPE "public"."takedown_status" ADD VALUE 'declined' BEFORE 'submitted';--> statement-breakpoint
ALTER TABLE "rights_verifications" ALTER COLUMN "jurisdiction" SET DEFAULT 'US';--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "status" "rights_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "registry_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "brand_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "rights_verification_id" uuid;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "declined_reason" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "submitted_to" text;--> statement-breakpoint
ALTER TABLE "takedowns" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rights_verifications" ADD CONSTRAINT "rights_verifications_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_rights_verification_id_rights_verifications_id_fk" FOREIGN KEY ("rights_verification_id") REFERENCES "public"."rights_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rights_brand_reg_idx" ON "rights_verifications" USING btree ("brand_id","reg_number");--> statement-breakpoint
CREATE INDEX "takedowns_brand_status_idx" ON "takedowns" USING btree ("brand_id","status");