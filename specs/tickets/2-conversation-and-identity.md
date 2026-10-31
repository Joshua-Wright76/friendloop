# Ticket 2 · Conversation and identity (ship second)

Polls · richer comments · loop personality (custom themes) and lifecycle.
Research origin: competitive scan #7, #9, #10 (Letterloop help center, Cuttles,
Mayo). Depends on nothing from Ticket 1 except shared storage conventions.

## Part L · Polls

Letterloop builds multiple-choice polls in the question bank, in upcoming and
in-progress issues, and from the question-request flow; reactions work on
delivered polls. `PRODUCT.md` scopes polls out of v1 — this ticket is the
decision to add them as a question kind, not a separate object.

- A poll is authored like a question: prompt text + 2–6 options, single choice.
- Contributors answer by tapping; the delivered issue shows each member's
  choice (attribution identical to written answers) plus a quiet tally.
- Polls enter the pool, rotation, and issue snapshots through the same
  machinery as questions — no parallel pipeline.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| L1 | Author a poll | Owner adds a poll question with options; it appears in the pool, can be reordered, archived, and rotated like any question. | todo |
| L2 | Answer a poll | A contributor picks one option on the reply sheet, can change it until delivery, and the tally never reveals partial results before delivery. | todo |
| L3 | Read a poll | The delivered issue shows every member's choice next to their name with a total tally; share-link visitors see the same. | todo |

## Part M · Richer comments

Letterloop comments support @mentions, quoted replies, media attachments, an
owner commenting toggle, and threads on individual replies. Friendloop has
issue-level plain comments and per-answer reactions.

Slices, cheapest first:

1. **Mentions** — `@` completes member names, resolves to a membership, and the
   mentioned member gets an email (new outbox kind). Rendered as their name.
2. **Commenting toggle** — owner can turn comments off for the loop.
3. **Per-answer threads** — comments can attach to a specific answer, not only
   the issue.
4. **Quoted replies and media in comments** — reply-with-quote and photo
   attachments in the comment composer.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| M1 | Mention a member | Typing @ offers matching member names; the saved comment stores the membership reference; the mentioned member receives exactly one email with a link to the issue, deduped by outbox key. | todo |
| M2 | Toggle comments | With commenting off, comment surfaces disappear for everyone and the API rejects writes; past comments stay stored, and re-enabling restores them. | todo |
| M3 | Answer threads | A comment can be posted on a specific answer; it renders with that answer and never appears in the issue-level thread. | todo |
| M4 | Quote and attach | Replying to a comment quotes it into the composer; a comment can carry one photo under the same media caps as answers. | todo |

## Part N · Loop personality and lifecycle

The owner can make the loop recognizably theirs, and the loop can outlive its
founder.

**Custom themes (the priority).** Letterloop offers presets with logo, colors,
fonts, divider style, and header image per loop. Friendloop's Gingham Picnic is
deliberate and stays the default; themes are owner-chosen variations, not a
design free-for-all:

- A small set of curated presets (stationery-world siblings of Gingham
  Picnic), plus accent color and header image overrides.
- Themes apply to the dashboard, reply sheet, web issue, and email header —
  one token set, light and dark both tuned, contrast checked (`DESIGN.md`
  rules hold: no hover-only affordances, 200% zoom survives).
- The brand frame (voice, Gaegu/Nunito default, card conventions) is not
  owner-editable. Warmth stays in the words; the owner changes the paper,
  not the prose.

**Lifecycle.** Ownership transfer to an existing member (Letterloop parity);
delivered-issue rename before or after delivery; member profile photos used in
issues, comments, and the dashboard.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| N1 | Choose a theme | Owner picks a preset (and optional accent/header overrides); every member's surfaces — dashboard, sheet, issue, email header — render it; light and dark both pass contrast checks. | todo |
| N2 | Default stays Gingham | A loop created before themes exists renders exactly as today until its owner changes anything. | todo |
| N3 | Transfer ownership | The owner promotes an existing admin to owner; the founder becomes an admin; owner-only actions move; the old owner cannot transfer back without the new owner. | todo |
| N4 | Rename an issue | Owner sets an issue name (e.g. "Camping weekend"); it shows in the dashboard list, the delivery email subject, and the web issue. | todo |
| N5 | Profile photos | Members set a photo; it renders in replies, comments, and the member list; absence falls back to the existing initials treatment. | todo |

Design notes

- Themes as a token set in `theme.ts` (already exists for dark/light), stored
  per group; email templates read the same tokens so the email header matches.
- `emailKindEnum` gains a mention-notification kind; dedupe key
  `mention:issue:comment:membership` keeps a retried cron from double-pinging.
- Transfer is a single guarded action with confirmation naming the new owner;
  sessions and reply tokens are untouched by the handover.

## Non-goals for this ticket

Polls with multiple selections or weighted votes; comment search or editing
windows beyond today's behavior; fully custom fonts/colors per loop; themes on
the sign-in surface; member-visible theme voting.

## Open questions

Confirm before implementation: do polls accept "pick exactly one" only (yes,
recommended); do mentions notify readers too (recommended: yes, they can be
mentioned in comments but still cannot suggest or reply).
