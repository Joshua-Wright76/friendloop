CREATE TYPE "public"."issue_theme" AS ENUM('picnic', 'spring', 'summer', 'autumn', 'winter', 'birthday');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('standard', 'photo', 'music', 'shoutout', 'recommendation');--> statement-breakpoint
CREATE TABLE "issue_moods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "theme" "issue_theme" DEFAULT 'picnic' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "kind" "question_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "theme" "issue_theme";--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "kind" "question_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_moods" ADD CONSTRAINT "issue_moods_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_moods" ADD CONSTRAINT "issue_moods_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_picks" ADD CONSTRAINT "issue_picks_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_picks" ADD CONSTRAINT "issue_picks_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_picks" ADD CONSTRAINT "issue_picks_created_by_membership_id_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_moods_issue_membership_idx" ON "issue_moods" USING btree ("issue_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_picks_issue_reply_idx" ON "issue_picks" USING btree ("issue_id","reply_id");