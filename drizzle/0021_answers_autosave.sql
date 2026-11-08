ALTER TABLE "replies" ADD COLUMN "never_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "section_replies" ADD COLUMN "never_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Answers now save straight into the round: whatever is written goes out. A draft
-- in a round that is still open is therefore an answer, and is marked as one so the
-- code still running for the few minutes before this release goes live agrees.
UPDATE "replies" SET "status" = 'submitted', "submitted_at" = coalesce("submitted_at", "updated_at")
FROM "issues"
WHERE "issues"."id" = "replies"."issue_id" AND "issues"."status" = 'open' AND "replies"."status" = 'draft'
  AND ("replies"."body" ~ '\S' OR "replies"."photo_url" IS NOT NULL OR "replies"."audio_url" IS NOT NULL OR jsonb_array_length("replies"."poll_choices") > 0);--> statement-breakpoint
UPDATE "section_replies" SET "status" = 'submitted', "submitted_at" = coalesce("submitted_at", "updated_at")
FROM "issues"
WHERE "issues"."id" = "section_replies"."issue_id" AND "issues"."status" = 'open' AND "section_replies"."status" = 'draft';--> statement-breakpoint
-- A draft in a round that already went out (or was dropped) was never part of it.
-- Without this mark it would appear in that round now that drafts are answers.
UPDATE "replies" SET "never_sent" = true
FROM "issues"
WHERE "issues"."id" = "replies"."issue_id" AND "issues"."status" <> 'open' AND "replies"."status" = 'draft';--> statement-breakpoint
UPDATE "section_replies" SET "never_sent" = true
FROM "issues"
WHERE "issues"."id" = "section_replies"."issue_id" AND "issues"."status" <> 'open' AND "section_replies"."status" = 'draft';
