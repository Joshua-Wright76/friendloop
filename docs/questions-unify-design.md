# Questions, unified: design

Status: design only, not built. Branch `questions-unify`, on top of PR #53 (answers autosave).

## The idea

Questions and sections (with events and birthdays placed as sections) become **one list of things
to ask**. Each item has:

- an **answer format**: written (text plus one photo or a voice note), poll, photo wall (up to six
  captioned photos), or music link (link plus caption);
- a **frequency**: every round, takes turns (rotates through the queue), or on a date (an event or
  a birthday);
- an optional emoji, description and admin-only flag;
- one way to stop: **Stop asking**, with **Ask again** from a folded "Stopped" list.

`questions`, `issue_questions` and `replies` survive (comments and reactions already point at
`replies.id`). Sections, events and their answers are copied in **keeping their UUIDs**. So a reply
sheet loaded before the deploy still saves (its `issueSectionId` is now a valid `issueQuestionId`),
the copy is an idempotent upsert on `id`, the event claim-once index keeps working, and issue anchors
and album keys stay put.

## Target schema

```sql
-- new enums (new types, so their values are usable inside the migration transaction;
-- ALTER TYPE question_kind ADD VALUE would not be)
CREATE TYPE answer_format AS ENUM ('written', 'poll', 'photo_wall', 'music');
CREATE TYPE ask_frequency AS ENUM ('every_round', 'rotating', 'on_date');

-- questions: the pool, now holding every kind of ask
ALTER TABLE questions
  ADD COLUMN format              answer_format,                 -- filled from kind by trigger; NOT NULL at contract
  ADD COLUMN frequency           ask_frequency NOT NULL DEFAULT 'rotating',
  ADD COLUMN emoji               text,
  ADD COLUMN description         text,
  ADD COLUMN admin_only          boolean NOT NULL DEFAULT false,
  ADD COLUMN date_kind           event_kind,                    -- on_date only: 'once' | 'birthday'
  ADD COLUMN month integer, ADD COLUMN day integer, ADD COLUMN year integer,
  ADD COLUMN about_membership_id uuid REFERENCES memberships(id) ON DELETE CASCADE, -- birthday person
  ADD COLUMN skipped_dates       date[] NOT NULL DEFAULT '{}';  -- occurrences the owner took out of a round
-- `position` = order within its frequency group; for 'rotating' it IS the queue (see Rotation).
-- Stopped ⇔ archived_at IS NOT NULL. Until the contract PR, `active` only means "code from before
-- the switch may treat this as a question": new code writes it true for rotating written/poll
-- items only, so a rollback never asks a photo wall as a question. `kind`, `skip_next` and
-- `question_cursor` are retired.

-- issue_questions: the round's frozen snapshot of each ask
ALTER TABLE issue_questions
  ADD COLUMN format              answer_format,
  ADD COLUMN emoji               text,
  ADD COLUMN description         text,
  ADD COLUMN admin_only          boolean NOT NULL DEFAULT false,
  ADD COLUMN occurrence_date     date,                          -- was issue_sections.event_date
  ADD COLUMN about_membership_id uuid REFERENCES memberships(id) ON DELETE CASCADE, -- frozen; hides the card from its subject
  ADD COLUMN from_section        boolean NOT NULL DEFAULT false; -- history marker, like added_after_delivery
CREATE UNIQUE INDEX issue_questions_occurrence_idx ON issue_questions (question_id, occurrence_date);

-- replies: one row per person per ask, whatever the format
ALTER TABLE replies ADD COLUMN link_url text, ADD COLUMN link_provider text;
CREATE TABLE reply_media (                                      -- photo-wall photos
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id uuid NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
  url text NOT NULL, caption text, position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reply_media_reply_idx ON reply_media (reply_id);
```

`from_section` exists only so past issues look as they did: such a row renders as a section card
always has (shown even when empty, note paper, section tape order, `section-<id>` and
`section-reply-<id>` anchors, `sections` in the export). New rows never set it; in new rounds the
format alone decides layout.

"Is an answer" (`reply-query.ts`) becomes one rule: non-blank text, or a photo, voice note, poll
pick, music link or `reply_media` row, and not `never_sent`.

## Migration sequence

Today's code would show copied rows twice (section answers as question answers, photos twice in the
album) and its sync would delete them. So the code serving while the copy runs must already ignore
them. Four deploys:

