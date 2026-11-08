# Flow inventory

Every user-visible flow in Friendloop. **One flow ID = one Playwright spec** at
`e2e/flows/<ID>.spec.ts`.

Two gates enforce this:

- `npm run check:flows` — a flow marked `done` must have a spec file, and every
  spec file must map to a flow. Runs on every PR.
- `npm run check:flows -- --strict` — additionally requires **zero** `todo` flows.
  Runs in the release workflow, so nothing ships at less than full coverage.

Status: `todo` (not built) · `done` (built and covered).

## A · Auth

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| A1 | Request a magic link | Submitting a known email writes one `outbox` row of kind `signin` containing a `…/signin/confirm?token=` URL and a six-digit code (also in the subject), and the UI says "check your inbox", with a box for the code that already knows the address. | done |
| A2 | Sign in with a valid link | Following that URL from the email sets a session cookie, redirects to `/you`, and the header shows the address that just signed in. | done |
| A3 | Reused or expired link | The same confirm URL signs in again, from another browser too, for 100 hours; one past that shows a recoverable "this link has expired" screen with a "send me a new one" action, never a 500. | done |
| A4 | Unknown email | An address with no account gets the identical "check your inbox" screen and the same email; the account only comes into existence when the link is used. | done |
| A5 | Sign out | Sign out clears the session, `/you` redirects to `/signin`, and the previous cookie no longer authenticates. | done |
| A6 | Revoked reply token | Opening a reply link whose token was rotated shows a "this link was replaced" page with no form and no data leak. | done |
| A7 | Expired session | A session lasts a year from its last use: a signed-in page renews it (database and cookie) at most daily. One that ran out is refused: `/you` redirects to `/signin`, while a session still inside its window is accepted and shows the address. | done |
| A8 | Abuse limits | Sign-in links are capped per address (5 per 15 min) and per network (20 per hour). A flooded address still lands on the same "check your inbox" screen but no further email is queued, so throttling reveals nothing about who signs in; a flooded network is told plainly to wait and nothing is sent. A stranger's feedback flood (30 per hour per network) and a member's comment flood (30 per 10 min) get a 429 with friendly words. | done |
| A9 | Sign in with the code | Typing the emailed code on the check-email page (address included when this browser didn't ask) signs a returning person straight in, and takes someone new to the confirm page for their name. A wrong code says so and keeps the address; five wrong codes stop a link's code, not the link. | done |

## B · Create and invite

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| B1 | Create a loop | Owner picks name, mode, cadence, timezone and hour; the loop is created with them as owner+contributor, and lands on the loop dashboard. | done |
| B2 | Pick starting questions | During creation the owner selects at least one question from the preset bank; those questions exist on the loop in the chosen order. | done |
| B3 | Invite several members | Pasting three addresses creates three pending memberships with distinct reply tokens and three `invite` rows in the outbox; each email names the loop and contains that member's own link. | done |
| B4 | Accept an invitation | A contributor opening their invite link lands on the reply form for the current issue with their name shown, without signing in. | done |
| B5 | Resend an invitation | Resending re-sends to a pending member, does not rotate the token, and does not create a duplicate membership. | done |
| B6 | Expired invitation | An invite older than its TTL renders an "ask the owner for a new link" screen and creates no session. | done |
| B8 | Invitation limits | One person sends at most 50 invitations a day and a loop holds at most 50 people. Past either, the form says so plainly and nothing else is sent. | done |
| B7 | Choose a look while creating | The wizard's optional "paper and picture" step offers the same papers, accent and live light-and-dark preview as the settings, plus a header picture; the choices survive moving between steps and are saved with the loop, so its first page already wears them. A made-up accent holds the step with a plain message, a picture over the cap is refused before anything is sent, and skipping the step stores nothing (Gingham, no picture). | done |

## C · Questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| C1 | Add a custom question | A new question appears at the end of the pool, is active, and is available to the next issue. | done |
| C2 | Reorder questions | Moving a question changes the order shown in the pool and the order used by the next issue. | done |
| C3 | Archive a question | Archiving removes it from the pool's active list and from future issues, while past issues still render its original text. | done |
| C4 | Choose the next issue's questions | Deselecting a question excludes it from the next issue only; the question stays in the pool. | done |
| C5 | Rotate questions | Setting a count of two selects questions 1–2, then 3–4, then wraps to 5 and 1. "Send now" uses the same cursor, while "All questions" preserves the original behavior. | done |
| C6 | Add questions from packs | The library is browsable by pack; several packs can be filtered at once, questions can be picked across them or added a whole pack at a time, and questions already in the pool are skipped. | done |

## D · The issue cycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| D1 | Open an issue on schedule | With the clock past the loop's slot, the sweep creates exactly one issue with a snapshot of the selected questions and one `prompt` outbox row per contributor. | done |
| D2 | Do not open early or twice | Running the sweep before the slot creates nothing; running it twice for the same slot creates no second issue and no duplicate email. | done |
| D3 | Start an issue manually | "Send now" opens an issue immediately with the loop's questions, sections and events, emails contributors, and takes the place of the next scheduled slot: that slot opens no second round, and the dashboard shows the one after it as next. | done |
| D4 | Draft autosaves | Typing an answer persists it as a draft; reloading the reply page restores every draft. | done |
| D5 | Submit answers | Submitting marks replies submitted with a timestamp and replaces the sheet with a confirmation screen (focus on its heading) that names the round, repeats when it goes out, and offers "Edit my answers", which brings the sheet back with every answer intact and "Save changes"; the owner's progress count increases. A later visit opens the sheet itself with its "Sent" note. | done |
| D6 | Edit a submitted answer | Before delivery, editing and re-submitting updates the reply and its timestamp without creating a duplicate row. | done |
| D7 | Deliver the issue | With the clock past the delivery instant, the sweep sends one issue email per member containing every submitted answer and that member's own link, the issue's status becomes `delivered`, and no loop's email contains another loop's answers. | done |
| D8 | Nothing to deliver | An issue reaching its delivery instant with zero submitted replies is marked `skipped`, sends no delivery email, pauses the loop with an explanation to the owner, and opens no new round in the same sweep. | done |
| D9 | Nudge the stragglers | 48 hours before delivery, contributors with nothing submitted get exactly one reminder; anyone who submitted gets none, and a second sweep sends no duplicate. | done |
| D10 | Nudge by hand | From the dashboard the owner sees who has not answered and can send one more reminder; anyone who already answered gets none, and each nudge is its own email rather than a duplicate. | done |
| D11 | Two triggers at once | When the two production triggers run the sweep concurrently, exactly one issue is created for the slot, one prompt per contributor is sent, and concurrent delivery and reminder passes never double-send. | done |
| D12 | Provider rejects a send | A provider outage leaves the prompt `failed` with its attempt counted, the next sweep retries the same row instead of queueing a new one, a permanent rejection keeps the provider's reason, and a rate limit clears once the provider recovers. | done |

## E · Reading and reacting

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| E1 | Read a delivered issue | A member opening `/i/<n>` sees every question with each contributor's answer, their own marked, and the issue's date. | done |
| E2 | Read by share link | With sharing enabled, an anonymous visitor at the share URL reads the same issue and sees no other loop data or navigation. | done |
| E3 | Comment on an issue | A member posts a comment, it appears for other members immediately in their own session, an empty comment is rejected, and the author is marked "You" rather than by name. | done |
| E4 | React to an answer | A member adds a reaction to someone's answer, the count updates for the person whose answer it is in a second session, and toggling removes it. Beside the three defaults, a plus button opens a searchable picker of any emoji, with no approval from anyone; it works by touch and by keyboard, returns focus when it closes, and the emoji appears as its own chip for everyone. | done |
| E5 | Browse the archive | The archive lists delivered issues newest-first; opening an older one renders without needing the current issue to exist. | done |

## F · Loop settings

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| F1 | Change cadence or timezone | Saving a new weekday, hour, cadence or timezone changes the next send time shown to the owner and does not move an already-open issue's deadline. | done |
| F2 | Pause and resume | Pausing stops new issues from opening and says so on the dashboard; resuming schedules the next slot from the resume moment. | done |
| F3 | Remove a member | Removing a member stops their emails and revokes their links; their past answers remain in delivered issues. | done |
| F4 | Delete a loop | The owner confirms by typing the loop name; the loop, its issues, replies and outbox rows disappear and `/g/<id>` 404s. | done |
| F5 | Non-owner is refused | A plain member visiting an owner route gets a 404/403 page, and the same request as a POST is rejected server-side. | done |
| F6 | Reset share links | Resetting gives every delivered round a new share URL; a URL handed out before the reset 404s, and turning sharing off disables every existing link. | done |
| F7 | Fix a member's address | An owner or admin corrects the address of someone with no account yet. The membership and its answers stay, the old link stops working, and the new address gets an invitation. Someone who has signed in moves their own address instead. | done |

## G · Roles and permissions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| G3 | Promote to admin | Promoting a member to admin lets them manage questions and members, while the owner-only actions stay unavailable to them; the promotion reaches that person's already-signed-in session. | done |
| G4 | Reader cannot reply | A direct POST to the reply endpoint from a reader is rejected with 403 and writes nothing. | done |
| G6 | `from_you` mode | In `from_you`, every non-owner is forced to reader on invite and cannot be made a contributor. | done |

## H · Preview

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| H1 | Preview screens and emails | Every `/dev` route answers 404 outside local development until a keyed visit to `/dev/ui` sets the cookie, and a wrong key keeps it that way; nothing signs an unkeyed visitor in. With the key, the screens and email templates open. On production the key opens only the inboxes: the demo, whose tokens are public, is never seeded. | done |

## I · Suggested questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| I1 | Suggest a question | A contributor sees a "suggest a question" affordance on the reply sheet, writes a question, picks how their name shows ("asked by Maya" or anonymously), submits, and sees a quiet confirmation. The suggestion is web-only: no email is sent. | done |
| I2 | Owner reviews the queue | The loop dashboard shows pending suggestions with author display and text; accept turns it into an active pool question attributed to that membership; decline removes it from the queue; edit-then-accept stores the edited text. | done |
| I3 | Suggested question in an issue | When an accepted suggestion is selected for an issue, the delivered issue credits it ("asked by Maya") unless the author chose anonymity; past issues keep their original credit. | done |
| I4 | Readers are walled off | A reader has no suggest link, and a suggest URL reached by a reader (or a revoked/expired token) shows the standard no-access screen with no data leak. | done |
| I5 | from_you stays quiet | No suggest affordance appears in prompt email, reply sheet, or dashboard in `from_you` mode. | done |

## K · Sections (and music picks)

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| K1 | Manage sections | Owner creates, edits, reorders, and archives sections; archived sections leave future issues while past issues keep their snapshot. | done |
| K2 | Sections reach an issue | The sweep snapshots active sections into the new issue alongside questions; the reply sheet shows them in position; readers see them in the delivered issue but are never asked to reply. | done |
| K3 | Standard section reply | Contributors answer a Standard section with text + one photo, under the same media rules and caps as question answers. | done |
| K4 | Photo wall reply | Contributors add up to six photos to a Photo Wall section, each with an optional one-line caption; the delivered issue lays them edge-to-edge, each with its author and any caption, and tapping one opens it full size in the same viewer as the Album (previous/next, Escape returns focus) with a Download button. | done |
| K5 | Paste a music link | A music section accepts a Spotify, Bandcamp, or Qobuz link, with an optional caption; a non-music URL gets the plain-language error and nothing is saved until it is fixed or cleared. | done |
| K6 | Music renders | The delivered web issue renders every music pick as a card (artwork when the metadata provides it, title, provider badge) that opens the provider page; the delivery email renders title + link. Playable Spotify/Bandcamp embeds are stretch. | done |
| K7 | Admin-only sections | A section can be restricted to owner/admin contributors; other members don't see it on the sheet, in prompts, or in the delivered issue. | done |
| K8 | Snapshot truth | Editing a section after an issue opens changes future issues only; the open issue keeps its copy, mirroring question behavior (C3). | done |

## J · Voice replies

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| J1 | Record an answer | On the reply sheet a question offers "record a voice note"; record, stop, preview with duration, attach. Draft autosave persists the audio; reloading keeps it. | done |
| J2 | Replace and remove | A member can re-record over an attached note or delete it, before and after delivery; post-delivery replacement keeps the `added_after_delivery` truth on the web issue. | done |
| J3 | Limits, plainly | Duration cap (target 2 minutes, hard stop 3) and size cap produce the same warm plain-language error, never a 500. | done |
| J4 | Where recording isn't possible | A browser without MediaRecorder sees "your browser can't record here" plus a file-picker fallback accepting m4a/mp3/webm/ogg within the same caps; a page that isn't https says that instead (browsers expose no microphone there and never prompt), and a refused permission or a missing microphone is named as such. | done |
| J5 | Reading and the email snapshot | The web issue renders a styled audio player; the delivery email renders a "voice note — listen on the web issue" card (email never attempts to embed audio). | done |
| J6 | Media parity | Audio files get long random names and are stored exactly like photos (local in dev, Blob in prod); share-link visitors can hear a shared issue's notes under the same rules as photos. | done |

## L · Polls

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| L1 | Author a poll | Owner adds a poll question (prompt, two to six options, single or multiple choice) from the questions tab; it appears in the pool labelled as a poll with its options, and can be reordered, archived, and rotated like any question. The next issue freezes its options. | done |
| L2 | Answer a poll | A contributor picks one option (or several, on a multiple-choice poll) on the reply sheet and can change or clear the pick until delivery. The tally is never shown before delivery: not on the sheet, and not on the web issue, where only the viewer's own pick appears. | done |
| L3 | Read a poll | The delivered issue shows every member's pick next to their name with a total tally; share-link visitors see the same, and the delivery email carries the picks and the results. | done |

## M · Richer comments

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| M1 | Mention a member | Typing @ in a comment box offers matching member names in a keyboard- and touch-usable list; the saved comment stores the membership reference and renders as that person's current name; each mentioned member (readers included, never the author or a revoked member) receives exactly one email linking to the issue, and posting the same comment twice never emails twice. | done |
| M2 | Toggle comments | With commenting off, every comment surface disappears for everyone (the issue thread, per-answer threads, composers) and the write route refuses; past comments stay stored, and turning it back on restores them. | done |
| M3 | Answer threads | A comment can be posted on a specific answer; it renders with that answer and never appears in the issue-level thread. | done |
| M4 | Quote and attach | Replying to a comment quotes it into the composer; a comment can carry one photo under the same type and size caps as answers; a quote of a removed comment reads as removed. | done |

## N · Loop identity and lifecycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| N1 | Choose a theme | The owner picks one of the curated papers (and optionally an accent colour and a header picture) in settings, with a live light-and-dark preview; the dashboard, reply sheet, web issue, share view and every email header render it from one token set; an accent that would be hard to read is nudged to pass WCAG AA, and every preset passes the axe audit in both schemes. Only the owner can set the picture. | done |
| N2 | Default stays Gingham | A loop that never chose a theme renders exactly as before — no stationery rule injected, no banner, the original colours in light and dark and in email; choosing Gingham again stores nothing; the sign-in surface never wears a loop's paper. | done |
| N3 | Transfer ownership | The owner hands the loop to an admin who has joined, through a confirmation that names the new owner and what they give up; the founder becomes an admin, owner-only actions move, sessions and reply tokens are untouched, and the old owner cannot hand it back without the new owner. The role menu no longer offers "Owner", and a handover that has gone stale changes nothing. (Supersedes G5.) | done |
| N4 | Rename an issue | The owner names a round (before or after delivery); the name shows in the rounds list, the dashboard, the reply sheet, the web issue and share view, and the delivery email's subject and heading; clearing it brings "Round N" back; only the owner is offered the control. (Ticket 3's R1 is this flow.) | done |
| N5 | Profile photos | A member sets and removes their own photo — straight from their invitation link (on the reply sheet, or on the quiet page a reader or a not-yet-open loop lands on), or on the people page when signed in; it renders in the member list, on their answers and in comments, falling back to the initial; it belongs to that loop's membership only, and the photo routes answer only the person they belong to. | done |
| N6 | Dress the loop | The owner picks a page background, a pack of paper textures, a separate pack of washi tape and a mascot in settings, each saved as it's chosen and previewed in place. They reach the dashboard, reply sheet, web issue and share view in light and dark and pass the accessibility audit; the mascot also reaches every email header as an image. The originals are stored as nothing and add no CSS, and only the owner can change any of it. | done |
| N7 | Charm and frame | A member picks a sticker for beside their name and a frame for their picture, on their reply link or on the people page; both save as they're tapped and follow their answers and comments, the charm into issue emails too (the name stands alone with images off). They belong to that loop's membership only, the routes accept only our own stickers and frames, and only from the person they belong to. | done |

