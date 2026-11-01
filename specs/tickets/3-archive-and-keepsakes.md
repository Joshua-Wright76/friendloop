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
| O1 | Add an event | Owner adds a one-time event or an annual birthday tied to a member, with title, emoji, and date; it lists under upcoming events. | todo |
| O2 | Event lands in the right issue | The sweep places an event inside the issue whose window contains its date; the issue gains an event section; contributors see it on the sheet and can reply with messages + a photo. | todo |
| O3 | Birthdays recur | A birthday generates a section in exactly one issue per year (the issue whose window contains the date, loop timezone, DST-safe via the existing slot logic). | todo |
| O4 | Past truth | A delivered issue's event section keeps its original title and placement even if the event is later edited or deleted. | todo |

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
| P1 | Browse the album | A member opens the Album and sees all media from delivered issues newest-first, grouped, with a fullscreen viewer and "view in issue" deep links. | todo |
| P2 | Filter and search | Filtering to one member and searching a word in answers/captions/questions both narrow the gallery correctly; an empty state says so plainly. | todo |
| P3 | Privacy holds | Share-link visitors get no Album route or data; media URLs already content-hashed remain unguessable. | todo |

## Part Q · Keepsake export

Letterloop exports any delivered issue as a PDF; StoryWorth prints hardcover
books; Famileo mails a printed gazette. The keepsake instinct is category-
defining — and everywhere else it is the paid tier, so free is the point.

- **Issue PDF (this ticket)** — a print-styled rendering of a delivered issue
  (questions, answers, photos, voice-note cards, poll tallies, credits),
  produced client-side from a `?print` view so the free-tier constraint stays
  untouched. Reader's "Save as PDF" is the mechanism; a dedicated print
  stylesheet with page-break control is the work.
- **Year book (explicit stretch, likely never as print fulfillment)** — an
  annual compilation view; only if a self-serve print partner with no monthly
  cost appears.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| Q1 | Print an issue | On a delivered issue, "print" opens the print view: no chrome, page breaks between questions, media sized to not split, both color schemes print as the light paper. | todo |
| Q2 | Late edits stay true | The print view reflects the web issue's current canonical state, including post-delivery additions marked as late. | todo |

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
| R1 | Issue names | Owner names an issue; dashboard, email subject, and web issue show it; unnamed issues keep their number. | todo |
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
- **Shipping shape:** one PR per part, stacked, each green on `npm run verify`.