| PR | Migration (runs while the previous code still serves) | Code that goes live |
| --- | --- | --- |
| **A. Expand and tolerate** | `0022`: the enums, columns and table above, plus a `BEFORE INSERT` trigger filling `format` from `kind`. No data. | Same behaviour; every read of `issue_questions`/`replies` goes through `legacyAskCondition()` (`NOT from_section AND format IN ('written','poll')`), pool reads add `active = true`. Adds the golden test (below). |
| **B. Copy and switch** | `0023`: lock the legacy tables, install mirror triggers, copy, turn "all questions" loops' items into every-round, rewrite the cursor as queue order. | The unified model everywhere: rounds, sheet, issue, print, share, email, album, export, erasure. Writes go only to surviving tables. The old owner page runs on thin adapters. |
| **C. Questions page** | none | This round / Up next / one add card / Stop asking. Deletes adapters and skip UI. |
| **D. Contract** (a week later) | `0024` (`-- expand-contract: yes`): drop triggers, the five legacy tables, `skip_next`, `kind`, `questions.active`, both `question_cursor`s, #53's `status`/`submitted_at`; `format` NOT NULL. | Removes the `sectionDraft`/`sectionMusic`/`/section-media` aliases and `legacyAskCondition`. |

**Writes during the window.** `deploy-migrate.mjs` runs migrations in one transaction, and the
explicit `LOCK TABLE` (SHARE ROW EXCLUSIVE: blocks writes, not reads) makes a section save from
PR-A code wait a second for the copy to commit; then the trigger mirrors it. Nothing written between
migration and go-live is lost, and no later catch-up is needed. The triggers stay until PR-D, so if
B is rolled back, A's legacy writes keep mirroring and rolling forward needs no catch-up either. The
one cost: while rolled back, A doesn't show what B wrote in its minutes live (stored, not visible).

**Reply links mid-round.** A sheet loaded under A posts `sectionDraft`/`sectionMusic` or uploads to
`/section-media` with ids that now exist in `issue_questions`; B routes them to the unified writers,
and reads unsaved text left under the old `friendloop-extra:` localStorage key.

### `0023` sketch

