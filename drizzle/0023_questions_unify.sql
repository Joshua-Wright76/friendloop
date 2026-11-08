-- Copy and switch (docs/questions-unify-design.md, PR B). Sections, events and their
-- answers are copied into `questions`, `issue_questions`, `replies` and `reply_media`,
-- keeping their ids, so a reply sheet loaded before the deploy still saves and every
-- anchor, album key and comment keeps pointing at the same thing.
--
-- This runs in one transaction while the previous release still serves. That code
-- only ever writes the legacy tables, and only reads the unified ones through its
-- tolerate rule (src/lib/legacy-ask.ts), so the copy is invisible to it. The lock
-- makes its legacy writes wait for the commit (reads go on), and the triggers then
-- mirror every later legacy write, so nothing written between this migration and the
-- new code going live is lost, and a rollback keeps mirroring too. The triggers and
-- the legacy tables go in the contract release.
--
-- Safe to run again: every copy is an upsert on `id`, and the queue rewrite leaves an
-- already rewritten pool where it is.
LOCK TABLE "sections", "events", "issue_sections", "section_replies", "section_media", "questions", "groups", "issues" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

-- A section becomes an item asked every round. Copied pool rows get `active = false`,
-- so code from before the switch never puts them in a round; their state lives in
-- `archived_at` ("Include in future issues" unticked arrives stopped). They are
-- numbered from 1000 so they follow a loop's own every-round questions, as sections
-- always followed the questions.
CREATE OR REPLACE FUNCTION "unify_section"(s "sections") RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, archived_at, kind, format, frequency,
                         emoji, description, admin_only, created_at)
  VALUES (s.id, s.group_id, s.title, 1000 + s.position, false,
          coalesce(s.archived_at, CASE WHEN NOT s.active THEN now() END),
          'written', (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
          'every_round', s.emoji, s.description, s.admin_only, s.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only,
    archived_at = CASE WHEN excluded.archived_at IS NULL THEN NULL
                       ELSE coalesce(questions.archived_at, excluded.archived_at) END
$$;--> statement-breakpoint

-- An event becomes an item asked on a date. A birthday keeps an empty text: it is
-- titled from the person's name when a round opens, as before.
CREATE OR REPLACE FUNCTION "unify_event"(e "events") RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, kind, format, frequency, emoji,
                         date_kind, month, day, year, about_membership_id, created_at)
  VALUES (e.id, e.group_id, coalesce(e.title, ''), 0, false, 'written', 'written', 'on_date', e.emoji,
          e.kind, e.month, e.day, e.year, e.membership_id, e.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, emoji = excluded.emoji, month = excluded.month,
    day = excluded.day, year = excluded.year, about_membership_id = excluded.about_membership_id
$$;--> statement-breakpoint

-- A round's section becomes its snapshot, after every question and in section order,
-- marked `from_section` so a past round keeps its look. A round holds an item once, so
-- a second card for the same section or event in one round (an event moved mid-round
-- under the old code), or one that would collide with a snapshot the new code made
-- (only possible after a rollback), is still copied, answers and all, just without
-- its link to the pool.
CREATE OR REPLACE FUNCTION "unify_issue_section"(s "issue_sections") RETURNS void LANGUAGE sql AS $$
  INSERT INTO issue_questions (id, issue_id, question_id, text, position, kind, format, emoji,
                               description, admin_only, occurrence_date, about_membership_id, from_section)
  SELECT s.id, s.issue_id,
         CASE WHEN EXISTS (
                SELECT 1 FROM issue_questions x
                 WHERE x.id <> s.id AND x.question_id = coalesce(s.section_id, s.event_id)
                   AND (x.issue_id = s.issue_id OR x.occurrence_date = s.event_date))
              THEN NULL
              ELSE (SELECT q.id FROM questions q WHERE q.id = coalesce(s.section_id, s.event_id)) END,
         s.title, 1000 + s.position, 'written',
         (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
         s.emoji, s.description, s.admin_only, s.event_date,
         (SELECT e.membership_id FROM events e WHERE e.id = s.event_id AND e.kind = 'birthday'), true
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "unify_section_reply"(r "section_replies") RETURNS void LANGUAGE sql AS $$
  INSERT INTO replies (id, issue_id, issue_question_id, membership_id, body, link_url, link_provider,
                       status, submitted_at, added_after_delivery, never_sent, created_at, updated_at)
  SELECT r.id, r.issue_id, r.issue_section_id, r.membership_id, r.body, r.link_url, r.link_provider,
         r.status, r.submitted_at, r.added_after_delivery, r.never_sent, r.created_at, r.updated_at
   WHERE EXISTS (SELECT 1 FROM issue_questions q WHERE q.id = r.issue_section_id)
     AND NOT EXISTS (
       SELECT 1 FROM replies x
        WHERE x.id <> r.id AND x.issue_id = r.issue_id AND x.issue_question_id = r.issue_section_id
          AND x.membership_id = r.membership_id)
  ON CONFLICT (id) DO UPDATE SET body = excluded.body, link_url = excluded.link_url,
    link_provider = excluded.link_provider, added_after_delivery = excluded.added_after_delivery,
    never_sent = excluded.never_sent, updated_at = excluded.updated_at
$$;--> statement-breakpoint

-- In a round still taking answers, a standard section's photo becomes the answer's
-- `photo_url`, so its written card can show and replace it. Every other photo keeps
-- its id as a `reply_media` row: photo walls, an extra photo a standard section got
-- through the old count-then-insert race, and the photos of rounds already out.
CREATE OR REPLACE FUNCTION "unify_section_media"(m "section_media") RETURNS void LANGUAGE sql AS $$
  UPDATE replies r SET photo_url = m.url
    FROM issue_questions q, issues i
   WHERE r.id = m.section_reply_id AND q.id = r.issue_question_id AND i.id = r.issue_id
     AND q.from_section AND q.format = 'written' AND i.status = 'open' AND r.photo_url IS NULL
     AND NOT EXISTS (SELECT 1 FROM reply_media x WHERE x.id = m.id);
  INSERT INTO reply_media (id, reply_id, url, caption, position, created_at)
  SELECT m.id, m.section_reply_id, m.url, m.caption, m.position, m.created_at
   WHERE EXISTS (SELECT 1 FROM replies r WHERE r.id = m.section_reply_id)
     AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.id = m.section_reply_id AND r.photo_url = m.url)
  ON CONFLICT (id) DO UPDATE SET caption = excluded.caption, position = excluded.position
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "mirror_sections"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM questions WHERE id = OLD.id; RETURN OLD; END IF;
  PERFORM unify_section(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_events"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM questions WHERE id = OLD.id; RETURN OLD; END IF;
  PERFORM unify_event(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_issue_sections"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM issue_questions WHERE id = OLD.id; RETURN OLD; END IF;
  PERFORM unify_issue_section(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_section_replies"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM replies WHERE id = OLD.id; RETURN OLD; END IF;
  PERFORM unify_section_reply(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_section_media"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM reply_media WHERE id = OLD.id;
    UPDATE replies SET photo_url = NULL WHERE id = OLD.section_reply_id AND photo_url = OLD.url;
    RETURN OLD;
  END IF;
  PERFORM unify_section_media(NEW); RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE TRIGGER "sections_mirror" AFTER INSERT OR UPDATE OR DELETE ON "sections"
  FOR EACH ROW EXECUTE FUNCTION "mirror_sections"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "events_mirror" AFTER INSERT OR UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "mirror_events"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "issue_sections_mirror" AFTER INSERT OR UPDATE OR DELETE ON "issue_sections"
  FOR EACH ROW EXECUTE FUNCTION "mirror_issue_sections"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "section_replies_mirror" AFTER INSERT OR UPDATE OR DELETE ON "section_replies"
  FOR EACH ROW EXECUTE FUNCTION "mirror_section_replies"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "section_media_mirror" AFTER INSERT OR UPDATE OR DELETE ON "section_media"
  FOR EACH ROW EXECUTE FUNCTION "mirror_section_media"();--> statement-breakpoint

-- The copy, parents first, one row at a time through the same functions the triggers use.
DO $$
DECLARE s sections; e events; i issue_sections; r section_replies; m section_media;
BEGIN
  FOR s IN SELECT * FROM sections ORDER BY created_at, id LOOP PERFORM unify_section(s); END LOOP;
  FOR e IN SELECT * FROM events ORDER BY created_at, id LOOP PERFORM unify_event(e); END LOOP;
  FOR i IN SELECT * FROM issue_sections ORDER BY issue_id, position, id LOOP PERFORM unify_issue_section(i); END LOOP;
  FOR r IN SELECT * FROM section_replies ORDER BY created_at, id LOOP PERFORM unify_section_reply(r); END LOOP;
  FOR m IN SELECT * FROM section_media ORDER BY section_reply_id, position, created_at, id LOOP
    PERFORM unify_section_media(m);
  END LOOP;
END $$;--> statement-breakpoint

-- "All questions" loops: everything was already asked every round; now say so.
UPDATE "questions" q SET "frequency" = 'every_round' FROM "groups" g
 WHERE g.id = q.group_id AND g.questions_per_round IS NULL AND q.frequency = 'rotating' AND q.active;--> statement-breakpoint

-- The queue is the order: renumber each loop's turn-taking pool so it starts where the
-- cursor points, and move the open round's cursor the same way, so code from before
-- the switch still selects the same questions while it serves.
UPDATE "issues" i SET "question_cursor" = ((i.question_cursor - g.question_cursor) % c.n + c.n) % c.n
  FROM "groups" g,
       (SELECT group_id, count(*)::int AS n FROM questions
         WHERE active AND archived_at IS NULL AND frequency = 'rotating' GROUP BY group_id) c
 WHERE i.status = 'open' AND g.id = i.group_id AND c.group_id = g.id AND g.question_cursor <> 0;--> statement-breakpoint
WITH pool AS (
  SELECT q.id, g.question_cursor AS cur,
         row_number() OVER w - 1 AS idx, count(*) OVER (PARTITION BY q.group_id) AS n
    FROM questions q JOIN groups g ON g.id = q.group_id
   WHERE q.active AND q.archived_at IS NULL AND q.frequency = 'rotating'
  WINDOW w AS (PARTITION BY q.group_id ORDER BY q.position, q.created_at, q.id))
UPDATE "questions" q SET "position" = ((p.idx - p.cur) % p.n + p.n) % p.n
  FROM pool p WHERE q.id = p.id AND q.position IS DISTINCT FROM ((p.idx - p.cur) % p.n + p.n) % p.n;--> statement-breakpoint
UPDATE "groups" SET "question_cursor" = 0 WHERE "question_cursor" <> 0;
