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
| A9 | Sign in with the code | Typing the emailed code on the check-email page (address included when this browser didn't ask) signs a returning person straight in, and takes someone new to the confirm page for their name. A wrong code says so and keeps the address. Only the newest email's code works, and an address takes ten codes a day; the emailed link works regardless. | done |

## B · Create and invite

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| B1 | Create a loop | Owner picks name, cadence, timezone and hour; the loop is created with them as owner+contributor, and lands on the loop dashboard. | done |
| B2 | Pick starting questions | During creation the owner selects at least one question from the preset bank; those questions exist on the loop in the chosen order. | done |
| B3 | Invite several members | Pasting three addresses creates three memberships with distinct reply tokens and three `invite` rows in the outbox; each email names the loop and contains that member's own link. | done |
| B4 | Open an invite link | A contributor opening their invite link lands on the reply form for the current round with their name shown, without signing in. | done |
| B5 | Resend an invitation | Resending re-sends the same link to someone who has not answered or signed in yet, does not rotate the token, and does not create a duplicate membership. | done |
| B6 | Links never expire | A reply link works for as long as its membership is not removed: one sent months ago and never opened still opens the sheet and saves an answer, which counts as having joined. Removing the person is what ends it ("this link doesn't work anymore"). The people tab shows no invitation state: a contributor who has never answered or signed in reads "Hasn't answered yet", a reader shows nothing, and "Resend invite" sends the same link again. | done |
| B8 | Invitation limits | One person sends at most 50 invitations a day and a loop holds at most 50 people. Past either, the form says so plainly and nothing else is sent. | done |
| B9 | Invite to answer or to read | The invite form on the people tab, and the new-loop wizard's people step, ask how the people take part: "Answer and read" (the default) or "Just read". A reader's membership is created as a reader and their invitation says "Have a look" with nothing to answer, never "Answer the first round"; on the people tab they show as "Reads only" with no "Hasn't answered yet". | done |
| B10 | Join with the loop's link | The people tab leads with "Invite with a link": the loop's `/join/<token>` link and a "Copy invite link" button, shown only to owners and admins. Opening the link shows the loop's name and who runs it, and asks for an email; nothing joins until that address is confirmed, through a "Join <loop>: <code>" email whose link or code signs them in and lands them in the loop as someone who answers, with a "You're in!" note. Someone signed in joins in one tap, and someone already in goes straight to the loop. "Reset link" makes a new one and the old link says it doesn't work anymore; a person the owner removed, or anyone once the loop holds 50, is told so instead of joining. | done |
| B7 | Choose a look while creating | The wizard's optional "paper and picture" step offers the same papers, accent and live light-and-dark preview as the settings, plus a header picture; the choices survive moving between steps and are saved with the loop, so its first page already wears them. A made-up accent holds the step with a plain message, a picture over the cap is refused before anything is sent, and skipping the step stores nothing (Gingham, no picture). | done |

## C · Questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| C1 | Add anything to ask | One add card on the Questions page adds a written question, a poll, a photo wall or a music link, asked in turns, every round, or on a date (a one-time event, or a birthday tied to a member), with an optional emoji, description and owners-only flag. A turn-taker waits at the back of Up next unless "Ask it this round too" is ticked (then it goes last in This round); an every-round item, or a date in the open round's days, joins This round at once. The reply sheet then shows the round as one list with one jump list; readers see every item in the delivered round but are never asked to reply; the prompt counts and lists every item, so a round holding only every-round items still sends every contributor its prompt; a refused item (a date gone by, a poll with fewer than two different options) says what to fix. | done |
| C2 | Reorder the queue | Up next lists the turn-takers in the order coming rounds ask them. Moving one by its grip (dragging it, tapping the grip for Up and Down, or with the keyboard: Space or Enter to pick it up, arrows, Space or Enter to set it down) saves the new order, keeps focus on the moved control, and updates the round shown on each row; every-round items reorder among themselves the same way. This round keeps its own order. | done |
| C3 | Stop asking | Stop asking (after a confirmation) takes an item out of Up next, and out of This round unless someone has written there; it folds into "Stopped", where Ask again brings it back to the back of the queue (an every-round item to This round too); past rounds still render it as it was asked. | done |
| C4 | Edit this round | "This round asks" leads the page with the open round's items in its order, edited directly: the bin removes one (a turn-taker goes first in line for the next round, a date taken out stays out when the round is carried over), a row someone wrote in names them instead and stays, the grips reorder this round only, "Add to this round" opens the add card asking for this round, a row from Up next can be asked this round too, and a row opens in place to edit it: new words reach this round unless someone has written there, in which case it keeps the words they answered and the next round asks the new ones. A paused loop says plainly that changes apply when it resumes. | done |
| C5 | Rotate questions | "Each round asks N of the questions that take turns", in Up next, sets how many turn-takers each coming round asks: a count of two takes questions 1–2, then 3–4, then wraps to 5 and 1, each round taking the front of the queue and sending what it took to the back; "All" asks every turn-taker each round. "Send now" opens the next round the same way, and the round already open stays as it is. | done |
| C6 | Add questions from packs | Folded under the add card, the library is browsable by pack; several packs can be filtered at once, questions can be picked across them or added a whole pack at a time, and questions the loop already asks are skipped. They take turns, or are asked every round in a loop where nothing takes turns. | done |
| C7 | Up next | Up next shows the rounds to come: each turn-taker tagged with the round that next asks it and that round's date (the next round in full, then later ones until every turn-taker has had its turn, at most six), then the items asked every round, then events and birthdays with their next date and the round that catches them. A member sees This round and Up next without owners-only items, dates, stopped items or any control. | done |

## D · The round cycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| D1 | Always a round open | A running loop without an open round gets one at once from the sweep, due at the next delivery, with one `prompt` outbox row per contributor; creating a loop opens round 1 the same way. | done |
| D2 | Do not open twice | A second sweep, or two at once, opens no second round and sends no duplicate email. | done |
| D3 | Send now | "Send now" delivers the open round with the answers in so far, opens the next round straight away, and that round is due at the delivery after the one it replaced. With nothing in the round it sends nothing. | done |
| D4 | Answers save as you go | Typing an answer saves it straight into the round; there is no send step. The sheet says, beside the deadline, that everything written goes out then, finished or not, and that clearing an answer leaves it out; reloading the reply page restores every answer. | done |
| D5 | Done | Done waits for the last words typed to save, then replaces the sheet with a confirmation (focus on its heading) that names the round, says everything written goes out at the delivery time and that clearing an answer leaves it out, and offers "Back to my answers", which brings the sheet back with every answer intact. Someone signed in on their own link is also offered "Go to {loop}", which opens the loop page; anyone else sees no such link. Done with nothing written points at the first question instead. The owner's progress count includes someone as soon as an answer of theirs saves, without Done. | done |
| D6 | Change or clear an answer | Before delivery, changing an answer updates its row in place without creating a duplicate; clearing it back to nothing takes it out of the round, the round's page and the progress count. | done |
| D7 | Deliver the round | With the clock past the delivery instant, the sweep sends one delivery email per member containing every saved, non-empty answer, the round's status becomes `delivered`, and the next round opens with its questions in each contributor's email. | done |
| D8 | Nothing to deliver | A round reaching its delivery instant with nothing written in it (or only answers cleared back to nothing) sends no email and is carried over to the next delivery; on its third empty delivery it is marked `skipped` and pauses the loop with an explanation to the owner. | done |
| D9 | Nudge the stragglers | 48 hours before delivery, contributors with nothing written get exactly one reminder; anyone with a saved answer (to anything the round asks) gets none, and a second sweep sends no duplicate. | done |
| D10 | Nudge by hand | From the dashboard the owner sees who has nothing written yet and can send one more reminder; anyone with a saved answer gets none, and each nudge is its own email rather than a duplicate. | done |
| D11 | Two triggers at once | When the two production triggers run the sweep concurrently, exactly one round is created for the slot, one prompt per contributor is sent, and concurrent delivery and reminder passes never double-send. | done |
| D12 | Provider rejects a send | A provider outage leaves the prompt `failed` with its attempt counted, the next sweep retries the same row instead of queueing a new one, a permanent rejection keeps the provider's reason, and a rate limit clears once the provider recovers. | done |
| D13 | Answer from the app | A signed-in member who answers in the loop sees a primary "Answer round N" button on the overview's open-round card, and the same link on that loop's card on `/you`; both go to their own reply link and the page carries nobody else's. Once they are among the round's "in" people it reads "Edit your answers" and steps back to a quiet button. A reader, or anyone in a paused loop, sees neither and is sent no reply link. | done |

## E · Reading and reacting

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| E1 | Read a delivered round | A member opening `/i/<n>` sees every question with each contributor's answer, their own marked, and the round's date. | done |
| E2 | Read by share link | With sharing enabled, an anonymous visitor at the share URL reads the same round and sees no other loop data or navigation. | done |
| E3 | Comment on a round | A member posts a comment, it appears for other members immediately in their own session, an empty comment is rejected, and the author is marked "You" rather than by name. | done |
| E4 | React to an answer | A member adds a reaction to someone's answer, the count updates for the person whose answer it is in a second session, and toggling removes it. Beside the three defaults, a plus button opens a searchable picker of any emoji, with no approval from anyone; it works by touch and by keyboard, returns focus when it closes, and the emoji appears as its own chip for everyone. | done |
| E5 | Browse the archive | The archive lists delivered rounds newest-first; opening an older one renders without needing the current round to exist. | done |

## F · Loop settings

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| F1 | Change cadence or timezone | Saving a new weekday, hour, cadence or timezone changes when the round goes out, shown to the owner, and moves the open round to the new delivery. | done |
| F2 | Pause and resume | Pausing holds the open round (no delivery, no answers) and says so on the dashboard; resuming picks it up again, due at the next delivery if its own has passed. | done |
| F3 | Remove a member | Removing a member stops their emails and revokes their links; their past answers remain in delivered rounds. | done |
| F4 | Delete a loop | The owner confirms by typing the loop name; the loop, its rounds, replies and outbox rows disappear and `/g/<id>` 404s. | done |
| F5 | Non-owner is refused | A plain member visiting an owner route gets a 404/403 page, and the same request as a POST is rejected server-side. | done |
| F6 | Reset share links | Resetting gives every delivered round a new share URL; a URL handed out before the reset 404s, and turning sharing off disables every existing link. | done |
| F7 | Fix a member's address | An owner or admin corrects the address of someone with no account yet. The membership and its answers stay, the old link stops working, and the new address gets an invitation. Someone who has signed in moves their own address instead. | done |

## G · Roles and permissions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| G3 | Promote to admin | Promoting a member to admin lets them manage questions and members, while the owner-only actions stay unavailable to them; the promotion reaches that person's already-signed-in session. | done |
| G4 | Reader cannot reply | A direct POST to the reply endpoint from a reader is rejected with 403 and writes nothing. | done |

## H · Preview

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| H1 | Preview screens and emails | Every `/dev` route answers 404 outside local development until a keyed visit to `/dev/ui` sets the cookie, and a wrong key keeps it that way; nothing signs an unkeyed visitor in. With the key, the screens and email templates open. On production the key opens only the inboxes: the demo, whose tokens are public, is never seeded. | done |

## I · Suggested questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| I1 | Suggest a question | A contributor sees a "suggest a question" affordance on the reply sheet, writes a question, picks how their name shows ("asked by Maya" or anonymously), submits, and sees a quiet confirmation. The suggestion is web-only: no email is sent. | done |
| I2 | Owner reviews the queue | The loop dashboard shows pending suggestions with author display and text; accept turns it into an active pool question attributed to that membership; decline removes it from the queue; edit-then-accept stores the edited text. | done |
| I3 | Suggested question in a round | When an accepted suggestion is selected for a round, the delivered round credits it ("asked by Maya") unless the author chose anonymity; past rounds keep their original credit. | done |
| I4 | Readers are walled off | A reader has no suggest link, and a suggest URL reached by a reader (or a revoked token) shows the standard no-access screen with no data leak. | done |

## K · Answer formats

What were sections are items asked every round in the one list of things to ask (`specs/architecture.md` §13), added and edited on the Questions page like any other (C1, C4). A written item takes text, one photo and a voice note; photo walls and music picks are their own answer formats, and any item can be owners-only.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| K3 | Written item reply | Contributors answer a written item asked every round (a former standard section) on a written card: text and one photo (and a voice note), under the same media rules and caps as any answer. A sheet loaded before the switch still saves through its old section endpoints. | done |
| K4 | Photo wall reply | Contributors add up to six photos to a photo wall, each with an optional one-line caption; the delivered round lays them edge-to-edge, each with its author and any caption, and tapping one opens it full size in the same viewer as the Album (previous/next, Escape returns focus) with a Download button. Each person's photos take reactions and comments, on past photo walls too. | done |
| K5 | Paste a music link | A music-link item accepts a Spotify, Bandcamp, or Qobuz link, with an optional caption; a non-music URL gets the plain-language error and nothing is saved until it is fixed or cleared. Any written answer can carry one too, beside its words, photo or voice note ("Music link" with the attachments): it saves when the field is left, comes back on the next visit, "Remove link" takes it off and leaves the words, and the delivered round shows it as a music card and the email as a link. | done |
| K6 | Music renders | The delivered round's web page renders every music pick as a card (artwork when the metadata provides it, title, provider badge) that opens the provider page, and it takes reactions and comments like any answer; the delivery email renders title + link. Playable Spotify/Bandcamp embeds are stretch. | done |
| K7 | Owners-only items | Any item can be restricted to owner/admin contributors; other members don't see it on the sheet, in prompts (nor in their count), in a delivery email, or in the delivered round, and can't react to or comment on its answers. | done |

## J · Voice replies

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| J1 | Record an answer | On the reply sheet a question offers "record a voice note"; record, stop, preview with duration, attach. Autosave persists the audio, and it is an answer on its own; reloading keeps it. | done |
| J2 | Replace and remove | A member can re-record over an attached note or delete it, before and after delivery; post-delivery replacement keeps the `added_after_delivery` truth on the round's web page. | done |
| J3 | Limits, plainly | Duration cap (target 2 minutes, hard stop 3) and size cap produce the same warm plain-language error, never a 500. | done |
| J4 | Where recording isn't possible | A browser without MediaRecorder sees "your browser can't record here" plus a file-picker fallback accepting m4a/mp3/webm/ogg within the same caps; a page that isn't https says that instead (browsers expose no microphone there and never prompt), a refused permission or a missing microphone is named as such, and a refused permission offers "Show me how": a dialog that animates the steps for this browser (the Settings app on an iPhone, the address-bar icon elsewhere) and a Try again that asks once more. | done |
| J5 | Reading and the email snapshot | The round's web page renders a styled audio player; the delivery email renders a "Voice note · listen on the web" card (email never attempts to embed audio). | done |
| J6 | Media parity | Audio files get long random names and are stored exactly like photos (local in dev, Blob in prod); share-link visitors can hear a shared round's notes under the same rules as photos. | done |

## L · Polls

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| L1 | Author a poll | Owner adds a poll question (prompt, two to six options, single or multiple choice) with the Questions page's add card; it appears in Up next labelled as a poll with its options, and moves, stops and takes turns like any question. The next round freezes its options. | done |
| L2 | Answer a poll | A contributor picks one option (or several, on a multiple-choice poll) on the reply sheet and can change or clear the pick until delivery. The tally is never shown before delivery: not on the sheet, and not on the round's web page, where only the viewer's own pick appears. | done |
| L3 | Read a poll | The delivered round shows every member's pick next to their name with a total tally; share-link visitors see the same, and the delivery email carries the picks and the results. | done |

## M · Richer comments

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| M1 | Mention a member | Typing @ in a comment box offers matching member names in a keyboard- and touch-usable list; the saved comment stores the membership reference and renders as that person's current name; each mentioned member (readers included, never the author or a revoked member) receives exactly one email linking to the round, and posting the same comment twice never emails twice. | done |
| M2 | Toggle comments | With commenting off, every comment surface disappears for everyone (the round's own thread, per-answer threads, composers) and the write route refuses; past comments stay stored, and turning it back on restores them. | done |
| M3 | Answer threads | A comment can be posted on a specific answer; it renders with that answer and never appears in the round-level thread. | done |
| M4 | Quote and attach | Replying to a comment quotes it into the composer; a comment can carry one photo under the same type and size caps as answers; a quote of a removed comment reads as removed. | done |

## N · Loop identity and lifecycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| N1 | Choose a theme | The owner picks one of the curated papers (and optionally an accent colour and a header picture) in settings, with a live light-and-dark preview; the dashboard, reply sheet, web page, share view and every email header render it from one token set; an accent that would be hard to read is nudged to pass WCAG AA, and every preset passes the axe audit in both schemes. Only the owner can set the picture. | done |
| N2 | Default stays Gingham | A loop that never chose a theme renders exactly as before — no stationery rule injected, no banner, the original colours in light and dark and in email; choosing Gingham again stores nothing; the sign-in surface never wears a loop's paper. | done |
| N3 | Transfer ownership | The owner hands the loop in one step to anyone in it who has joined (answered or signed in), admin or not, through a confirmation that names the new owner and what they give up; someone who never answered or signed in is not offered. The founder becomes an admin who still writes, the new owner writes too (a reader becomes a contributor), owner-only actions move, sessions and reply tokens are untouched, and the old owner cannot hand it back without the new owner. The role menu no longer offers "Owner", and a handover that has gone stale changes nothing. (Supersedes G5.) | done |
| N4 | Name a round | The owner names a round (before or after delivery); the name shows in the rounds list, the dashboard, the reply sheet, the round's web page and share view, and the delivery email's subject and heading; clearing it brings "Round N" back; only the owner is offered the control. (Ticket 3's R1 is this flow.) | done |
| N5 | Profile photos | A member sets and removes their own photo — straight from their invitation link (on the reply sheet, or on the quiet page a reader or a not-yet-open loop lands on), or on the people page when signed in; it renders in the member list, on their answers and in comments, falling back to the initial; it belongs to that loop's membership only, and the photo routes answer only the person they belong to. Someone added by email alone is greeted without their email handle, with the name field already open. | done |
| N6 | Dress the loop | The owner picks a page background, a pack of paper textures, a separate pack of washi tape and a mascot in settings, each saved as it's chosen and previewed in place. They reach the dashboard, reply sheet, web page and share view in light and dark and pass the accessibility audit; the mascot also reaches every email header as an image. The originals are stored as nothing and add no CSS, and only the owner can change any of it. | done |
| N7 | Charm and frame | A member picks a sticker for beside their name and a frame for their picture, on their reply link or on the people page; both save as they're tapped and follow their answers and comments, the charm into delivery emails too (the name stands alone with images off). They belong to that loop's membership only, the routes accept only our own stickers and frames, and only from the person they belong to. | done |

## O · Events and birthdays

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| O1 | Add an event | The owner or an admin adds, with the add card asked "On a date", a one-time event (title, emoji, date) or an annual birthday tied to a member (emoji, date; the year is ignored); it lists under Up next's "On a date" soonest first with its next date, can be edited in place or stopped, and a date already gone by is refused with a plain message. Members never see the dates. | done |
| O2 | Event lands in the right round | The sweep puts an event whose local date falls in a round's days into that round as a card titled with the event (or "Maya's birthday"), after the round's turn-takers and every-round items; contributors other than the birthday person see it on the sheet, reply with a message and a photo, and it travels in the delivery email and on the round's web page. An event outside those days is left for the round that holds it. | done |
| O3 | Birthdays recur | A birthday places exactly one card per year, in the one round whose days hold the date (loop timezone), however many rounds open around it or however often the sweep runs; a round shorter than the cadence still catches a date between two rounds, a round crossing New Year catches both sides, and 29 February keeps to 28 February in years without one. | done |
| O4 | Past truth | A round keeps the title, emoji and place of the event card it was given even if the event is later edited or stopped or the member is renamed; replies already written stay with it. | done |

## P · The Album

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| P1 | Browse the album | A member opens the Album — a tab of the loop, or a link on any delivered round for people who read from their inbox — and sees every photo and voice note from delivered rounds (answers and photo walls, past sections included), newest round first and grouped under the round's name; voice notes play in place, photos open in a keyboard-and-touch-usable fullscreen viewer that offers a download, and "view in the round" lands on that very answer. Nothing from an open round, an unsent answer an old round went out without, or an owners-only item the viewer cannot read is shown. | done |
| P2 | Filter and search | Choosing one person and searching a word (matched against answer text, photo captions, and the question or section it answered; every word must turn up) each narrow the Album, alone or together; the URL carries the filters, a long album grows a page at a time without losing them, and an empty result says so plainly with a way out. | done |
| P3 | Privacy holds | Share-link visitors get no Album route, link or data; strangers, revoked members, other loops' members and bad tokens get the plain not-found page with nothing of the loop in it; the media addresses stay unguessable. | done |

## Q · Keepsake export

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| Q1 | Print a round | A delivered round (on the member page or the share link) offers "Print this round", which opens the same address with `?print`: the round on plain light paper, named authors rather than "You", with the questions, answers, photos, voice-note cards, poll picks and tallies, credits, sections, reactions and comment threads laid out for paper. Under print media the toolbar, theme switch and skip link are gone, each question starts a new page, answers, photos, cards and comments never split, nothing overflows sideways, and a dark screen or a tinted preset still prints as light paper. A round that has not gone out has no print action and `?print` leaves it unchanged; nothing opens the print dialog but a click. | done |
| Q2 | Late edits stay true | The print view holds no copy of the round: it reads the same canonical state as the web round, so a taken-down comment, commenting switched off, a renamed round and answers stored as changed or added after delivery (from before a reply link only reached the open round, which now refuses writes to a delivered round) all show on the next print, everything added after delivery marked "Added late". | done |

## R · Reading and delivery controls

Round names (Ticket 3's R1) ship as N4; R4 (one-by-one delivery) is a documented stretch and has no flow.

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| R2 | Find one member's answers | The rounds list can be narrowed to the delivered rounds one person answered in (open rounds are not listed while filtering, a person with none gets a plain empty message and a way out, a made-up id is no filter), and "Read it" opens that round already isolated to them. Inside a round, a row of plain links isolates one person's answers (their name carries a check and `aria-current`), or reads the round by person — one card per author in name order, each answer under the question or section it answered — with a link back to everyone. A person who wrote nothing in the round, or a bad address, reads as everyone; the print view and the share link always show the whole round. | done |
| R3 | Reminder switch | Each contributor has one on/off switch, "Remind me before it goes out", on their own answer page (on by default); it saves as they flip it, belongs to that loop's membership, and only they (by their token) can set it — a reader, a stranger or a bad value writes nothing, and opening the page or the email changes nothing. It stores "all" or "none"; a stored "last" from the old three-way choice reads as on, and an old page sending "last" stores on. The loop's automatic reminder skips anyone switched off and reaches the rest exactly once however often the sweep runs; prompt and delivery emails ignore it, and the owner's nudge by hand still reaches everyone who has not submitted. | done |

## S · Feedback

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| S1 | Send feedback | A button in the corner of every page opens a one-box form; anyone, signed in or not, sends a note with one tap, and the page, screen size and browser travel with it. A signed-in person or a reply link is named from the request itself, never asked; reply and share tokens are stripped from the stored page. A blank note cannot be sent, a failed send keeps the words, an hour's flood is refused, and the notes are read in the key-locked `/dev/feedback`. | done |
| S2 | Stats and blocking | `/dev/stats`, behind the key, shows people, loops, rounds, bounces and the day's email count, with one row per loop. Blocking an address stops sign-in, ends sessions, pauses the loops it owns and drops their unsent mail; unblocking restores sign-in. | done |

## V · Your data

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| V1 | Privacy and terms | `/privacy` and `/terms` are public pages in plain language, linked from the landing page footer, the sign-in page and under every email's footer; the privacy page names what is stored, the processors (Vercel, Neon, Resend, Vercel Blob, Sentry), how long it is kept and how to export or delete it. The landing page also links to the source on GitHub. | done |
| V2 | Delete my account | From `/you`, a signed-in person confirms by typing their email address; a mismatch deletes nothing. Their user, sessions, memberships (signed in or only invited by that address), answers, photos, voice notes, comments, reactions, suggestions, birthdays, feedback, email trail and abuse counters go in every loop, the stored files are removed (retried by the sweep if storage refuses), they land signed out on `/goodbye`, and delivered rounds show nothing from them. A loop they own alone goes too; one with anyone else in it refuses the deletion and offers "Hand it on" and "Delete the loop" instead. | done |
| V3 | Leave through the reply link | The answer page (and the reader and nothing-open pages) offers "Leave this loop and delete my answers"; the leave page is a GET that changes nothing, and a ticked confirmation POST removes the membership and everything written in that loop only, including files; the link then stops working and the round reads on without them. The owner's link explains how to hand the loop on or delete it instead. | done |
| V4 | Export | "Download my data" on `/you` streams a JSON file of the person's own words in every loop (including unsent answers an old round went out without, links to their photos and voice notes); the leave page offers the same for one loop by reply link; the owner's settings offer the whole loop archive (every round that has gone out, with each question, answer, section, comment and reaction; not the open round, and no unsent answer an old round went out without). The archive answers 404 to members and strangers, and the personal export sends a signed-out visitor to sign in. | done |
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
| U1 | Stop emails from a loop | Every loop email (invite, prompt, reminder, mention, delivery, paused notice) carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` naming that membership's own unsubscribe token, plus a visible "Stop emails from this loop" footer link in HTML and plain text; sign-in emails carry neither. Opening the link (or a GET on the one-click URL) changes nothing and asks first; confirming mutes. A one-click POST mutes with no confirmation and answers 2xx. A muted member stays in the loop: their reply link still works and shows a "turn emails back on" notice (on the reply sheet and on a delivered round), prompts, reminders, nudges and delivery emails to them are recorded as suppressed and never sent, and owners and admins see "Emails off" on the people tab. Unmuting from the reply page or the unsubscribe page brings the next email back. | done |
| U2 | Bouncing addresses | A Resend webhook is accepted only with a valid Svix signature inside the five-minute window (a bad signature or an old timestamp gets 401 and records nothing; a redelivery is recorded once); each event is stored in `email_events` linked to its outbox row. A hard bounce or a spam complaint suppresses the address: later loop emails to it are recorded as suppressed, sign-in links still go, and the people tab shows the member as "Bouncing" with how to fix it. | done |