```sql
LOCK TABLE sections, events, issue_sections, section_replies, section_media IN SHARE ROW EXCLUSIVE MODE;

-- One upsert per legacy row, shared by the copy and the triggers. Copied pool rows get
-- active = false, so code from before the switch never puts them in a round; their
-- real state lives in archived_at.
CREATE FUNCTION unify_section(s sections) RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, archived_at, kind, format, frequency,
                         emoji, description, admin_only, created_at)
  VALUES (s.id, s.group_id, s.title, s.position, false,
          coalesce(s.archived_at, CASE WHEN NOT s.active THEN now() END),   -- "Include" unticked = stopped
          'written', (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
          'every_round', s.emoji, s.description, s.admin_only, s.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only,
    archived_at = CASE WHEN excluded.archived_at IS NULL THEN NULL
                       ELSE coalesce(questions.archived_at, excluded.archived_at) END $$;

CREATE FUNCTION unify_event(e events) RETURNS void LANGUAGE sql AS $$
  INSERT INTO questions (id, group_id, text, position, active, kind, format, frequency, emoji,
                         date_kind, month, day, year, about_membership_id, created_at)
  VALUES (e.id, e.group_id, coalesce(e.title, ''), 0, false, 'written', 'written', 'on_date', e.emoji,
          e.kind, e.month, e.day, e.year, e.membership_id, e.created_at)
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, emoji = excluded.emoji, month = excluded.month,
    day = excluded.day, year = excluded.year, about_membership_id = excluded.about_membership_id $$;

CREATE FUNCTION unify_issue_section(s issue_sections) RETURNS void LANGUAGE sql AS $$
  INSERT INTO issue_questions (id, issue_id, question_id, text, position, kind, format, emoji,
                               description, admin_only, occurrence_date, about_membership_id, from_section)
  SELECT s.id, s.issue_id, coalesce(s.section_id, s.event_id), s.title,
         1000 + s.position,                               -- after every question, in section order
         'written', (CASE s.kind WHEN 'standard' THEN 'written' ELSE s.kind::text END)::answer_format,
         s.emoji, s.description, s.admin_only, s.event_date,
         (SELECT e.membership_id FROM events e WHERE e.id = s.event_id AND e.kind = 'birthday'), true
  ON CONFLICT (id) DO UPDATE SET text = excluded.text, position = excluded.position, emoji = excluded.emoji,
    description = excluded.description, admin_only = excluded.admin_only $$;

CREATE FUNCTION unify_section_reply(r section_replies) RETURNS void LANGUAGE sql AS $$
  INSERT INTO replies (id, issue_id, issue_question_id, membership_id, body, link_url, link_provider,
                       status, submitted_at, added_after_delivery, never_sent, created_at, updated_at)
  VALUES (r.id, r.issue_id, r.issue_section_id, r.membership_id, r.body, r.link_url, r.link_provider,
          r.status, r.submitted_at, r.added_after_delivery, r.never_sent, r.created_at, r.updated_at)
  ON CONFLICT (id) DO UPDATE SET body = excluded.body, link_url = excluded.link_url,
    link_provider = excluded.link_provider, added_after_delivery = excluded.added_after_delivery,
    never_sent = excluded.never_sent, updated_at = excluded.updated_at $$;

-- A standard section's one photo becomes the answer's photo_url; photo-wall photos (and any
-- extra a standard section got through the count-then-insert race) become reply_media rows.
CREATE FUNCTION unify_section_media(m section_media) RETURNS void LANGUAGE sql AS $$
  UPDATE replies r SET photo_url = m.url
    FROM section_replies sr JOIN issue_sections s ON s.id = sr.issue_section_id
   WHERE sr.id = m.section_reply_id AND r.id = sr.id AND s.kind = 'standard' AND r.photo_url IS NULL;
  INSERT INTO reply_media (id, reply_id, url, caption, position, created_at)
  SELECT m.id, m.section_reply_id, m.url, m.caption, m.position, m.created_at
   WHERE NOT EXISTS (SELECT 1 FROM replies r WHERE r.id = m.section_reply_id AND r.photo_url = m.url)
  ON CONFLICT (id) DO UPDATE SET caption = excluded.caption, position = excluded.position $$;

-- Triggers: AFTER INSERT OR UPDATE → unify_<table>(NEW); AFTER DELETE → delete the row with
-- OLD.id from the twin table (for section_media: delete reply_media OLD.id, and clear
-- replies.photo_url where it equals OLD.url). Sketch for one table:
CREATE FUNCTION mirror_section_replies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM replies WHERE id = OLD.id; RETURN OLD; END IF;
  PERFORM unify_section_reply(NEW); RETURN NEW;
END $$;
CREATE TRIGGER section_replies_mirror AFTER INSERT OR UPDATE OR DELETE ON section_replies
  FOR EACH ROW EXECUTE FUNCTION mirror_section_replies();
-- …same for sections, events, issue_sections, section_media.

-- The copy, parents first.
SELECT unify_section(s) FROM sections s;
SELECT unify_event(e) FROM events e;
SELECT unify_issue_section(s) FROM issue_sections s;
SELECT unify_section_reply(r) FROM section_replies r;
SELECT unify_section_media(m) FROM section_media m ORDER BY m.position, m.created_at;

-- "All questions" loops: everything was already asked every round; now say so.
UPDATE questions q SET frequency = 'every_round' FROM groups g
 WHERE g.id = q.group_id AND g.questions_per_round IS NULL AND q.frequency = 'rotating' AND q.active;

-- The queue is the order: renumber each loop's legacy pool so it starts at the cursor, and move
-- the cursors so code from before the switch selects the same questions during the window.
WITH pool AS (
  SELECT q.id, q.group_id, g.question_cursor AS cur,
         row_number() OVER w - 1 AS idx, count(*) OVER (PARTITION BY q.group_id) AS n
    FROM questions q JOIN groups g ON g.id = q.group_id
   WHERE q.active AND q.archived_at IS NULL
  WINDOW w AS (PARTITION BY q.group_id ORDER BY q.position, q.created_at))
UPDATE questions q SET position = ((p.idx - p.cur) % p.n + p.n) % p.n FROM pool p WHERE q.id = p.id;
UPDATE issues i SET question_cursor = ((i.question_cursor - g.question_cursor) % c.n + c.n) % c.n
  FROM groups g, (SELECT group_id, count(*) n FROM questions WHERE active AND archived_at IS NULL
                  GROUP BY group_id) c
 WHERE i.status = 'open' AND g.id = i.group_id AND c.group_id = g.id;
UPDATE groups SET question_cursor = 0;
```

