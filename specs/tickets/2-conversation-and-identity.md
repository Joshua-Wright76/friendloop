# Ticket 2 · Conversation and identity (ship second)

Polls · richer comments · loop personality (custom themes) and lifecycle.
Research origin: competitive scan #7, #9, #10 (Letterloop help center, Cuttles,
Mayo). Depends on nothing from Ticket 1 except shared storage conventions.

## Part L · Polls

Letterloop builds multiple-choice polls in the question bank, in upcoming and
in-progress issues, and from the question-request flow; reactions work on
delivered polls. `PRODUCT.md` scopes polls out of v1 — this ticket is the
decision to add them as a question kind, not a separate object.

- A poll is authored like a question: prompt text + 2–6 options, configured per
  poll as single choice or multiple choice (pick any number, unweighted).
- Contributors answer by tapping; the delivered issue shows each member's
  choice (attribution identical to written answers) plus a quiet tally.
- Polls enter the pool, rotation, and issue snapshots through the same
  machinery as questions — no parallel pipeline.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| L1 | Author a poll | Owner adds a poll question with options (single or multiple choice); it appears in the pool, can be reordered, archived, and rotated like any question. | done |
| L2 | Answer a poll | A contributor picks one option (or several, on a multiple-choice poll) on the reply sheet, can change it until delivery, and the tally never reveals partial results before delivery. | done |
| L3 | Read a poll | The delivered issue shows every member's choice next to their name with a total tally; share-link visitors see the same. | done |

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
| M1 | Mention a member | Typing @ offers matching member names; the saved comment stores the membership reference; the mentioned member receives exactly one email with a link to the issue, deduped by outbox key. | done |
| M2 | Toggle comments | With commenting off, comment surfaces disappear for everyone and the API rejects writes; past comments stay stored, and re-enabling restores them. | done |
| M3 | Answer threads | A comment can be posted on a specific answer; it renders with that answer and never appears in the issue-level thread. | done |
| M4 | Quote and attach | Replying to a comment quotes it into the composer; a comment can carry one photo under the same media caps as answers. | done |

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
| N1 | Choose a theme | Owner picks a preset (and optional accent/header overrides); every member's surfaces — dashboard, sheet, issue, email header — render it; light and dark both pass contrast checks. | done |
| N2 | Default stays Gingham | A loop created before themes exists renders exactly as today until its owner changes anything. | done |
| N3 | Transfer ownership | The owner promotes an existing admin to owner; the founder becomes an admin; owner-only actions move; the old owner cannot transfer back without the new owner. | done |
| N4 | Rename an issue | Owner sets an issue name (e.g. "Camping weekend"); it shows in the dashboard list, the delivery email subject, and the web issue. | done |
| N5 | Profile photos | Members set a photo; it renders in replies, comments, and the member list; absence falls back to the existing initials treatment. | done |

Design notes

- **Polls (shipped).** A poll is a `questions` row with `kind = 'poll'`, plus
  `poll_multiple` and `poll_options`; `issue_questions` snapshots the same three
  columns. A pick is `replies.poll_choices`, a JSON array of option indexes, so the
  existing unique key, submit gate (a pick counts as content), late-reply flag and
  reactions all apply unchanged. A separate votes table would have needed its own
  versions of each. Results are only computed for a delivered issue; before that
  the web issue returns the viewer's own pick and nothing else. Editing a poll in
  the pool is not part of this ticket (archive it and add a new one); issues that
  already went out keep their frozen options either way.
- Themes as a token set in `theme.ts` (already exists for dark/light), stored
  per group; email templates read the same tokens so the email header matches.
- `emailKindEnum` gains a mention-notification kind; dedupe key
  `mention:issue:comment:membership` keeps a retried cron from double-pinging.
- Transfer is a single guarded action with confirmation naming the new owner;
  sessions and reply tokens are untouched by the handover.

### Part M · Design notes (as built)

- **A mention is a reference in the text.** The composer drops `@Name` into the
  box and remembers `{id, label}`; on post the server swaps each still-present
  `@Label` for `@[<membership id>]` and stores that. Rendering resolves the id to
  the member's *current* name, so a rename follows through every old comment and
  two people called "Sam" can never be confused. No separate mentions table: the
  body is the single source of truth, and `mentionIds(body)` is how the email
  step reads it back.
- **Who is mentionable:** every live (non-revoked) member of the loop except the
  author, readers included. Mentioning yourself, a revoked member, or someone in
  another loop is silently dropped: no marker, no email.
- **One email, ever.** The composer picks the comment's UUID; the server inserts
  with that id and `ON CONFLICT DO NOTHING`, so a double click or a retried
  request is the same comment. Mention emails use the outbox dedupe key
  `mention:<issue>:<comment>:<membership>`. A retry of a comment whose email
  never went out repairs it; it never sends a second. Another member cannot
  reuse someone's comment id.
- **Commenting toggle** is `groups.comments_enabled` (default true, so every
  existing loop keeps commenting). Off removes the issue thread, every answer
  thread, and the composers from `/i/<id>`, and `postComment` answers 403; the
  rows stay and come back when it is re-enabled. Share pages never showed
  comments and still don't.
- **Threads hang from question answers** (`comments.reply_id`), which includes
  poll picks (a poll answer is a `replies` row) once the round is delivered.
  Section answers do not get threads: they are group artefacts (a photo wall is
  a grid with no per-person card), and the issue-level thread covers them.
  Deleting an answer's reply row cascades its thread.
