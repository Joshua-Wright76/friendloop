-- Copy and switch (docs/questions-unify-design.md, PR B). Sections, events and their
-- answers are copied into `questions`, `issue_questions`, `replies` and `reply_media`.
-- A copy keeps its legacy id wherever that id is free, so a reply sheet loaded before
-- the deploy still saves and every anchor, album key and comment keeps pointing at
-- the same thing. A legacy id already taken by a row of the target table (seeded
-- fixtures with hand-picked ids can do that) gets a fresh id instead, and the row
-- that held it is never touched. `unify_ids` records every legacy -> unified pairing,
-- and every copy, every mirror and every link between copies resolves through it.
--
-- This runs in one transaction while the previous release still serves. That code
-- only ever writes the legacy tables, and only reads the unified ones through its
-- tolerate rule (src/lib/legacy-ask.ts), so the copy is invisible to it. The lock
-- makes its legacy writes wait for the commit (reads go on), and the triggers then
-- mirror every later legacy write, so nothing written between this migration and the
-- new code going live is lost, and a rollback keeps mirroring too. The triggers, the
-- mapping and the legacy tables go in the contract release.
--
-- Safe to run again: every copy is an upsert on its mapped id, and the queue rewrite
-- leaves an already rewritten pool where it is.
LOCK TABLE "sections", "events", "issue_sections", "section_replies", "section_media", "questions", "groups", "issues" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "unify_ids" (
	"kind" text NOT NULL,
	"legacy_id" uuid NOT NULL,
	"unified_id" uuid NOT NULL,
	CONSTRAINT "unify_ids_kind_legacy_id_pk" PRIMARY KEY("kind","legacy_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unify_ids_unified_idx" ON "unify_ids" USING btree ("kind","unified_id");--> statement-breakpoint

-- The unified id of a legacy row, claimed on first sight: its own id when no row of
-- the target table holds it, else a fresh one. `kind` names the legacy table.
CREATE OR REPLACE FUNCTION "unify_id"(p_kind text, p_legacy uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE mapped uuid; taken boolean;
BEGIN
  IF p_legacy IS NULL THEN RETURN NULL; END IF;
  SELECT u.unified_id INTO mapped FROM unify_ids u WHERE u.kind = p_kind AND u.legacy_id = p_legacy;
  IF mapped IS NOT NULL THEN RETURN mapped; END IF;
  taken := CASE p_kind
    WHEN 'section' THEN EXISTS (SELECT 1 FROM questions WHERE id = p_legacy)
    WHEN 'event' THEN EXISTS (SELECT 1 FROM questions WHERE id = p_legacy)
    WHEN 'issue_section' THEN EXISTS (SELECT 1 FROM issue_questions WHERE id = p_legacy)
    WHEN 'section_reply' THEN EXISTS (SELECT 1 FROM replies WHERE id = p_legacy)
    WHEN 'section_media' THEN EXISTS (SELECT 1 FROM reply_media WHERE id = p_legacy)
  END;
  IF taken IS NULL THEN RAISE EXCEPTION 'unknown legacy kind %', p_kind; END IF;
  mapped := CASE WHEN taken THEN gen_random_uuid() ELSE p_legacy END;
  INSERT INTO unify_ids (kind, legacy_id, unified_id) VALUES (p_kind, p_legacy, mapped);
  RETURN mapped;
END $$;--> statement-breakpoint

-- The unified id a legacy row was already given, or null if it has none yet.
CREATE OR REPLACE FUNCTION "unify_mapped"(p_kind text, p_legacy uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT u.unified_id FROM unify_ids u WHERE u.kind = p_kind AND u.legacy_id = p_legacy
$$;--> statement-breakpoint

-- A section becomes an item asked every round. Copied pool rows get `active = false`,
-- so code from before the switch never puts them in a round; their state lives in
-- `archived_at` ("Include in future issues" unticked arrives stopped). They are
-- numbered from 1000 so they follow a loop's own every-round questions, as sections
-- always followed the questions. Only a copy is ever updated (the mapped id, and
-- never a loop's own question).
CREATE OR REPLACE FUNCTION "unify_section"(s "sections") RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, archived_at, kind, format, frequency,
                         emoji, description, admin_only, created_at)
  VALUES (unify_id('section', s.id), s.group_id, s.title, 1000 + s.position, false,
          coalesce(s.archived_at, CASE WHEN NOT s.active THEN now() END),
          'written', (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
          'every_round', s.emoji, s.description, s.admin_only, s.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only,
    archived_at = CASE WHEN excluded.archived_at IS NULL THEN NULL
                       ELSE coalesce(questions.archived_at, excluded.archived_at) END
    WHERE NOT questions.active
$$;--> statement-breakpoint

-- An event becomes an item asked on a date. A birthday keeps an empty text: it is
-- titled from the person's name when a round opens, as before.
CREATE OR REPLACE FUNCTION "unify_event"(e "events") RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, kind, format, frequency, emoji,
                         date_kind, month, day, year, about_membership_id, created_at)
  VALUES (unify_id('event', e.id), e.group_id, coalesce(e.title, ''), 0, false, 'written', 'written', 'on_date', e.emoji,
          e.kind, e.month, e.day, e.year, e.membership_id, e.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, emoji = excluded.emoji, month = excluded.month,
    day = excluded.day, year = excluded.year, about_membership_id = excluded.about_membership_id
    WHERE NOT questions.active
$$;--> statement-breakpoint

-- A round's section becomes its snapshot, after every question and in section order,
-- marked `from_section` so a past round keeps its look, and linked to its section's
-- or event's copy. A round holds an item once, so a second card for the same section
-- or event in one round (an event moved mid-round under the old code), or one that
-- would collide with a snapshot the new code made (only possible after a rollback),
-- is still copied, answers and all, just without its link to the pool.
CREATE OR REPLACE FUNCTION "unify_issue_section"(s "issue_sections") RETURNS void LANGUAGE sql AS $$
  WITH ids AS (
    SELECT unify_id('issue_section', s.id) AS id,
           coalesce(unify_mapped('section', s.section_id), unify_mapped('event', s.event_id)) AS pool)
  INSERT INTO issue_questions (id, issue_id, question_id, text, position, kind, format, emoji,
                               description, admin_only, occurrence_date, about_membership_id, from_section)
  SELECT ids.id, s.issue_id,
         CASE WHEN EXISTS (
                SELECT 1 FROM issue_questions x
                 WHERE x.id <> ids.id AND x.question_id = ids.pool
                   AND (x.issue_id = s.issue_id OR x.occurrence_date = s.event_date))
              THEN NULL
              ELSE (SELECT q.id FROM questions q WHERE q.id = ids.pool) END,
         s.title, 1000 + s.position, 'written',
         (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
         s.emoji, s.description, s.admin_only, s.event_date,
         (SELECT e.membership_id FROM events e WHERE e.id = s.event_id AND e.kind = 'birthday'), true
    FROM ids
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only
    WHERE issue_questions.from_section
$$;--> statement-breakpoint

-- An answer to a section hangs from its round section's copy. One that would collide
-- with an answer the new code made for the same person and item (only possible after
-- a rollback) is left out; so is one whose round section was never copied.
CREATE OR REPLACE FUNCTION "unify_section_reply"(r "section_replies") RETURNS void LANGUAGE sql AS $$
  WITH ids AS (SELECT unify_id('section_reply', r.id) AS id, unify_mapped('issue_section', r.issue_section_id) AS ask)
  INSERT INTO replies (id, issue_id, issue_question_id, membership_id, body, link_url, link_provider,
                       status, submitted_at, added_after_delivery, never_sent, created_at, updated_at)
  SELECT ids.id, r.issue_id, ids.ask, r.membership_id, r.body, r.link_url, r.link_provider,
         r.status, r.submitted_at, r.added_after_delivery, r.never_sent, r.created_at, r.updated_at
    FROM ids
   WHERE EXISTS (SELECT 1 FROM issue_questions q WHERE q.id = ids.ask AND q.from_section)
     AND NOT EXISTS (
       SELECT 1 FROM replies x
        WHERE x.id <> ids.id AND x.issue_id = r.issue_id AND x.issue_question_id = ids.ask
          AND x.membership_id = r.membership_id)
  ON CONFLICT (id) DO UPDATE SET body = excluded.body, link_url = excluded.link_url,
    link_provider = excluded.link_provider, added_after_delivery = excluded.added_after_delivery,
    never_sent = excluded.never_sent, updated_at = excluded.updated_at
    WHERE replies.issue_question_id = excluded.issue_question_id
$$;--> statement-breakpoint

-- In a round still taking answers, a standard section's photo becomes the answer's
-- `photo_url`, so its written card can show and replace it. Every other photo is a
-- `reply_media` row: photo walls, an extra photo a standard section got through the
-- old count-then-insert race, and the photos of rounds already out.
CREATE OR REPLACE FUNCTION "unify_section_media"(m "section_media") RETURNS void LANGUAGE sql AS $$
  WITH ids AS (SELECT unify_id('section_media', m.id) AS id, unify_mapped('section_reply', m.section_reply_id) AS reply)
  UPDATE replies r SET photo_url = m.url
    FROM ids, issue_questions q, issues i
   WHERE r.id = ids.reply AND q.id = r.issue_question_id AND i.id = r.issue_id
     AND q.from_section AND q.format = 'written' AND i.status = 'open' AND r.photo_url IS NULL
     AND NOT EXISTS (SELECT 1 FROM reply_media x WHERE x.id = ids.id);
  WITH ids AS (SELECT unify_id('section_media', m.id) AS id, unify_mapped('section_reply', m.section_reply_id) AS reply)
  INSERT INTO reply_media (id, reply_id, url, caption, position, created_at)
  SELECT ids.id, ids.reply, m.url, m.caption, m.position, m.created_at
    FROM ids
   WHERE EXISTS (SELECT 1 FROM replies r WHERE r.id = ids.reply)
     AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.id = ids.reply AND r.photo_url = m.url)
  ON CONFLICT (id) DO UPDATE SET caption = excluded.caption, position = excluded.position
    WHERE reply_media.reply_id = excluded.reply_id
$$;--> statement-breakpoint

-- Deletes reach only the copy the mapping names.
CREATE OR REPLACE FUNCTION "mirror_sections"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM questions WHERE id = unify_mapped('section', OLD.id) AND NOT active;
    RETURN OLD;
  END IF;
  PERFORM unify_section(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_events"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM questions WHERE id = unify_mapped('event', OLD.id) AND NOT active;
    RETURN OLD;
  END IF;
  PERFORM unify_event(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_issue_sections"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM issue_questions WHERE id = unify_mapped('issue_section', OLD.id) AND from_section;
    RETURN OLD;
  END IF;
  PERFORM unify_issue_section(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_section_replies"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM replies WHERE id = unify_mapped('section_reply', OLD.id)
      AND issue_question_id = unify_mapped('issue_section', OLD.issue_section_id);
    RETURN OLD;
  END IF;
  PERFORM unify_section_reply(NEW); RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mirror_section_media"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM reply_media WHERE id = unify_mapped('section_media', OLD.id)
      AND reply_id = unify_mapped('section_reply', OLD.section_reply_id);
    UPDATE replies SET photo_url = NULL
     WHERE id = unify_mapped('section_reply', OLD.section_reply_id) AND photo_url = OLD.url;
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