## O · Events and birthdays

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| O1 | Add an event | The owner or an admin adds a one-time event (title, emoji, date) or an annual birthday tied to a member (emoji, date; the year is ignored); it lists under "Coming up" soonest first with its next date, can be edited or removed, and a date already gone by is refused with a plain message. Members never see the calendar. | done |
| O2 | Event lands in the right round | The sweep puts an event whose local date falls in a round's window into that round as a section titled with the event (or "Maya's birthday"); contributors see it on the sheet, reply with a message and a photo, and it travels in the delivery email and on the web issue. An event outside the window is left for the round that holds it. | done |
| O3 | Birthdays recur | A birthday places exactly one section per year, in the one round whose window holds the date (loop timezone), however many rounds open around it or however often the sweep runs; a window shorter than the cadence still catches a date between two rounds, a window crossing New Year catches both sides, and 29 February keeps to 28 February in years without one. | done |
| O4 | Past truth | A round keeps the title, emoji and place of the event section it was given even if the event is later edited or deleted or the member is renamed; replies already written stay with it. | done |

## P · The Album

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| P1 | Browse the album | A member opens the Album — a tab of the loop, or a link on any delivered round for people who read from their inbox — and sees every photo and voice note from delivered rounds (answers, photo walls and section photos), newest round first and grouped under the round's name; voice notes play in place, photos open in a keyboard-and-touch-usable fullscreen viewer that offers a download, and "view in the round" lands on that very answer. Nothing from an open round, a draft, or an admin-only section the viewer cannot read is shown. | done |
| P2 | Filter and search | Choosing one person and searching a word (matched against answer text, photo captions, and the question or section it answered; every word must turn up) each narrow the Album, alone or together; the URL carries the filters, a long album grows a page at a time without losing them, and an empty result says so plainly with a way out. | done |
| P3 | Privacy holds | Share-link visitors get no Album route, link or data; strangers, revoked members, other loops' members and bad tokens get the plain not-found page with nothing of the loop in it; the media addresses stay unguessable. | done |