- **Quotes** are a live reference (`comments.quote_comment_id`, `ON DELETE SET
  NULL`), not a copy. A quote must be a live comment in the same thread (same
  issue, same answer or both issue-level). If the original is later soft-deleted
  (`deleted_at`), the quote says "A comment that has since been removed" instead
  of echoing it; if the row is hard-deleted the reply just loses its quote.
- **Photos:** one per comment, same type and 5 MB cap as answers, validated by
  signature, stored through `photo-storage`. Comments post through
  `POST /api/issue/<id>/comments` (multipart) rather than a Server Action, for
  the same reason as replies: a real status code and a body larger than 1 MB.
  This path is a single request, so on Vercel the platform's 4.5 MB request
  limit applies to comment photos; the answer path avoids it with direct Blob
  uploads. Moving comments there is the follow-up if that bites.
- **`membershipForViewer` now ignores revoked members** (it used to honour a
  revoked member's reply token for reading and commenting).

### Part N · Design notes (as built)

- **Gingham is the stylesheet, not a preset.** A loop with no stored theme gets
  no overrides at all, so it renders byte-for-byte as it did before (the default
  emails were diffed against the previous release and are identical). Themes
  are three nullable columns on `groups` (`theme_preset`, `theme_accent`,
  `header_image_url`); choosing Gingham with no accent stores nulls, so "back to
  the original" and "never changed it" are the same row.
- **One token set, `src/lib/theme.ts`.** Four curated papers (Bluebell Notebook,
  Meadow Postcard, Marmalade Stationery, Lilac Linen) each hand-tune the
  neutrals (page, card, rules, ink) for light and dark; the accent family is
  *derived* from one hue by `deriveAccent`, which keeps the owner's hue and moves
  lightness until text on the accent, accent text on paper and on its wash, and
  the accent against the card all clear WCAG AA. The owner's own pick and a
  preset's seed take the same path, so there is one place readability is
  guaranteed. Unit tests assert every pairing for every preset and 14 awkward
  accents (white, black, yellow, neon) on every paper, in both schemes.
- **Injection is a validated stylesheet.** Group-aware surfaces (dashboard
  layout, reply sheet, web issue, share view) render `<LoopTheme>`, a `<style>`
  with `html[data-theme="light"]{…}` and `html[data-theme="dark"]{…}`; only
  colours and shadows this module produced from a preset key and a validated hex
  are ever emitted. Fonts, radii and copy are not tokens, so the brand frame is
  not owner-editable. Sign-in and the landing page never render it. The browser's
  `theme-color` stays Gingham's page colour (a tint of browser chrome only).
- **Email reads the same tokens** through `emailPalette` (light scheme only), and
  a header picture is a decorative `<img alt="">` row above the brand line:
  absolute URL, graceful when a client blocks remote images.
- **The header picture and profile photos** reuse `photo-validation` /
  `photo-storage` (signature-checked, random names, Blob in production, replaced
  files deleted after the row stops pointing at them). They upload as multipart
  to small route handlers, so Vercel's 4.5 MB request limit sets the caps: 4 MB
  for the header, 2 MB for a profile photo.
- **Ownership transfer** is one transaction of two guarded updates: the founder
  is demoted only `WHERE access = 'owner'`, the heir promoted only `WHERE access
  = 'admin' AND accepted_at IS NOT NULL AND revoked_at IS NULL`; either update
  matching nothing rolls both back. Two simultaneous handovers leave exactly one
  owner. The role menu no longer offers "Owner"; the handover has its own
  two-step confirmation naming the person. In a `from_you` loop the founder
  becomes a reader because the new owner is now the writer. Sessions and reply
  tokens are untouched. This supersedes flow G5.
- **Issue names** are `issues.name` (nullable, 60 characters). Everywhere the
  number appeared there is now one helper (`issueTitle` / `issueRef` /
  `issueHeading`): the rounds list, dashboard, reply sheet, web issue and share
  view headings (the web chip keeps the number), and the prompt, mention and
  delivery emails. Prompts are sent when a round opens, before it can be named;
  delivery, the mention email and everything after use the name. This is Ticket 3's R1.
- **Profile photos belong to a membership, not a person.** Names follow a person
  across loops by email because a handle is a poor byline; a face is different.
  Someone can be one thing to their family and another to colleagues, and no
  loop's owner should see a picture chosen for another audience, so nothing
  propagates by address. The photo is set on the reply sheet (contributors, via
  their link) or on the People tab (signed-in members, their own card only).
  Readers have no reply sheet, so they set one only if they sign in.

## Non-goals for this ticket

Weighted votes on polls (multiple selection *is* in scope; see below); comment search or editing
windows beyond today's behavior; fully custom fonts/colors per loop; themes on
the sign-in surface; member-visible theme voting.

## Resolved decisions (2026-11)

Settled with the owner before implementation:

- **Polls are single-choice or multiple-choice, chosen per poll.** The original
  recommendation was single choice only; multiple choice (pick any number, every
  option counts once, no weighting) is in scope. This amends the non-goals above.
- **Mentions notify readers too.** A reader can be @mentioned in a comment and
  receives the mention email; they still cannot suggest questions or reply.
- **Reminders stay a single reminder** (Ticket 3, Part R): a per-member preference
  of all / last-only / none, not a 48h + 24h schedule.
- **Shipping shape:** one PR per part, stacked, each green on `npm run verify`.
