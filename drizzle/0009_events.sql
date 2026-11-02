CREATE TYPE "public"."event_kind" AS ENUM('once', 'birthday');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "event_kind" NOT NULL,
	"title" text,
	"emoji" text,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"year" integer,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_sections" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_sections" ADD COLUMN "event_date" date;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_group_idx" ON "events" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "issue_sections" ADD CONSTRAINT "issue_sections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_sections_event_occurrence_idx" ON "issue_sections" USING btree ("event_id","event_date");