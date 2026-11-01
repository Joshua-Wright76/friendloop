# Ticket 3 · Archive and keepsakes (ship third)

Events & birthdays · the Album · keepsake export · reading and delivery
controls. Research origin: competitive scan #2, #3, #4, #8 (Letterloop help
center, ShareLocket, StoryWorth, Famileo). Builds on Ticket 1's media storage
and sections; the Album is intentionally not attempted before voice and
sections exist, or it ships half-empty.

## Part O · Events and birthdays

Letterloop keeps an events list — one-time milestones and annual birthdays tied
to a member — and any event falling inside an issue's window becomes a 🎉
section the group writes messages and attaches photos to.

Friendloop mapping: events are a loop-level list; the sweep, which already
snapshots questions and sections into a new issue, also snapshots any event
whose date falls in the issue's window (`opensAt … deliversAt`, loop timezone).
Birthday events recur annually and reference a membership; the section title
carries the member's name. Owner/admin manage all events; letting regular
contributors add their own events is a later option, off by default.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| O1 | Add an event | Owner adds a one-time event or an annual birthday tied to a member, with title, emoji, and date; it lists under upcoming events. | done |
| O2 | Event lands in the right issue | The sweep places an event inside the issue whose window contains its date; the issue gains an event section; contributors see it on the sheet and can reply with messages + a photo. | done |
| O3 | Birthdays recur | A birthday generates a section in exactly one issue per year (the issue whose window contains the date, loop timezone, DST-safe via the existing slot logic). | done |
| O4 | Past truth | A delivered issue's event section keeps its original title and placement even if the event is later edited or deleted. | done |

Design notes (shipped)

- `events` + two columns on `issue_sections` (`event_id`, `event_date`), migration
  `0009_events`. An event section is an ordinary standard section snapshot, so the
  sheet, the issue and the email needed no new rendering; see `specs/architecture.md` §17.
- A birthday stores month and day only; the section is titled "<Name>'s birthday" from
  the member's name at snapshot. A one-time event stores its full date and may not be
  created in the past.
- The calendar lives on the Questions tab (owner and admins), beside Sections.
- Everyone, the birthday person included, sees the section on their sheet; the copy
  reads "Leave Alice a note or a photo", and the round reaches them like everyone else.
- A date between two rounds (window shorter than cadence) lands in the round that is
  open when it approaches. Dates the sweep never reached (pause, outage) are not backfilled.

## Part P · The Album

Letterloop's Album gathers all reply media across delivered issues into one
members-only gallery; ShareLocket's whole pitch is the same idea grown into a
smart archive. Friendloop's version, in slices:

1. **Gallery** — every photo and voice note from delivered issues, one loop,
   newest first, grouped by issue or date; fullscreen viewer; "view in issue".
2. **Filter by member** — see one person's contributions across the year.
3. **Search** — text search over answer text, captions, and question text.
   (People/places/date recognition and transcripts are explicitly not in this
   ticket; the voice notes stay playable, not searchable by content.)

Members-only, never exposed to share links. The Album is a read surface; it
collects nothing new.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| P1 | Browse the album | A member opens the Album and sees all media from delivered issues newest-first, grouped, with a fullscreen viewer and "view in issue" deep links. | done |
| P2 | Filter and search | Filtering to one member and searching a word in answers/captions/questions both narrow the gallery correctly; an empty state says so plainly. | done |
| P3 | Privacy holds | Share-link visitors get no Album route or data; media URLs already content-hashed remain unguessable. | done |

Design notes (shipped)

- No migration: the Album is one read-only query (`src/lib/album.ts`) over what is
  already stored — `replies.photo_url`/`audio_url` and `section_media` — joined to
  delivered issues of the one loop. See `specs/architecture.md` §18.
- Two doors, one page. Signed-in members get the **Album** tab at `/g/<id>/album`;
  anyone who reads from their inbox opens `/album/<id>?m=<reply token>` (the same
  viewer check as `/i/<id>`: a session or the token, never revoked). Every delivered
  round links to it ("See the album") for people who recognise themselves. Share links
  open nothing here, and `/s/<token>` carries no link to it.
- Grouped by round, newest first, then in the order the round shows them (questions,
  then sections). Paged by growing the page count in the URL (`?pages=2`, 24 at a time,
  capped at 40 pages): server-rendered, no script until someone opens a photo.
- Filters are a plain GET form: **From** (one member, including anyone who has since
  left) and **Search** (every word must match somewhere in the answer text, the photo
  caption, or the question / section title; wildcard characters are literal). Voice
  notes match by their written words only.
- Included: answer photos, voice notes, photo-wall and section photos from submitted
  answers of delivered rounds, late additions too. Left out on purpose: comment photos,
  profile photos, the header picture (not reply media), anything from an open round,
  drafts, and admin-only sections for anyone but owner and admins (as in the round itself).
- The viewer is a native modal `<dialog>`: focus trap, Escape, inert page and focus return
  come with it; arrow keys and visible previous/next buttons move between photos. "View in
  the round" links to `/i/<id>#answer-<id>` (`#section-reply-<id>` for sections); those
  anchors are new on the web issue.
- Media files are served as before — `/uploads/<64 hex>.<ext>` locally, public content-hashed
  Blob URLs in production. The Album never lists a file the member could not already see in
  the round, and adds no way to enumerate files without it.

