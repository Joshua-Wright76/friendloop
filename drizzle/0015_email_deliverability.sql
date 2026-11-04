CREATE TYPE "public"."suppression_reason" AS ENUM('bounce', 'complaint');--> statement-breakpoint
ALTER TYPE "public"."outbox_status" ADD VALUE 'suppressed';--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "outbox_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "unsubscribe_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "muted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "headers" jsonb;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "suppressed_reason" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_message_idx" ON "email_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_unsubscribe_token_idx" ON "memberships" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "outbox_provider_idx" ON "outbox" USING btree ("provider_id");