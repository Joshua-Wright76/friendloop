CREATE TYPE "public"."question_kind" AS ENUM('written', 'poll');--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "kind" "question_kind" DEFAULT 'written' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "poll_multiple" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "poll_options" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "kind" "question_kind" DEFAULT 'written' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "poll_multiple" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "poll_options" jsonb;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "poll_choices" jsonb DEFAULT '[]'::jsonb NOT NULL;