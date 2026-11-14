-- Every loop takes turns through one list of questions, five a round.
--
-- Everything below the first statement touches only loops that asked every
-- question each round ("questions_per_round" IS NULL); the last statement gives
-- them a number, so running this again changes nothing.
--
-- 1. "Every round" is gone as a choice: those questions join the back of the queue.
UPDATE "questions" SET "frequency" = 'rotating', "position" = "position" + 1000000 WHERE "frequency" = 'every_round';
--> statement-breakpoint
-- 2. Three rounds' worth to take turns through: a loop with fewer than fifteen
--    questions gets everyday ones it doesn't have yet, behind its own, in an order
--    of its own so two loops don't end up asking the same things.
INSERT INTO "questions" ("group_id", "text", "position", "frequency", "format")
SELECT g."id", c."text", base.last + c.place, 'rotating', 'written'
FROM "groups" g
CROSS JOIN LATERAL (
  SELECT coalesce(max(q."position"), -1) AS last,
    count(*) FILTER (WHERE q."archived_at" IS NULL AND q."frequency" = 'rotating') AS have
  FROM "questions" q WHERE q."group_id" = g."id"
) base
CROSS JOIN LATERAL (
  SELECT d."text", row_number() OVER (ORDER BY md5(g."id"::text || d."text")) AS place
  FROM (VALUES
    (1, 'What made you laugh this week?'),
    (2, 'What tiny thing made you unreasonably happy this week?'),
    (3, 'What did a friend do recently that meant a lot?'),
    (4, 'What did last weekend actually look like?'),
    (5, 'What did you cook that you''d make again?'),
    (6, 'What are you looking forward to?'),
    (7, 'What small thing are you grateful for today?'),
    (8, 'How do you show someone you''re glad they exist?'),
    (9, 'What does a perfect Saturday morning look like?'),
    (10, 'What''s your comfort meal after a long day?'),
    (11, 'What''s something small you''re proud of?'),
    (12, 'What made you smile on your way somewhere?'),
    (13, 'What''s the earliest memory you have with someone in this group?'),
    (14, 'What are you doing this weekend that you''re looking forward to?'),
    (15, 'What food did you hate as a kid and love now?'),
    (16, 'What did you eat that was worth remembering?'),
    (17, 'What''s the best thing that happened in your kitchen this week?'),
    (18, 'Who makes you laugh the hardest?'),
    (19, 'What''s your favorite way to waste a Sunday?'),
    (20, 'What''s the best thing you ate this week?'),
    (21, 'What''s the last thing that surprised you?'),
    (22, 'What''s a little ritual that makes a normal day nicer?'),
    (23, 'What did friendship look like when you were twenty?'),
    (24, 'What''s a tiny plan that made a weekend better?'),
    (25, 'What would your last meal on earth be?'),
    (26, 'Who did you talk to this week that you want to see again?'),
    (27, 'What did you notice this week that you''d normally miss?'),
    (28, 'What do you want friends to ask you more often?'),
    (29, 'Who did you spend your weekend with, and what did you do?'),
    (30, 'What snack disappears fastest in your house?')
  ) AS d(ord, "text")
  WHERE NOT EXISTS (SELECT 1 FROM "questions" q WHERE q."group_id" = g."id" AND q."text" = d."text")
) c
WHERE g."questions_per_round" IS NULL AND c.place <= 15 - base.have;
--> statement-breakpoint
-- 3. A loop that has already sent a round gets a fresh open round: what nobody has
--    written in yet leaves it. A loop still on its first round keeps it whole.
DELETE FROM "issue_questions" iq
USING "issues" i, "groups" g, "questions" q
WHERE i."id" = iq."issue_id" AND i."status" = 'open'
  AND g."id" = i."group_id" AND g."questions_per_round" IS NULL
  AND q."id" = iq."question_id" AND q."frequency" = 'rotating'
  AND iq."occurrence_date" IS NULL
  AND EXISTS (SELECT 1 FROM "issues" sent WHERE sent."group_id" = i."group_id" AND sent."status" = 'delivered')
  AND NOT EXISTS (SELECT 1 FROM "replies" r WHERE r."issue_question_id" = iq."id");
