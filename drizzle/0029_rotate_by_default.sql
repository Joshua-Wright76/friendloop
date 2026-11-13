-- Every loop takes turns through one list of questions.
--
-- 1. "Every round" is gone as a choice: those questions join the back of the queue.
UPDATE "questions" SET "frequency" = 'rotating', "position" = "position" + 1000000 WHERE "frequency" = 'every_round';
--> statement-breakpoint
-- 2. A loop that asked everything each round, and has already sent a round, has its
--    open round cut to three now. Anything someone has written in stays, as does
--    anything dated. A loop still on its first round keeps it whole.
WITH ranked AS (
  SELECT iq."id",
    EXISTS (SELECT 1 FROM "replies" r WHERE r."issue_question_id" = iq."id") AS written,
    row_number() OVER (
      PARTITION BY iq."issue_id"
      ORDER BY (EXISTS (SELECT 1 FROM "replies" r WHERE r."issue_question_id" = iq."id")) DESC, iq."position", iq."id"
    ) AS place
  FROM "issue_questions" iq
  JOIN "issues" i ON i."id" = iq."issue_id" AND i."status" = 'open'
  JOIN "groups" g ON g."id" = i."group_id" AND g."questions_per_round" IS NULL
  JOIN "questions" q ON q."id" = iq."question_id" AND q."frequency" = 'rotating'
  WHERE iq."occurrence_date" IS NULL
    AND EXISTS (SELECT 1 FROM "issues" sent WHERE sent."group_id" = i."group_id" AND sent."status" = 'delivered')
)
DELETE FROM "issue_questions" WHERE "id" IN (SELECT "id" FROM ranked WHERE place > 3 AND NOT written);
--> statement-breakpoint
-- 3. In those loops the queue starts with what the open round doesn't ask, so the
--    next round brings the others before anything repeats.
UPDATE "questions" q SET "position" = o.place
FROM (
  SELECT q2."id",
    row_number() OVER (
      PARTITION BY q2."group_id"
      ORDER BY (EXISTS (
        SELECT 1 FROM "issue_questions" iq JOIN "issues" i ON i."id" = iq."issue_id"
        WHERE i."status" = 'open' AND iq."question_id" = q2."id"
      )), q2."position", q2."created_at", q2."id"
    ) - 1 AS place
  FROM "questions" q2
  JOIN "groups" g ON g."id" = q2."group_id" AND g."questions_per_round" IS NULL
  WHERE q2."frequency" = 'rotating'
) o
WHERE o."id" = q."id";
--> statement-breakpoint
-- 4. From the next round on, every such loop asks three at a time.
UPDATE "groups" SET "questions_per_round" = 3 WHERE "questions_per_round" IS NULL;
