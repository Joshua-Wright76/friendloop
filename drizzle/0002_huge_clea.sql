ALTER TABLE "groups" ADD COLUMN "questions_per_round" integer;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "question_cursor" integer DEFAULT 0 NOT NULL;