--> statement-breakpoint
-- 4. ...and is filled back up to five, with questions no round has asked first.
INSERT INTO "issue_questions" ("issue_id", "question_id", "text", "position", "kind", "format", "poll_multiple", "poll_options", "emoji", "description", "admin_only")
SELECT i."id", pick."id", pick."text", 1000 + pick.place, pick."kind", pick."format", pick."poll_multiple", pick."poll_options", pick."emoji", pick."description", pick."admin_only"
FROM "issues" i
JOIN "groups" g ON g."id" = i."group_id" AND g."questions_per_round" IS NULL
CROSS JOIN LATERAL (
  SELECT count(*) AS have FROM "issue_questions" iq
  JOIN "questions" q ON q."id" = iq."question_id" AND q."frequency" = 'rotating'
  WHERE iq."issue_id" = i."id" AND iq."occurrence_date" IS NULL
) kept
CROSS JOIN LATERAL (
  SELECT q.*, row_number() OVER (
      ORDER BY (EXISTS (
        SELECT 1 FROM "issue_questions" iq JOIN "issues" i ON i."id" = iq."issue_id"
        WHERE i."status" = 'delivered' AND iq."question_id" = q."id"
      )), q."position", q."created_at", q."id"
    ) AS place
  FROM "questions" q
  WHERE q."group_id" = g."id" AND q."frequency" = 'rotating' AND q."archived_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "issue_questions" iq WHERE iq."issue_id" = i."id" AND iq."question_id" = q."id")
) pick
WHERE i."status" = 'open'
  AND EXISTS (SELECT 1 FROM "issues" sent WHERE sent."group_id" = i."group_id" AND sent."status" = 'delivered')
  AND pick.place <= 5 - kept.have;
--> statement-breakpoint
-- 5. The open round reads in order again: its questions, then anything dated.
UPDATE "issue_questions" iq SET "position" = o.place
FROM (
  SELECT iq2."id", row_number() OVER (
      PARTITION BY iq2."issue_id" ORDER BY (iq2."occurrence_date" IS NOT NULL), iq2."position", iq2."id"
    ) - 1 AS place
  FROM "issue_questions" iq2
  JOIN "issues" i ON i."id" = iq2."issue_id" AND i."status" = 'open'
  JOIN "groups" g ON g."id" = i."group_id" AND g."questions_per_round" IS NULL
) o
WHERE o."id" = iq."id";
--> statement-breakpoint
-- 6. The queue starts with what the open round doesn't ask, never-asked questions
--    first, so the next round brings new ones before anything repeats.
UPDATE "questions" q SET "position" = o.place
FROM (
  SELECT q2."id",
    row_number() OVER (
      PARTITION BY q2."group_id"
      ORDER BY (EXISTS (
        SELECT 1 FROM "issue_questions" iq JOIN "issues" i ON i."id" = iq."issue_id"
        WHERE i."status" = 'open' AND iq."question_id" = q2."id"
      )), (EXISTS (
        SELECT 1 FROM "issue_questions" iq JOIN "issues" i ON i."id" = iq."issue_id"
        WHERE i."status" = 'delivered' AND iq."question_id" = q2."id"
      )), q2."position", q2."created_at", q2."id"
    ) - 1 AS place
  FROM "questions" q2
  JOIN "groups" g ON g."id" = q2."group_id" AND g."questions_per_round" IS NULL
  WHERE q2."frequency" = 'rotating'
) o
WHERE o."id" = q."id";
--> statement-breakpoint
-- 7. From here on, every such loop asks five a round.
UPDATE "groups" SET "questions_per_round" = 5 WHERE "questions_per_round" IS NULL;