Before merging B, run on a production branch: standard-section replies with more than one media row
(expected 0), and row counts of legacy vs unified after a dry run of `0023` on a Neon branch.

**Past issues stay exact** through a golden test PR-A adds first: it seeds every legacy shape
(standard section with photo, photo wall, music, once event, birthday, admin-only, added late,
`never_sent`, poll, suggestion credit) and snapshots `loadIssue` as member, admin and share, the
print view, the album and both exports. PR-B must pass it unchanged.

## Events and birthdays

An event is an ask **on a date**: a once event stores `month/day/year`; a birthday stores
`about_membership_id` with empty `text`, so "Maya's birthday" is titled from her current name when
the round opens, as today. Placement keeps today's rules (`issueCoverage`, claimed once via
`(question_id, occurrence_date)`, placed at once when added mid-round, re-placed on carry-over).
New: any format (a birthday photo wall); the subject is frozen on the snapshot, so the birthday
person never sees their card even after the event is deleted (today they would); taking an
occurrence out of This round records it in `skipped_dates` so carry-over doesn't put it back.

## Rotation and Up next

The hidden cursor goes: **rotating items ordered by `position` are the queue.** Opening a round
(scheduled or Send now, inside the group-locking transaction) takes the first N rotating items and
moves them to the back (`position = max + 1`), then every-round items in order, then dated
occurrences in coverage by date. N is `questions_per_round` (null = all). Edits are direct
operations; `syncOpenRoundQuestions`/`syncOpenRoundSections` go away:

| Action | Effect |
| --- | --- |
| Add to this round (new, or pulled from Up next) | snapshot inserted at the index; a rotating item goes to the back |
| Remove from this round | refused once anyone has written there; else the snapshot and empty rows go. A rotating item goes to the **front** (what skip meant); a dated one goes into `skipped_dates` |
| Reorder this round / Up next | this round only / queue positions |
| Edit wording, emoji, description, admin-only | pool row, plus the open snapshot unless someone wrote there (K8 rule); format is locked once anyone wrote |
| Change frequency | to every round: also added now; to takes turns: back of the queue |
| Stop asking / Ask again | sets / clears `archived_at`; stopping removes it from this round if unanswered |

Up next is a pure `planRounds()` in `src/lib/round-plan.ts` (queue, N, every-round and dated items,
`nextSlot`, `issueCoverage`): the next round in full, then later rounds until every rotating item has
appeared once (at most six), each with its date and the dated items it catches.

## The Questions page

```
Questions
┌ This round asks ─────────────── Round 12 · goes out Fri 21 Nov, 9:00 ┐
│ ⠿ 1  What made you laugh this week?        Takes turns       🗑     │
│ ⠿ 2  📊 Tea or coffee?                      Takes turns       🗑     │
│ ⠿ 3  📸 Photo wall                          Every round       🗑     │
│ ⠿ 4  🎵 Song of the week                    Every round       🗑     │
│ ⠿ 5  🎂 Maya's birthday                     14 Nov      Sam wrote: stays │
│ [ + Add to this round ]                                              │
└──────────────────────────────────────────────────────────────────────┘
┌ Up next ───────────────── Each round asks [2 ▾] that take turns ┐
│ Round 13 · Fri 28 Nov    ⠿ What are you reading?                 │
│                          ⠿ A small win this week?                │
│                          🎉 Camping weekend (29 Nov)             │
│ Round 14 · Fri 5 Dec     ⠿ Where would you teleport?             │
│                          ⠿ What made you laugh…   (asked now)    │
│ Every round              ⠿ 📸 Photo wall · ⠿ 🎵 Song of the week │
│ On a date                🎂 Sam · 2 Jan   🎉 Camping · 29 Nov    │
│ [ + Add a question ]                                             │
└──────────────────────────────────────────────────────────────────┘
▸ Suggestions (2)        ▸ Stopped asking (3)
```

- Tapping a row opens it in place: text, format, frequency (date or person for "on a date"), emoji,
  description, admin-only, **Stop asking**.
- **One add card**: format and frequency under the text field, pack ideas folded beneath (C6
  survives). Default frequency: takes turns if the loop has any turn-takers, else every round.
- Drag handles with tap-for-Up/Down and keyboard pickup (WCAG 2.5.7), the idea of the old rework's
  `sortable-list.tsx`, not its code. A row someone wrote in shows a reason instead of the trash icon.
