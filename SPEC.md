# Friendloop — Specification

Consolidated from the four source documents in this repo. Each part is kept
verbatim; the originals remain authoritative and are the files to edit.

| Part | Source |
| --- | --- |
| I | [`PRODUCT.md`](PRODUCT.md) |
| II | [`specs/architecture.md`](specs/architecture.md) |
| III | [`specs/flows.md`](specs/flows.md) |
| IV | [`DESIGN.md`](DESIGN.md) |

---

# I · Product

*Source: `PRODUCT.md`*

## Platform

web

## Users

A single private group of friends, mostly in their 30s, scattered across several
timezones. They want to stay close without another group chat. One of them (the
owner) sets it up and keeps it alive; the rest are contributors who answer when a
prompt arrives in their inbox and readers who enjoy the result.

The job: turn "we should catch up more" into something that actually happens once
a week, without anyone having to schedule a call or remember to write.

## Product Purpose

Friendloop is a private group newsletter. A loop asks everyone a small set of
questions on a recurring schedule, collects each person's answers privately
through a link in their email, and compiles them into a round that is
delivered back to the whole group.

Success is a loop that keeps running: prompts go out on time, most people answer,
and each round is something people are glad to read. It exists because the group
asked for it, it is meant to be genuinely nice to use, and it is free to run.

## Positioning

A Letterloop-shaped product that is free, open source, and self-hostable, and that
asks nothing of the people who only want to answer questions: no account, no app,
no password — a link from the inbox opens the form. Everything the owner needs
(questions, cadence, delivery) lives in one dashboard, and every reply is
attributed to a person the group already knows.

## Operating Context

- Most replies happen on a phone, inside a mail client, within a day of the prompt.
- The owner is the only person who manages anything, and does it in short bursts:
  set questions, invite someone, nudge stragglers.
- The loop goes out on a fixed weekday and local hour in the loop's own timezone,
  weekly or less often. A round is open for answers from one delivery to the next,
  so there is always one to answer.
- Members live in different timezones; every deadline is shown in the loop's time
  and the reader's own.
- Email is the entire delivery surface: prompts, reminders, delivered rounds, and sign-in
  links all arrive by mail from one sender address with the loop's display name.

## Capabilities and Constraints

Confirmed for v1:

- Invite-only membership; anyone can create a loop, joining requires an invite.
- Roles are two axes: access (`owner` / `admin` / `member`) and participation
  (`contributor` / `reader`), chosen when inviting. The owner is always a
  contributor. There is no invitation to accept or let lapse: someone is in the
  loop, and their link works, until they are removed.
- Contributors reply through a tokenized link with no account. Management actions
  require a signed-in session.
- Question pool: a preset bank plus custom questions written by the owner.
- One photo per reply.
- Delivered rounds have comments and reactions. Comments can be hung from a single answer, quote another comment, carry one photo, and @mention any member (readers included, who get an email). The owner can turn commenting off for the loop; nothing is deleted.
- Polls are a kind of question: two to six options, single or multiple choice. Contributors tap to answer, and the tally appears only once the round is delivered.
- A delivered round can be shared by secret link, off by default.
- Weekly, biweekly, monthly or quarterly cadence, per-loop timezone. Answering is
  open the whole time between deliveries.
- Nobody misses out: a round is open right up to its delivery, the next one
  opens as it goes out, and a round with nothing in it carries over rather than
  going out empty. The round's web page is canonical while the email is a snapshot.
- Runs on free tiers: Vercel Hobby, Neon, Resend.

Explicitly undecided: whether a loop can be public/discoverable, native apps,
member-suggested questions.

## Brand Commitments

- The name is Friendloop. The loop is the unit, and each time it asks and delivers
  is a **round**: "Round 8" on every page and in every email, never "issue". One
  thing has one name (the group chose "round" in November 2026). Where "round"
  would read oddly, rephrase ("everyone gets the round", "when it goes out").
  Code, tables and routes still say `issue`; that never reaches a person.
- The voice is warm, plain, and a little playful. It reads like a note from a
  friend, never like SaaS. Exclamation marks are rare, emoji are rare and earned.
- Nothing about the product should feel like work software: no streaks, no
  productivity metrics, no "engagement".
