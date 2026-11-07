# Ticket 1 · Contributor authoring (ship first)

Member-suggested questions · voice replies · sections with music picks.
Research origin: competitive scan #1, #5, #6 (Letterloop help center, ShareLocket).

One release, three features, one theme: the people who answer get more ways to
shape and fill the issue, without the owner doing more work. Everything here
stays on the free tiers (Vercel Hobby, Neon, Resend) and inside the two seams
(clock, outbox).

## Part I · Member-suggested questions

Letterloop emails contributors a "suggest a question" link before an issue opens
and lets the owner review pitches before delivery. Friendloop marks this
explicitly undecided in `PRODUCT.md`; this ticket decides it as yes.

Contributors only. Readers never see a suggest affordance. In `from_you` mode
the feature is inert everywhere: the owner is the only contributor and already
writes the questions.

The ask lives in one place: the reply sheet. A signed-in-or-tokenized
contributor already has the sheet open when they think of something, so the
sheet gains a small "suggest a question" affordance resolving to a tokenized
page scoped to the membership (`/r/<token>/suggest`, a separate route from the
reply sheet, so a revoked reply link can never leak suggestions). No separate
suggest-request email; the prompt email stays as it is.

A suggestion is a queue entry, not a question. The owner accepts (optionally
editing), declines, or leaves it pending. Accepting creates an active pool
question attributed to the member (`questions.createdByMembershipId` already
exists). A suggestion never auto-enters an issue; inclusion stays with the
owner's normal per-issue selection.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| I1 | Suggest a question | A contributor sees a "suggest a question" affordance on the reply sheet, writes a question, picks how their name shows ("asked by Maya" or anonymously), submits, and sees a quiet confirmation. The suggestion is web-only: no email is sent. | todo |
| I2 | Owner reviews the queue | The loop dashboard shows pending suggestions with author display and text; accept turns it into an active pool question attributed to that membership; decline removes it from the queue; edit-then-accept stores the edited text. | todo |
| I3 | Suggested question in an issue | When an accepted suggestion is selected for an issue, the delivered issue credits it ("asked by Maya") unless the author chose anonymity; past issues keep their original credit. | todo |
| I4 | Readers are walled off | A reader has no suggest link, and a suggest URL reached by a reader (or a revoked/expired token) shows the standard no-access screen with no data leak. | todo |
| I5 | from_you stays quiet | No suggest affordance appears in prompt email, reply sheet, or dashboard in `from_you` mode. | todo |

Design notes

- New table `question_suggestions` (groupId, membershipId, text, authorDisplay
  `name|anonymous`, status `pending|accepted|declined`, acceptedQuestionId →
  questions). Not a boolean on `questions`: a declined suggestion is a record,
  and a pending one is not yet a question.
- New email? No — the only entry point is the reply sheet's suggest affordance.
  The route is deterministic from the membership's `reply_token`-derived route
  (`/r/<token>/suggest`), so a revoked reply link can never leak suggestions.
- No changes to rotation or the cursor. Suggestions enter the pool as ordinary
  active questions.

## Part J · Voice replies

ShareLocket proves the lowest-friction reply is talking, not typing. Voice joins
text and photo as a per-answer attachment.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| J1 | Record an answer | On the reply sheet a question offers "record a voice note"; record, stop, preview with duration, attach. Draft autosave persists the audio; reloading keeps it. | todo |
| J2 | Replace and remove | A member can re-record over an attached note or delete it, before and after delivery; post-delivery replacement keeps the `added_after_delivery` truth on the web issue. | todo |
| J3 | Limits, plainly | Duration cap (target 2 minutes, hard stop 3) and size cap produce the same warm plain-language error, never a 500. | todo |
| J4 | Where recording isn't possible | A browser without MediaRecorder sees "your browser can't record here" plus a file-picker fallback accepting m4a/mp3/webm/ogg within the same caps. | todo |
| J5 | Reading and the email snapshot | The web issue renders a styled audio player; the delivery email renders a "voice note — listen on the web issue" card (email never attempts to embed audio). | todo |
| J6 | Media parity | Audio files are content-hashed and stored exactly like photos (local in dev, Blob in prod); share-link visitors can hear a shared issue's notes under the same rules as photos. | todo |

Design notes

- `replies.audioUrl` (nullable) plus `audioDurationMs`. Voice rides alongside
  the existing photo slot: an answer can carry text + photo + voice (caps
  per-slot unchanged).
- Generalize `photo-storage.ts` → `media-storage.ts` (content-hash names,
  extension + mime whitelist, same local/Blob split). Photos keep their
  behavior; a `photoUrl`-era regression in existing flows (D/E) is a release
  blocker.
- Recording: `MediaRecorder`, webm/opus on Chromium, audio/mp4 on Safari; store
  what the browser gave us, don't transcode. No transcription in this ticket
  (that belongs to the archive ticket).

## Part K · Sections (and music picks that aren't only Spotify)