## Q · Keepsake export

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| Q1 | Print an issue | A delivered round (on the member page or the share link) offers "Print this round", which opens the same address with `?print`: the round on plain light paper, named authors rather than "You", with the questions, answers, photos, voice-note cards, poll picks and tallies, credits, sections, reactions and comment threads laid out for paper. Under print media the toolbar, theme switch and skip link are gone, each question starts a new page, answers, photos, cards and comments never split, nothing overflows sideways, and a dark screen or a tinted preset still prints as light paper. A round that has not gone out has no print action and `?print` leaves it unchanged; nothing opens the print dialog but a click. | done |
| Q2 | Late edits stay true | The print view holds no copy of the round: it reads the same canonical state as the web round, so an edited answer, a new late answer, a taken-down comment, commenting switched off and a renamed round all show on the next print, and everything added after delivery is marked "Added late". | done |

## R · Reading and delivery controls

Round names (Ticket 3's R1) ship as N4; R4 (one-by-one delivery) is a documented stretch and has no flow.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| R2 | Find one member's answers | The rounds list can be narrowed to the delivered rounds one person answered in (open rounds are not listed while filtering, a person with none gets a plain empty message and a way out, a made-up id is no filter), and "Read it" opens that round already isolated to them. Inside a round, a row of plain links isolates one person's answers (their name carries a check and `aria-current`), or reads the round by person — one card per author in name order, each answer under the question or section it answered — with a link back to everyone. A person who wrote nothing in the round, or a bad address, reads as everyone; the print view and the share link always show the whole round. | done |
| R3 | Reminder preferences | Each contributor picks all / only the last / none on their own answer page; it saves as they choose, belongs to that loop's membership, and only they (by their token) can set it — a reader, a stranger or a bad value writes nothing, and opening the page or the email changes nothing. The loop's automatic reminder skips anyone on none and reaches the rest exactly once however often the sweep runs; prompt and delivery emails ignore it, and the owner's nudge by hand still reaches everyone who has not submitted. The loop sends one reminder, so "all" and "last" read the same today and the user-facing copy promises no second one. | done |

## S · Feedback

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| S1 | Send feedback | A button in the corner of every page opens a one-box form; anyone, signed in or not, sends a note with one tap, and the page, screen size and browser travel with it. A signed-in person or a reply link is named from the request itself, never asked; reply and share tokens are stripped from the stored page. A blank note cannot be sent, a failed send keeps the words, an hour's flood is refused, and the notes are read in the key-locked `/dev/feedback`. | done |
| S2 | Stats and blocking | `/dev/stats`, behind the key, shows people, loops, rounds, bounces and the day's email count, with one row per loop. Blocking an address stops sign-in, ends sessions, pauses the loops it owns and drops their unsent mail; unblocking restores sign-in. | done |

## V · Your data

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| V1 | Privacy and terms | `/privacy` and `/terms` are public pages in plain language, linked from the landing page footer, the sign-in page and under every email's footer; the privacy page names what is stored, the processors (Vercel, Neon, Resend, Vercel Blob, Sentry), how long it is kept and how to export or delete it. | done |
| V2 | Delete my account | From `/you`, a signed-in person confirms by typing their email address; a mismatch deletes nothing. Their user, sessions, memberships (signed in or only invited by that address), answers, photos, voice notes, comments, reactions, suggestions, birthdays, feedback, email trail and abuse counters go in every loop, the stored files are removed (retried by the sweep if storage refuses), they land signed out on `/goodbye`, and delivered rounds show nothing from them. A loop they own alone goes too; one with anyone else in it refuses the deletion and offers "Hand it on" and "Delete the loop" instead. | done |
| V3 | Leave through the reply link | The answer page (and the reader and nothing-open pages) offers "Leave this loop and delete my answers"; the leave page is a GET that changes nothing, and a ticked confirmation POST removes the membership and everything written in that loop only, including files; the link then stops working and the round reads on without them. The owner's link explains how to hand the loop on or delete it instead. | done |
| V4 | Export | "Download my data" on `/you` streams a JSON file of the person's own words in every loop (drafts included, links to their photos and voice notes); the leave page offers the same for one loop by reply link; the owner's settings offer the whole loop archive (every round, question, sent answer, section, comment and reaction, no drafts). The archive answers 404 to members and strangers, and the personal export sends a signed-out visitor to sign in. | done |
| V5 | Change my address | From `/you` a signed-in person asks to move to a new address. Nothing changes until they press the button on the page linked from that inbox, within an hour. Then the account and every loop move, and the old address is told. An address already in use changes nothing. | done |

IDs are stable handles, not positions: a retired flow leaves its number out
rather than renumbering the rest.

---

**104 flows.** A flow is only `done` when its spec passes locally and in CI.

## T · Photos

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| T1 | Upload a camera-roll photo | A full-size phone photo (well over 5 MB, any orientation) uploads from every place a picture can be added — an answer, a section photo, a comment, a profile photo, a header picture — without the person resizing anything: the browser scales it down (answers and comments to 2560 px and 3.5 MB, profile photos to 512 px, header pictures to 2400 px) and re-encodes it, so it clears Vercel's 4.5 MB request limit; camera photos (JPEG, WebP) are always redrawn, which strips the location the camera wrote into them, while a PNG or GIF that already fits is sent byte for byte; Send and Post wait while a photo is still being prepared or uploaded; bytes that cannot be read as a picture are turned away in plain words and nothing is stored. | done |

## U · Email deliverability

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| U1 | Stop emails from a loop | Every loop email (invite, prompt, reminder, mention, issue, paused notice) carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` naming that membership's own unsubscribe token, plus a visible "Stop emails from this loop" footer link in HTML and plain text; sign-in emails carry neither. Opening the link (or a GET on the one-click URL) changes nothing and asks first; confirming mutes. A one-click POST mutes with no confirmation and answers 2xx. A muted member stays in the loop: their reply link still works and shows a "turn emails back on" notice (on the reply sheet and on a delivered round), prompts, reminders, nudges and issue emails to them are recorded as suppressed and never sent, and owners and admins see "Emails off" on the people tab. Unmuting from the reply page or the unsubscribe page brings the next email back. | done |
| U2 | Bouncing addresses | A Resend webhook is accepted only with a valid Svix signature inside the five-minute window (a bad signature or an old timestamp gets 401 and records nothing; a redelivery is recorded once); each event is stored in `email_events` linked to its outbox row. A hard bounce or a spam complaint suppresses the address: later loop emails to it are recorded as suppressed, sign-in links still go, and the people tab shows the member as "Bouncing" with how to fix it. | done |
