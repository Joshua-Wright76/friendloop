-- expand-contract: yes
--
-- Contract, first half (docs/questions-unify-design.md, PR D). This runs while the
-- release before it still serves, and drops only what that code never touches:
-- the triggers that mirrored legacy section writes into the unified tables, and the
-- copy functions behind them. Nothing deployed writes the legacy tables any more
-- (the dev-only demo seed did, and its sections now simply aren't mirrored), and
-- nothing calls these functions but the triggers.
--
-- The legacy tables, `unify_ids` and the retired columns stay: the code still
-- serving names them, through Drizzle's full column lists on insert and select or
-- directly (erasure reads `events`, media cleanup and the stats page read
-- `section_media`, the reply sheet reads `unify_ids`). The code that ships with this
-- migration no longer does, so the next release drops them all.
--
-- Safe to run again.
DROP TRIGGER IF EXISTS "sections_mirror" ON "sections";--> statement-breakpoint
DROP TRIGGER IF EXISTS "events_mirror" ON "events";--> statement-breakpoint
DROP TRIGGER IF EXISTS "issue_sections_mirror" ON "issue_sections";--> statement-breakpoint
DROP TRIGGER IF EXISTS "section_replies_mirror" ON "section_replies";--> statement-breakpoint
DROP TRIGGER IF EXISTS "section_media_mirror" ON "section_media";--> statement-breakpoint
DROP FUNCTION IF EXISTS "mirror_sections"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "mirror_events"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "mirror_issue_sections"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "mirror_section_replies"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "mirror_section_media"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_section"("sections");--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_event"("events");--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_issue_section"("issue_sections");--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_section_reply"("section_replies");--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_section_media"("section_media");--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_id"(text, uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "unify_mapped"(text, uuid);--> statement-breakpoint

-- `format` is the only thing the new code knows an item's shape by, so it is never
-- empty. The code still serving creates a loop's first questions without it, so the
-- trigger that fills it from `kind` stays one more release, and NOT NULL is checked
-- after it fills. The new code no longer writes `kind`; the trigger now keeps it in
-- step with `format` (on insert and whenever `format` changes), so a rollback to the
-- release before this one still reads a poll as a poll.
CREATE OR REPLACE FUNCTION "fill_format_from_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."format" IS NULL THEN
    NEW."format" := NEW."kind"::text::"answer_format";
  ELSE
    NEW."kind" := (CASE WHEN NEW."format" = 'poll' THEN 'poll' ELSE 'written' END)::"question_kind";
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "questions_fill_format" ON "questions";--> statement-breakpoint
CREATE TRIGGER "questions_fill_format" BEFORE INSERT OR UPDATE OF "format" ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "fill_format_from_kind"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "issue_questions_fill_format" ON "issue_questions";--> statement-breakpoint
CREATE TRIGGER "issue_questions_fill_format" BEFORE INSERT OR UPDATE OF "format" ON "issue_questions"
  FOR EACH ROW EXECUTE FUNCTION "fill_format_from_kind"();--> statement-breakpoint
UPDATE "questions" SET "format" = "kind"::text::"answer_format" WHERE "format" IS NULL;--> statement-breakpoint
UPDATE "issue_questions" SET "format" = "kind"::text::"answer_format" WHERE "format" IS NULL;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "format" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_questions" ALTER COLUMN "format" SET NOT NULL;