- Server Actions as today, returning the saved order like `reorderQuestions`, then
  `revalidatePath` on the loop layout; nothing new from Next.

**Reply sheet.** One list in round order, one jump list, no "And a little extra". Each card shows
emoji and description; the body follows the format (written: text plus photo or voice, so former
standard sections gain voice; poll; photo wall; music). Admin-only cards are hidden from members and
a birthday card from its subject, on the sheet, in prompts and in the delivery email. **Two existing
bugs get fixed:** admin-only section answers go into every member's delivery email today, and a
round holding only sections sends no prompt (`questionCount === 0`).

## What changes, by file

- **Schema**: `src/db/schema.ts`, `drizzle/0022`–`0024`, `e2e/support/db.ts` (+`reply_media`).
- **Rounds**: `round-questions.ts` (rewritten: `snapshotRound` + edit operations), `question-rotation.ts`
  → `round-plan.ts`, `rounds.ts` (one block list, per-member email filter, no skip reset), `events.ts`
  (writes `issue_questions`), `notify.ts` and `reminders.ts` (count every visible item).
- **Answers**: `reply-query.ts`, `answered.ts`, `reply.ts` (+music, photo-wall writers), `sections.ts`
  → `music.ts`, `api/reply/[token]/route.ts`, `photo/route.ts`, `section-media/route.ts` (alias until D).
- **Reading**: `issue-view.ts`, `issue-reading.ts`, `issue-body.tsx`, `issue-print.tsx`, `i/[id]/page.tsx`,
  `s/[token]/page.tsx`, `album.ts` (`reply_media` branch), `data-export.ts`, `rounds-by-member.ts`,
  `email/templates.ts` (`sectionsHtml` folds into answers).
- **Erasure**: `erasure.ts` (birthday snapshots via `about_membership_id`, files from `reply_media`),
  `media-cleanup.ts`, and its integration test (seed the new membership FKs).
- **Owner UI (C)**: `g/[id]/questions/*` rebuilt (`events-panel.tsx`, `question-order.tsx` deleted),
  `layout.tsx`/`loop-data.tsx`, `manage.ts` (frequency, stop/ask again, no `toggleSkipNext`),
  `suggestions.ts`.
- **Sheet**: `reply-sheet.tsx`, `r/[token]/page.tsx`, `poll-card.tsx`. Also `ui-preview.ts`,
  `email/previews.ts`, `copy.json`.
- **Specs**: architecture §13 (the queue), §14, §17, §18, §24; PRODUCT.md (pool line).
- **Flows**: C1–C3, C5, C6 rewritten; C4 becomes "Edit this round"; new C7 "Up next"; K1, K2, K8
  merge into C1/C4 and their specs go; K3–K7 stay as answer-format flows (K7 adds the email check);
  L1, O1–O4, D9, P1 reworded. `check:flows --strict` stays green.
- **Tests**: `round-plan` unit tests; a `0023` integration test (seed legacy, migrate, compare, then
  write via legacy SQL and assert the mirror); the golden test; `sections.integration` and
  `sweep.sections` fold into question tests.

## What the user loses

- "Skip this round" (replaced by removing from This round) and "Include in future issues" (replaced
  by Stop asking / Ask again; unticked sections arrive stopped).
- The "All questions" setting (those loops' questions become every round), "And a little extra",
  and the "Sections and dates" tab.
- Reordering This round doesn't carry forward; every-round order lives in Up next.
- Up next is a projection: later edits or a carried-over round move it.

## Open questions for you

1. **Reactions and comments on former section answers.** Photo walls, music picks and birthday notes
   become `replies`, so they can take reactions and comments, past ones included. Should that apply
   everywhere (recommended), or only from new rounds on?
2. **Empty every-round items in new rounds.** Should they be hidden like unanswered questions
   (recommended), or keep the "Nobody added anything" card? Past issues keep their look either way.
3. **Data export.** Keep `sections` / `sectionAnswers` for history and add `format` to `questions`
   (recommended, since past rounds export exactly as before), or use one shape for everything?
4. **Where a removed turn-taker goes.** First in line (recommended, it's what skip did), or the back
   of the queue?

## PR split

A (expand and tolerate, small) → B (copy and switch the data layer, sheet and reading; large but
mostly deletions) → C (Questions page) → D (contract, a week after C). B and C can be reviewed side by
side, but B must be live before C merges.