- Light and dark are both first-class.
- The interface is deliberately conventional: a clean, quiet product surface with
  white cards, one blue accent, and no metaphor. Expressive visual worlds were
  explored and rejected; warmth comes from the words, not from the frame.

## Evidence on Hand

No testimonials, logos, customer counts, benchmarks, or press exist and none may
be invented. The only real content is the group's own names, questions, and
answers, which are seeded as sample data during development.

## Product Principles

1. **The reply is the product.** Every decision that makes answering slower,
   scarier, or more effortful is wrong, even if it is more correct.
2. **The link in the inbox is the front door.** No account walls on the path a
   contributor actually walks.
3. **Time is a promise, not a guess.** Deadlines are stated in the reader's own
   clock, and a late answer is never punished.
4. **The owner's job is small.** Managing a loop should fit in a couple of minutes
   a week, or the loop dies.
5. **It has to run for free.** Any dependency that costs money per month is out
   unless it is free at this scale.

## Accessibility & Inclusion

- The reply form is a phone-first surface used by non-technical people: 44px
  targets, visible focus, large tap areas, no hover-only affordances.
- Reading surfaces must hold up at 200% zoom and in both color schemes.
- Email HTML must be readable with images off and in a plain-text client, because
  that is how a chunk of the group will read it.

---

# II · Architecture decisions

*Source: `specs/architecture.md`*

The load-bearing choices, and why. Read this before changing the data model, the
scheduler, or anything that sends an email.

## 1 · Time and email are seams, not call sites

Two things make "test 100% of flows" either real or a lie: the clock and the
outbox. Both get one choke point.

- **`src/lib/clock.ts`** — `getNow()` is the only way request-handling code reads
  the current time. With `E2E=1` it honours an `x-e2e-now` header so a test can
  jump to delivery day. Pure logic (`sweep`, `schedule`, `deliver`) never calls it;
  it takes `at: Date`. Deterministic cores, one impure boundary.
- **`src/lib/email/send.ts`** — every send writes an `outbox` row first, then
  hands off to Resend. Tests read the real rendered HTML out of `outbox` instead of
  running a mail server. `dedupe_key` is unique, so a retried cron run or a
  redeploy never double-sends.
- `EMAIL_TRANSPORT=outbox` skips the provider entirely (used by tests and by
  local dev without a Resend key).

## 2 · The scheduler converges; it never "fires"

There is no event that says "it is Friday now". Vercel Hobby allows only one cron
run per day per job, with ±59 min of precision, so any event-driven design would
be wrong most of the time.

Instead every run of `/api/cron/sweep` reconciles state:

