CREATE TYPE "public"."section_kind" AS ENUM('standard', 'photo_wall', 'music');--> statement-breakpoint
CREATE TABLE "issue_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"section_id" uuid,
	"kind" "section_kind" NOT NULL,
	"title" text NOT NULL,
	"emoji" text,
	"description" text,
	"admin_only" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_links" (
	"url" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"title" text,
	"artwork_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_reply_id" uuid NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_section_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_url" text,
	"link_provider" text,
	"status" "reply_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"added_after_delivery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "section_kind" NOT NULL,
	"title" text NOT NULL,
	"emoji" text,
	"description" text,
	"admin_only" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_sections" ADD CONSTRAINT "issue_sections_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sections" ADD CONSTRAINT "issue_sections_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_media" ADD CONSTRAINT "section_media_section_reply_id_section_replies_id_fk" FOREIGN KEY ("section_reply_id") REFERENCES "public"."section_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_replies" ADD CONSTRAINT "section_replies_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_replies" ADD CONSTRAINT "section_replies_issue_section_id_issue_sections_id_fk" FOREIGN KEY ("issue_section_id") REFERENCES "public"."issue_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_replies" ADD CONSTRAINT "section_replies_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_sections_issue_section_idx" ON "issue_sections" USING btree ("issue_id","section_id");--> statement-breakpoint
CREATE INDEX "section_media_reply_idx" ON "section_media" USING btree ("section_reply_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_replies_unique_idx" ON "section_replies" USING btree ("issue_id","issue_section_id","membership_id");--> statement-breakpoint
CREATE INDEX "sections_group_idx" ON "sections" USING btree ("group_id");