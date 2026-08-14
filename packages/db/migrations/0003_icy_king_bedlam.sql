ALTER TABLE "brands" ADD COLUMN "monitoring_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "last_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "alert_min_severity" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
CREATE INDEX "brands_schedule_idx" ON "brands" USING btree ("monitoring_paused","last_scheduled_at");