## Part Q · Keepsake export

Letterloop exports any delivered issue as a PDF; StoryWorth prints hardcover
books; Famileo mails a printed gazette. The keepsake instinct is category-
defining — and everywhere else it is the paid tier, so free is the point.

- **Issue PDF (this ticket)** — a print-styled rendering of a delivered issue
  (questions, answers, photos, voice-note cards, poll tallies, credits),
  produced client-side from a `?print` view so the free-tier constraint stays
  untouched. Reader's "Save as PDF" is the mechanism; a dedicated print
  stylesheet with page-break control is the work. **Shipped** (see design
notes below).
- **Year book (explicit stretch, not built)** — an
  annual compilation view; only if a self-serve print partner with no monthly
  cost appears.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| Q1 | Print an issue | On a delivered issue, "print" opens the print view: no chrome, page breaks between questions, media sized to not split, both color schemes print as the light paper. | done |
| Q2 | Late edits stay true | The print view reflects the web issue's current canonical state, including post-delivery additions marked as late. | done |

Design notes (as built)

- **One address, one switch.** `/i/<id>?print` and `/s/<token>?print` render the same
  `loadIssue` view through a server component (`issue-print.tsx`) instead of the
  interactive body, so there is no copy of the round to go stale (Q2 falls out of
  that) and no server-side PDF generation or dependency: "Save as PDF" in the
  browser's print window is the mechanism. The only client code is a button that
  calls `window.print()` on click; the view never prints itself, because a mail
  scanner prefetching the link would otherwise print too.
- **Delivered only.** An open round has no print action, and `?print` on one just shows
  the round (no redirect, nothing to leak). Share links already only exist for
  delivered rounds and honour "sharing off" like the share page.
- **Always light paper.** `.print-sheet` re-declares every colour token
  (`printThemeCss`): the loop's own *light* scheme (so a preset's ink and accent
  survive, and its contrast guarantees still apply) with page, card and field forced
  white, no gingham check and no shadow. The html dark tokens never reach it, in
  print or on screen. Header image prints if the loop has one.
- **Names, not "You".** The view is loaded as nobody in particular, so authors and
  comment authors are named; a keepsake is read by someone else. Admin-only sections
  follow the web rule (shown only if the opener is an owner or admin).
- **What is on paper.** Question answers, photos (alt text always set), voice notes as
  a card with the duration (audio cannot print), poll picks plus tally as numbers (the
  bar is decoration), "asked by" credits, standard sections, photo walls with
  captions, music picks as title, provider and the link text, reactions as a words line
  ("Reactions: ❤️ 2"), the issue thread, and each answer's thread under its answer.
  Sections nobody wrote in are left out (nothing to keep); questions without answers
  already were. Comments appear exactly when the web round shows them.
- **Page control.** `@media print`: each question or section starts a page (except the
  first, which follows the masthead), and answers, figures, cards, comments and the
  poll never split. Long answers still flow across pages. Photos are capped at 6.4in
  tall; the wall is two-up.
- **Known quirk, not changed here.** Submitting after delivery flags all of the
  submitter's section answers as added late (existing `submitFor` behaviour); the print
  view faithfully mirrors the web round, so it does too.


## Part R · Reading and delivery controls

Letterloop: filter past issues to one member, sort responses by name, set
issue names, choose reminder preferences per member (all / last-only / none),
choose individual vs group email delivery, and deliver responses all-at-once
or one-by-one. Friendloop gets the pieces that fit its "no nagging" brand;
group-chain delivery is not one of them (deliverability and the single-sender
commitment matter more than reply-all nostalgia).

- Issue names and per-member filter/sort (reading utilities).
- Reminder preferences per member: all reminders / final reminder only / none.
  The existing single automatic 48h reminder becomes schedule-shaped: the loop
  may send a 48h and a 24h reminder, each respecting the recipient's choice;
  manual owner nudges stay exactly as they are and are not affected.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| R1 | Issue names | Owner names an issue; dashboard, email subject, and web issue show it; unnamed issues keep their number. **Shipped in Ticket 2 as flow N4**; Part R reuses that spec and adds no new flow. | done |
| R2 | Find one member's answers | The dashboard's past-issues list filters to a delivered issue, and inside an issue a member's answers can be isolated (their name highlights the column; sorting groups answers by member). | todo |
| R3 | Reminder preferences | Each contributor picks all / last-only / none; the sweep sends accordingly, never duplicates across reminders or runs, and the owner's manual nudge still reaches everyone who hasn't submitted. | todo |
| R4 | One-by-one delivery (stretch) | Owner can switch the loop to deliver each response as it arrives; emails dedupe per reply; switching mid-issue applies forward only. | todo |

## Non-goals for this ticket

Print fulfillment as a business; transcripts or content-based media search;
group-email-chain delivery; events editable by all members; cross-loop
album (the Album is per loop); calendar (.ics) attachments for events.

## Resolved decisions (2026-11)

- **One reminder, with a per-member preference** (all / last-only / none). The
  48h + 24h schedule can land later without changing the preference data.
- **Events** are active in `from_you` loops too, and regular contributors cannot add
  their own (still a later option, off by default).
- **Shipping shape:** one PR per part, stacked, each green on `npm run verify`.
