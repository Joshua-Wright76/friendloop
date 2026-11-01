CREATE TYPE "public"."suggestion_author" AS ENUM('name', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "question_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"text" text NOT NULL,
	"author_display" "suggestion_author" DEFAULT 'name' NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"accepted_question_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "suggested_by" text;--> statement-breakpoint
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_accepted_question_id_questions_id_fk" FOREIGN KEY ("accepted_question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_suggestions_group_status_idx" ON "question_suggestions" USING btree ("group_id","status");