Letterloop Sections are recurring non-question areas of an issue. Friendloop
gets all three Letterloop section kinds — Standard, Photo Wall, and Music —
with the music renderer deliberately provider-agnostic. Every active section is
snapshotted into every new issue the way questions are, in a fixed order
relative to questions. Owners curate the pool with the active flag; per-issue
section selection can come later if a loop outgrows "all of them".

- **Standard** — title, emoji, description; contributors reply with text + one
  photo, same rules as a question answer.
- **Photo Wall** — contributors add several photos (cap 6), each with an
  optional one-line caption; the issue lays them out edge-to-edge.
- **Music** — contributors paste a link from Spotify, Bandcamp, or Qobuz, with
  an optional caption.

Music rendering: one rich card for every provider — artwork, title, artist
where the metadata has it, and a provider badge — that opens the provider page
on tap. It does not have to play in the browser. Spotify and Bandcamp also
expose public oEmbed endpoints that return playable iframes; rendering those
embeds inside the card is a stretch goal, not the floor. The floor for all
three providers is the same card, and no third-party fetch may block saving a
reply (validation is host + path shape server-side; metadata is fetched at
delivery/render time and cached, degrading to a plain card without artwork).

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| K1 | Manage sections | Owner creates, edits, reorders, and archives sections; archived sections leave future issues while past issues keep their snapshot. | todo |
| K2 | Sections reach an issue | The sweep snapshots active sections into the new issue alongside questions; the reply sheet shows them in position; readers see them in the delivered issue but are never asked to reply. | todo |
| K3 | Standard section reply | Contributors answer a Standard section with text + one photo, under the same media rules and caps as question answers. | todo |
| K4 | Photo wall reply | Contributors add up to six photos to a Photo Wall section, each with an optional one-line caption; the delivered issue lays them edge-to-edge, each with its author and any caption. | todo |
| K5 | Paste a music link | A music section accepts a Spotify, Bandcamp, or Qobuz link, with an optional caption; a non-music URL gets the plain-language error and nothing is saved until it is fixed or cleared. | todo |
| K6 | Music renders | The delivered web issue renders every music pick as a card (artwork when the metadata provides it, title, provider badge) that opens the provider page; the delivery email renders title + link. Playable Spotify/Bandcamp embeds are stretch. | todo |
| K7 | Admin-only sections | A section can be restricted to owner/admin contributors; other members don't see it on the sheet, in prompts, or in the delivered issue. | todo |
| K8 | Snapshot truth | Editing a section after an issue opens changes future issues only; the open issue keeps its copy, mirroring question behavior (C3). | todo |

Design notes

- Tables: `sections` (groupId, kind `standard|photo_wall|music`, title, emoji,
  description, adminOnly, position, active, archivedAt) and `issue_sections`
  (snapshot, mirrors `issue_questions`; photo-wall cap and music provider
  validation ride on the kind). Section answers need a home: a nullable
  `issueSectionId` on `replies` with the unique key rebuilt as
  `(issue_id, COALESCE(issue_question_id, issue_section_id), membership_id)` via
  a generated column, or a separate `section_replies` table (photo walls imply
  multiple media rows, favoring the separate table with a `section_media`
  child). Lean toward the separate tables — it touches no existing flow, and
  "who replied to what" queries stay simple.
- The music metadata cache is a small table (url, provider, title, artwork,
  embedHtml, fetchedAt) refreshed on delivery; failures degrade to the card.
- `PRODUCT.md` "one photo per reply" is amended to cover voice and sections;
  `SPEC.md` is regenerated when this lands.

## Shaping

Three stacked PRs, each green on `npm run verify` and independently mergeable:

1. **PR 1 — Member-suggested questions** (flows I1–I5): `question_suggestions`,
   reply-sheet affordance + `/r/<token>/suggest`, dashboard review queue,
   issue credits.
2. **PR 2 — Voice replies** (flows J1–J6): `media-storage.ts` extraction,
   `replies.audioUrl` + `audioDurationMs`, recorder UI, email card.
3. **PR 3 — Sections** (flows K1–K8): `sections`/`issue_sections` (+ section
   answers), section management UI, snapshot in the sweep, photo wall, music
   cards, email rendering.

## Resolved decisions (2026-10, with the owner)

- Suggest entry point: reply sheet only; no prompt-email link, no separate
  email.
- Attribution: author chooses "asked by Maya" or anonymous at submit; owner
  always sees the true author in the queue.
- Voice sits alongside the photo slot (text + photo + voice in one answer);
  2-minute target cap, 3-minute hard stop; transcripts deferred to the archive
  ticket.
- Photo Wall is in scope for this ticket, capped at six photos with optional
  one-line captions.
- All active sections snapshot into every new issue; per-issue selection is a
  later option, not now.
- Music: one click-through card design for Spotify, Bandcamp, and Qobuz;
  playable embeds (Spotify/Bandcamp oEmbed) are stretch, not the floor.
- Shipping shape: three stacked PRs as listed above.

## Non-goals for this ticket

Polls, question rotation for sections, transcripts, transcoding, native share
sheets, and playable in-browser Qobuz playback (the card opens Qobuz instead).