1. For any `open` round past `deliversAt` (in a loop that isn't paused), deliver
   it and open the next round in the same step; the delivery email carries the
   new round's questions. A round with nothing in it moves its `deliversAt` to
   the next slot instead, and on its third empty delivery is `skipped` and pauses
   the loop.
2. For any running loop with no open round, open one due at the next slot and
   queue the prompt emails. (Creating a loop and resuming one open it directly.)
3. Remind contributors who owe an answer 48 hours before `deliversAt`.
4. Retry `outbox` rows still `pending`.

`unique(group_id, slot_at)` plus `dedupe_key` make every step idempotent, so a late
run self-heals and a doubled run is a no-op. Triggers:

- Vercel Schedule, every 15 minutes (`vercel.json`) — cannot be disabled for inactivity.
- GitHub Actions every 15 minutes — fine granularity, free.
- Both hit the same endpoint (`.github/workflows/sweep.yml` is the GitHub one); a
  transaction-scoped `pg_try_advisory_xact_lock` (pooler-safe) keeps concurrent runs from
  duplicating work (and the constraints cover the rest).

## 3 · Schedules are local wall-clock, resolved on demand

A loop stores `timezone`, `prompt_weekday`, `prompt_hour`, `cadence_weeks`: the
moment its round goes out (the `prompt_*` names are left from when they opened a
round). It never stores a precomputed future instant, because a DST transition
would silently shift it. Instants are resolved with `Temporal.ZonedDateTime` from
`temporal-polyfill` at the moment they are needed, and only the open round keeps a
frozen `slot_at`/`delivers_at`.

A round runs from one delivery to the next: `opens_at` is when the previous one
went out (or the loop was created), `delivers_at` the next slot after it, however
close that is. `slot_at` is the slot it was opened for, so `slot_at` to
`delivers_at` counts how often an empty round was carried over. Editing the
question pool or the sections while a round is open changes that round, except
that anything someone has started answering stays. "Send now" delivers the open
round early and the next one is due at the slot after the one it replaced.

Every human-facing deadline renders twice: the loop's time and the reader's own.

## 4 · Identity: two kinds of session, one membership table

- **Contributors and readers** authenticate with a tokenized link
  (`memberships.reply_token`, 32 random bytes). Opening it sets a signed, httpOnly,
  loop-scoped cookie so the archive and edits keep working without the URL. No
  account is ever required to reply.
- **Owners and admins** need a real session for management actions. Magic-link
  sign-in: `magic_links` stores only a hash of the token, 15-minute TTL, single
  use; `sessions` stores only a hash of the cookie value.
- `memberships` is the join: `email` is always present, `user_id` is nullable until
  that person signs in. Roles are two independent axes — `access`
  (`owner|admin|member`) and `participation` (`contributor|reader`) — because
  "admin who only reads" is a real state. Invariant: the owner is always a
  contributor. (`groups.mode` is a leftover column: every loop is a group loop.)

**GET never mutates.** Mail scanners pre-fetch every URL in an email, so the token
link renders and sets a cookie but never writes product state. Every state change
is a POST (server action or route handler) behind a confirm.

## 5 · Email is a snapshot, the permalink is canonical

Delivery compiles every answer in the round into (a) an email and (b) a live page;
comments and reactions live on the page. An answer is whatever someone has saved
that isn't empty (§24): there is no send step, so a person who writes and closes the
tab is in. The reply link only ever reaches the round that is open, so once a round
goes out the link moves on to the next one, and a delivered round takes no more
writes (a paused loop's link reaches none). Answers marked "added later"
(`added_after_delivery`) are history from before that rule and are still shown;
nothing writes the flag any more. The "missed it by three hours" failure mode is
removed by there always being a round to answer, not by timezone cleverness.

A round with no answers in it (nothing written, or only answers cleared back to
nothing) is carried over to the next delivery; on its third empty delivery it is
`skipped`, not sent, and pauses the loop.

## 6 · Release safety

| Layer | Trigger | On failure |
| --- | --- | --- |
| CI | every PR | blocks merge |
| Preview | Vercel preview | blocks merge |
| Probe | production deployment READY | `POST /v1/projects/{id}/rollback/{deploymentId}` |
| Monitor | every 15 min | alert only |

The probe runs against a synthetic tenant (`is_synthetic`, excluded from counts,
cleaned weekly). It retries once before rolling back, and only ever rolls back to a
deployment that itself passed. If the rollback target also fails, it stops and
pages a human.

**Expand/contract migrations only.** Rollback reverts code, not schema, so no
destructive DDL in the release that depends on it: add nullable → backfill → write
→ read → drop a release later. `scripts/check-migrations.mjs` fails CI on
`DROP`/`RENAME`.

What actually runs today: errors go to Sentry when a DSN is configured (tokens,
cookies, and bodies scrubbed first); the sweep checks in to a Sentry cron monitor
and writes a `heartbeats` row; `/api/health` (CRON_SECRET) turns 503 when that
heartbeat is older than 2 hours or outbox mail has been stuck for 26 hours; and
`.github/workflows/monitor.yml` probes it every 30 minutes. `/api/healthz` is the
public, detail-free liveness check.

Deliverability is monitored separately from function: Resend webhooks →
`email_events`, with a daily canary that asserts a `delivered` event arrives.
The same webhook (`/api/webhooks/resend`, Svix signature checked with
`node:crypto`, five-minute replay window, `svix-id` stored uniquely) writes
`email_suppressions` on a hard bounce or complaint. `sendEmail` consults it, and
the membership's `muted_at`, before anything leaves: a held-back email is still an
outbox row, with status `suppressed` and a reason. Only `signin` is exempt.

## 7 · Rendering

Cache Components is enabled. Routes whose whole body depends on one indexed query
(`/r/[token]`, `/you`, `/g/[id]`) declare `export const instant = false` and block
on the server: a 5ms query is faster than a skeleton, and a skeleton of a form is
worse than the form. Routes with mixed static shell and per-user data should stream
that data inside `<Suspense>` instead. Mutations are Server Actions.

## 8 · One database driver everywhere

`postgres.js` over the standard wire protocol, not Neon's HTTP driver: the same code
talks to a local container in tests and to Neon's pooled endpoint in production
(`prepare: false` keeps it pooler-compatible). This is what makes a real Postgres
available to Playwright without a second data path.

## 9 · Writes go through one POST, not a Server Action

`POST /api/reply/<token>` handles every save, and a save is all it takes for an
answer to be in the round (§24). The old `submit` action is still accepted from a
sheet loaded before that, checks the link and changes nothing. A Server Action would
work, but a reader or a removed member has to be refused with a real HTTP
status, and a status is the only thing a test can assert on directly. The same rule
covers the round view: reactions are Server Actions because they are only ever
reachable from a page that already resolved who you are. Comments are a route
handler (`POST /api/issue/<id>/comments`, multipart) for the same reason replies
are: they carry a photo, and a refusal should be a real status. See §15.

## 10 · Management is two roles, one page each

`/g/<id>/members`, `/questions`, `/issues` are owner **or** admin. `/settings` is
owner only, and a non-owner visiting it is redirected back to the loop rather than
shown a 403 — a loop they cannot manage should not advertise a door. `owner` is the
only role that can delete, transfer, or change the schedule.

## 11 · There are no invitations, only memberships

An invitation is just the first email a membership gets. A reply link is a standing
credential for someone in the loop, from the day they are added until they are
removed (`revoked_at`); nothing about it ages. An earlier version let an unopened
invitation lapse after 14 days while the same person kept receiving every prompt,
reminder and delivery, which taught people an "accepted" state they could not see and
readers could never reach. `accepted_at` survives only as "has answered or signed in
at least once": the people tab uses it for a quiet "Hasn't answered yet" on a
contributor, and a handover requires it. "Resend invite" re-sends the same link, and
re-inviting a removed address revives the membership with a fresh token.

## 12 · The reply sheet is a credential page

`/r/<token>` resolves the token to a membership on every request; the token is the
credential, and management actions never accept it. GET only renders — every write
is a Server Action, because mail scanners prefetch every URL in an email.

---

# III · Flow inventory

*Source: `specs/flows.md`*

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
| A1 | Request a magic link | Submitting a known email writes one `outbox` row of kind `signin` containing a `…/signin/confirm?token=` URL, and the UI says "check your inbox". | done |
| A2 | Sign in with a valid link | Following that URL from the email sets a session cookie, redirects to `/you`, and the header shows the account's name. | done |
| A3 | Expired or reused link | A second visit to the same confirm URL (or one past its 15-minute TTL) shows a recoverable "this link has expired" screen with a "send me a new one" action, never a 500. | done |
| A4 | Unknown email | An address with no account gets the identical "check your inbox" screen and the same email; the account only comes into existence when the link is used. | done |
| A5 | Sign out | Sign out clears the session, `/you` redirects to `/signin`, and the previous cookie no longer authenticates. | done |
| A6 | Revoked reply token | Opening a reply link whose token was rotated shows a "this link was replaced" page with no form and no data leak. | done |

## B · Create and invite

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| B1 | Create a loop | Owner picks name, cadence, timezone and hour; the loop is created with them as owner+contributor, and lands on the loop dashboard. | done |
| B2 | Pick starting questions | During creation the owner selects at least one question from the preset bank; those questions exist on the loop in the chosen order. | done |
| B3 | Invite several members | Pasting three addresses creates three memberships with distinct reply tokens and three `invite` rows in the outbox; each email names the loop and contains that member's own link. | done |
| B4 | Open an invite link | A contributor opening their invite link lands on the reply form for the current round with their name shown, without signing in. | done |
| B5 | Resend an invitation | Resending re-sends the same link to someone who has not answered or signed in yet, does not rotate the token, and does not create a duplicate membership. | done |
| B6 | Links never expire | A reply link works for as long as its membership is not removed: one sent months ago and never opened still opens the sheet and saves an answer, which counts as having joined. Removing the person is what ends it ("this link doesn't work anymore"). The people tab shows no invitation state: a contributor who has never answered or signed in reads "Hasn't answered yet", a reader shows nothing, and "Resend invite" sends the same link again. | done |
| B9 | Invite to answer or to read | The invite form on the people tab, and the new-loop wizard's people step, ask how the people take part: "Answer and read" (the default) or "Just read". A reader's membership is created as a reader and their invitation says "Have a look" with nothing to answer, never "Answer the first round"; on the people tab they show as "Reads only" with no "Hasn't answered yet". | done |

## C · Questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| C1 | Add anything to ask | One add card adds a written question, poll, photo wall or music link, taking turns, every round or on a date; a turn-taker waits in Up next unless asked this round too, while an every-round item or a date in this round's days joins the open round at once. | done |
| C2 | Reorder the queue | Moving a turn-taker in Up next (drag, tap for Up and Down, or keyboard) changes the order coming rounds ask them; the open round keeps its own order. | done |
| C3 | Stop asking | Stop asking takes an item out of Up next and, unless someone wrote there, the open round; Ask again brings it back, and past rounds still render its original text. | done |
| C4 | Edit this round | The open round's items are edited directly: removed (a turn-taker goes first in line for the next round), reordered, added to, and reworded in place unless someone has written there. | done |

## D · The round cycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| D1 | Always a round open | A running loop without an open round gets one at once from the sweep, due at the next delivery, with one `prompt` outbox row per contributor; creating a loop opens round 1 the same way. | done |
| D2 | Do not open twice | A second sweep, or two at once, opens no second round and sends no duplicate email. | done |
| D3 | Send now | "Send now" delivers the open round with the answers in so far, opens the next round straight away, and that round is due at the delivery after the one it replaced. With nothing in the round it sends nothing. | done |
| D4 | Answers save as you go | Typing an answer saves it straight into the round; there is no send step. The sheet says, beside the deadline, that everything written goes out then, finished or not, and that clearing an answer leaves it out; reloading the reply page restores every answer. | done |
| D5 | Done | Done waits for the last words typed to save, then replaces the sheet with a confirmation (focus on its heading) that names the round, says everything written goes out at the delivery time and that clearing an answer leaves it out, and offers "Back to my answers", which brings the sheet back with every answer intact. Done with nothing written points at the first question instead. The owner's progress count includes someone as soon as an answer of theirs saves, without Done. | done |
| D6 | Change or clear an answer | Before delivery, changing an answer updates its row in place without creating a duplicate; clearing it back to nothing takes it out of the round, the round's page and the progress count. | done |
| D7 | Deliver the round | With the clock past the delivery instant, the sweep sends one delivery email per member containing every saved, non-empty answer, the round's status becomes `delivered`, and the next round opens with its questions in each contributor's email. | done |
| D8 | Nothing to deliver | A round reaching its delivery instant with nothing written in it (or only answers cleared back to nothing) sends no email and is carried over to the next delivery; on its third empty delivery it is marked `skipped` and pauses the loop with an explanation to the owner. | done |
| D9 | Nudge the stragglers | 48 hours before delivery, contributors with nothing written get exactly one reminder; anyone with a saved answer (a question or a section) gets none, and a second sweep sends no duplicate. | done |
| D13 | Answer from the app | A signed-in member who answers in the loop sees a primary "Answer round N" button on the overview's open-round card, and the same link on that loop's card on `/you`; both go to their own reply link and the page carries nobody else's. Once they are among the round's "in" people it reads "Edit your answers" and steps back to a quiet button. A reader, or anyone in a paused loop, sees neither and is sent no reply link. | done |

## E · Reading and reacting

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| E1 | Read a delivered round | A member opening `/i/<n>` sees every question with each contributor's answer, their own marked, and the round's date. | done |
| E2 | Read by share link | With sharing enabled, an anonymous visitor at the share URL reads the same round and sees no other loop data or navigation. | done |
| E3 | Comment on a round | A member posts a comment, it appears for other members immediately, and an empty comment is rejected. | done |
| E4 | React to an answer | A member adds a reaction to someone's answer, the count updates for everyone, and toggling removes it. | done |
| E5 | Browse the archive | The archive lists delivered rounds newest-first; opening an older one renders without needing the current round to exist. | done |

## F · Loop settings

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| F1 | Change cadence or timezone | Saving a new weekday, hour, cadence or timezone changes when the round goes out, shown to the owner, and moves the open round to the new delivery. | done |
| F2 | Pause and resume | Pausing holds the open round (no delivery, no answers) and says so on the dashboard; resuming picks it up again, due at the next delivery if its own has passed. | done |
| F3 | Remove a member | Removing a member stops their emails and revokes their links; their past answers remain in delivered rounds. | done |
| F4 | Delete a loop | The owner confirms by typing the loop name; the loop, its rounds, replies and outbox rows disappear and `/g/<id>` 404s. | done |
| F5 | Non-owner is refused | A plain member visiting an owner route gets a 404/403 page, and the same request as a POST is rejected server-side. | done |

## G · Roles and permissions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| G1 | Invite as reader | A reader is invited (by choosing "Just read" when inviting), receives each round, is never prompted to reply, and their reply link shows the round without a form. | done |
| G2 | Switch participation | Flipping a member between contributor and reader changes whether the next round prompts them, and never deletes existing replies. | done |
| G3 | Promote to admin | Promoting a member to admin lets them manage questions and members, while the owner-only actions stay unavailable to them. | done |
| G4 | Reader cannot reply | A direct POST to the reply endpoint from a reader is rejected with 403 and writes nothing. | done |
| G5 | Transfer ownership | The owner transfers ownership in one step to anyone who has joined, becomes an admin+contributor, and the new owner gains owner-only actions while the old owner loses them. (Superseded by N3.) | done |

---

**41 flows.** A flow is only `done` when its spec passes locally and in CI.

---

# IV · Design

*Source: `DESIGN.md`*

Clean SaaS, executed properly: a light gray page, white cards with a hairline and a
shadow you can barely see, one blue accent that means "act here", and a warm
neutral ramp so nothing reads as cold enterprise gray. Dark mode is built from the
same relationships, not inverted at the end.

Chosen deliberately over six more expressive worlds. The group using this writes
four sentences a week on a phone in bed; the interface should be obvious at 7am
and invisible at 11pm.

## Colour roles

| Token | Job | Never used for |
| --- | --- | --- |
| `--page` | the ground behind everything | text |
| `--card` | any surface carrying reading or writing | decoration |
| `--line` / `--line-strong` | hairlines, dividers, input hover | emphasis |
| `--field` | the writing area inside a card | page background |
| `--ink` / `--ink-soft` / `--ink-muted` | body, secondary, metadata on cards | text on accent fills |
| `--accent` | the one action that matters on the screen | anything decorative |
| `--accent-soft` / `--accent-line` | the "all set" confirmation, selection tints | primary buttons |
| `--danger` / `--success` | errors, confirmations | anything else |

Exactly one accent per screen. If two things on a screen are blue, one of them is
wrong — the only exception is the focus ring, which is the same blue because focus
*is* an action.

## Type

- **Everything** is Geist Sans. Questions at 16px/600, body at 15px/400, metadata
  at 13px, the round number at 30px/600 with −0.025em tracking. Nothing below 12px.
- Numbers that count (`1 of 4 answered`) are tabular so they don't jitter as you type.
- Geist Mono exists in the tokens for code and email addresses only; it is not a
  display face here.

## Surfaces

- **Card** (`.card`): 14px radius, 1px `--line`, one soft shadow. Cards are the only
  container; they never nest, and a card never sits inside another card.
- **Field** (`.field`): 10px radius, `--field` fill, transparent border that turns
  accent on focus with a 3px 16%-alpha ring. No placeholder is ever the only label.
- **Top bar**: sticky, 56px, blurred page tint, loop name on the left, a quiet count
  chip on the right. It never carries actions.
- **Action bar**: fixed bottom, opaque card, one line of state and one primary
  button. It never floats over the field you are typing in.

## Motion

Two moves, both short:

- Cards ride in 6px over 320ms on first paint, staggered only by document order.
- The "all set" stamp settles from 96% scale over 220ms.

Nothing bounces, nothing loops, and `prefers-reduced-motion` removes both.

## Copy

Plain, second person, no exclamation marks. Buttons name their outcome ("Done",
"Save changes"), errors name the recovery, and the confirmation says what
happens next ("Everything you wrote for Round 4 goes out Friday 9:00 AM."). Time is stated in
the loop's zone with the reader's own zone in parentheses when they differ.

## Email

Same voice, same one-accent discipline: light card, serif heading, one blue button.
Readable with images off, always with a plain-text twin.

## Not yet designed

The delivered round view (`/i/<n>`) and the create-a-loop flow do not exist yet.
Both inherit this world; neither has needed its own decisions so far.
