-- Expand only (docs/questions-unify-design.md, PR A): new types, nullable or defaulted
-- columns and an empty table, so the code still serving while this runs is unaffected.
-- No section data is copied here; the code that ships with this ignores any row that
-- isn't a written or poll question (src/lib/legacy-ask.ts) so the copy can come later.
CREATE TYPE "public"."answer_format" AS ENUM('written', 'poll', 'photo_wall', 'music');--> statement-breakpoint
CREATE TYPE "public"."ask_frequency" AS ENUM('every_round', 'rotating', 'on_date');--> statement-breakpoint
CREATE TABLE "reply_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reply_id" uuid NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "format" "answer_format";--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "admin_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "about_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_questions" ADD COLUMN "from_section" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "format" "answer_format";--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "frequency" "ask_frequency" DEFAULT 'rotating' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "admin_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "date_kind" "event_kind";--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "month" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "day" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "about_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "skipped_dates" date[] DEFAULT '{}'::date[] NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "link_url" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "link_provider" text;--> statement-breakpoint
ALTER TABLE "reply_media" ADD CONSTRAINT "reply_media_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_media_reply_idx" ON "reply_media" USING btree ("reply_id");--> statement-breakpoint
ALTER TABLE "issue_questions" ADD CONSTRAINT "issue_questions_about_membership_id_memberships_id_fk" FOREIGN KEY ("about_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_about_membership_id_memberships_id_fk" FOREIGN KEY ("about_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_questions_occurrence_idx" ON "issue_questions" USING btree ("question_id","occurrence_date");--> statement-breakpoint
-- Code from before the unified model never writes `format`; a question's format is
-- its kind. Filled on insert so nothing has to know, and only when left out, so the
-- copy that comes later can name a photo wall or a music pick itself.
CREATE FUNCTION "fill_format_from_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."format" IS NULL THEN
    NEW."format" := NEW."kind"::text::"answer_format";
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "questions_fill_format" BEFORE INSERT ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "fill_format_from_kind"();--> statement-breakpoint
CREATE TRIGGER "issue_questions_fill_format" BEFORE INSERT ON "issue_questions"
  FOR EACH ROW EXECUTE FUNCTION "fill_format_from_kind"();--> statement-breakpoint
-- Rows that already exist get the same answer. `kind` is never changed after insert.
UPDATE "questions" SET "format" = "kind"::text::"answer_format" WHERE "format" IS NULL;--> statement-breakpoint
UPDATE "issue_questions" SET "format" = "kind"::text::"answer_format" WHERE "format" IS NULL;
