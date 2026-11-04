# Architecture decisions

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
  local dev without a Resend key). Because that means `dispatch()`'s failure
  branch would otherwise only run in production, two narrow test seams exist:
  `RESEND_BASE_URL` points the real SDK at a local stub that can reject, and
  `x-e2e-email-transport` picks the transport per request under `E2E=1`. Both
  `x-e2e-*` headers are refused when `VERCEL_ENV=production`.

## 2 · The scheduler converges; it never "fires"

There is no event that says "it is Friday now". Vercel Hobby allows only one cron
run per day per job, with ±59 min of precision, so any event-driven design would
be wrong most of the time.

Instead every run of `/api/cron/sweep` reconciles state:

1. For each active loop, compute the scheduled slots whose instant has passed
   (`schedule.dueSlots`).
2. For any slot with no issue, create the issue, snapshot the questions, queue the
   prompt emails.
3. For any `open` issue past `deliversAt`, deliver or skip it.
4. Retry `outbox` rows still `pending`.

`unique(group_id, slot_at)` plus `dedupe_key` make every step idempotent, so a late
run self-heals and a doubled run is a no-op. Triggers:

- Vercel cron, once daily (`vercel.json`) — cannot be disabled for inactivity.
- GitHub Actions every 15 minutes — fine granularity, free.
- Both hit the same endpoint. Concurrency is handled per loop: `openDueIssues`
  takes `select … for update` on the loop row before computing the next issue
  number, so the loser collides on `unique(group_id, slot_at)` and is ignored —
  without the lock the loser would instead trip `unique(group_id, number)` and
  return a 500. `e2e/flows/D11.spec.ts` runs two sweeps at the same instant and
  asserts one round, one prompt per contributor.

## 3 · Schedules are local wall-clock, resolved on demand

A loop stores `timezone`, `prompt_weekday`, `prompt_hour`, `cadence_weeks`. It
never stores a precomputed future instant, because a DST transition would silently
shift it. Instants are resolved with `Temporal.ZonedDateTime` from
`temporal-polyfill` at the moment they are needed, and only an issue that actually
opened keeps a frozen `slot_at`/`delivers_at`.

The reply window is a fixed 7 days (`window_days`), so delivery is the same
weekday and hour, one week later, in the loop's timezone.

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
  contributor; in `from_you` mode every non-owner is a reader.

**GET never mutates.** Mail scanners pre-fetch every URL in an email, so the token
link renders and sets a cookie but never writes product state. Every state change
is a POST (server action or route handler) behind a confirm.

## 5 · Email is a snapshot, the permalink is canonical

Delivery compiles the submitted replies into (a) an email and (b) a live page.
Replies stay editable after delivery and appear on the page marked "added later";
comments and reactions live on the page. This removes the "missed it by three
hours" failure mode instead of papering over it with timezone cleverness.

An issue with zero submitted replies is `skipped`, not sent, and pauses the loop.

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

Deliverability is monitored separately from function: Resend webhooks →
`email_events`, with a daily canary that asserts a `delivered` event arrives.

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

`POST /api/reply/<token>` handles both autosave and submit. A Server Action would
work, but a reader or an expired invitation has to be refused with a real HTTP
status, and a status is the only thing a test can assert on directly. The same rule
covers the issue view: reactions are Server Actions because they are only ever
reachable from a page that already resolved who you are. Comments are a route
handler (`POST /api/issue/<id>/comments`, multipart) for the same reason replies
are: they carry a photo, and a refusal should be a real status. See §15.

## 10 · Management is two roles, one page each

`/g/<id>/members`, `/questions`, `/issues` are owner **or** admin. `/settings` is
owner only, and a non-owner visiting it is redirected back to the loop rather than
shown a 403 — a loop they cannot manage should not advertise a door. `owner` is the
only role that can delete, transfer, or change the schedule.

## 11 · Invitations expire, reply links do not

An unopened invitation is good for 14 days (`INVITE_DAYS`); a reply link is a
standing credential for someone in the loop. Ageing out a link that still works
would break "the link in your inbox is the front door", so only *pending* invites
expire, and re-inviting resurrects the membership with a fresh token.

## 12 · The reply sheet is a credential page

`/r/<token>` resolves the token to a membership on every request; the token is the
credential, and management actions never accept it. GET only renders — every write
is a Server Action, because mail scanners prefetch every URL in an email.

## 13 · Question rotation uses one cursor

`groups.questions_per_round` is nullable. Null preserves the original behavior:
every active, unskipped question goes into the issue. A positive count rotates
through the ordered pool, wrapping at the end. `groups.question_cursor` points to
the next pool position after the last selected question. Skipped questions do not
count toward the round's total.

`src/lib/round-questions.ts` is the only code that snapshots questions and advances
the cursor. Scheduled rounds and "Send now" both call it, so the two paths cannot
drift. Changing the count resets the cursor to the top. Issue question snapshots
remain unchanged when the pool or rotation setting changes later.

## 14 · A poll is a question, and a pick is a reply

Polls ride the same machinery as written questions rather than a parallel
pipeline. `questions` and `issue_questions` carry `kind` (`written` | `poll`),
`poll_multiple`, and `poll_options` (a JSON array of two to six strings); the issue
snapshot copies all three, so editing the pool never rewrites an issue that is
already out. Pool order, rotation, skip-next, archiving, and `snapshotQuestionsForIssue`
treat a poll exactly like any other question.

A pick lives on the person's `replies` row as `poll_choices`, a JSON array of
indexes into the snapshotted options. The existing unique key
`(issue_id, issue_question_id, membership_id)` still holds, `replyHasContentCondition`
counts a non-empty pick as content (so one commitment point — "Send answers" —
covers polls too), and `added_after_delivery` and reactions work unchanged. A
separate votes table was rejected: one row per pick would need its own submit,
late-reply, and reaction rules. Clearing a pick leaves the row; readers filter
empty polls out, so a cleared pick is never shown, counted, or delivered.

Writes go through `savePollChoicesFor` (`action: "pollChoice"` on the reply POST).
`checkPollChoices` validates whole — in range, no repeats, one pick unless the poll
is multiple-choice — and `ensureWritableQuestion` keeps the kinds apart: text,
photo, and voice are refused on a poll, and a pick is refused on a written question.

**Results are a delivery-time fact.** `loadIssue` returns a poll's tally only once the
issue is `delivered`; before that the tally is `null` and the only pick returned is
the viewer's own. The reply sheet never receives anyone else's picks at all.

## 15 · Comments: mentions are references, threads are anchors

`comments` carries `reply_id` (null for the issue-level thread, else the answer it
hangs from), `quote_comment_id` (a live reference to the comment being answered),
and `photo_url`. `groups.comments_enabled` is the owner's switch.

All comment writes go through `postComment` in `src/lib/comments.ts`, which refuses
before it stores: the author must be a live member (`membershipForViewer` ignores
revoked members), comments must be on, an anchor must be a submitted answer of this
issue (another member's poll pick stays hidden until delivery), a quote must be a
live comment in the same thread, and a photo must pass `validatePhoto`. The route
handler is only parsing.

A mention is stored inline as `@[<membership id>]` and drawn as the member's current
name (`src/lib/mentions.ts`); there is no mentions table, so the body cannot disagree
with itself. The composer chooses the comment's UUID, which makes a retry the same
comment, and mention emails are keyed `mention:<issue>:<comment>:<membership>`, so
they are sent once however many times the request arrives. Readers can be mentioned;
the author, revoked members and people from other loops are dropped.

`loadIssue` turns all of this into view data once: the issue thread, each answer's
thread, and the viewer's mention list. With comments off, or on a share link, those
are empty and the page renders no comment surface at all.

## 16 · A loop's identity is data, not a fork of the design

A loop's look is `groups.theme_preset`, `theme_accent` and `header_image_url`, all
null by default. `resolveTheme` in `src/lib/theme.ts` turns them into one token set
per colour scheme; `<LoopTheme>` injects it as a stylesheet on the four group-aware
surfaces and `emailPalette` reads the same tokens for mail. A loop with nothing set
renders no override at all, so the stylesheet's Gingham Picnic is the whole story and
a theme-less loop is untouched by this feature. Accents pass through `deriveAccent`,
which moves lightness until every text pairing clears WCAG AA, so the owner chooses
a hue, not a contrast ratio.

Ownership moves in `transferOwnership`: one transaction, two guarded updates, and a
refusal on either side rolls both back. `issues.name` and `memberships.photo_url` are
plain nullable columns; the unnamed and photo-less forms are the original rendering.

## 17 · An event is a date; a section is what it leaves behind

`events` holds what the owner typed: a one-time event (title, emoji, full date) or a
birthday (a membership, month and day, no year). Nothing reads it at delivery time. At
the moment a round opens, `snapshotEventsForIssue` turns each event whose local date
falls in the round's coverage into an `issue_sections` row of kind `standard` (so the
sheet, the web issue and the email already know how to show it) with its title,
emoji and description frozen, and `event_id` / `event_date` recording where it came
from. Editing or deleting the event, or renaming the member, can never reach back
into a round: the snapshot is the only copy that matters, and `event_id` simply goes
null if its event is deleted.

Coverage is calendar dates in the loop's timezone, never instants: the round's
opening day through its delivery day, stretched to the day before the next slot when
the window is shorter than the cadence, so no date between two rounds is lost
(`issueCoverage` in `src/lib/event-dates.ts`). It lands in the round that is open
when the date approaches, not the one that opens after. A unique index on
`(event_id, event_date)` makes an occurrence claimable once, which is what keeps a
retried sweep, an overlapping window, and a manual "send now" from doubling a section,
and it is also why a birthday is exactly one section a year: next year is a different
`event_date`. A 29 February birthday keeps to 28 February in years without one.

An event added or moved while a round is open is placed into that round at once if its
date is inside the window; otherwise it waits for the round that holds it. Dates that
fall before a loop's first round, or in rounds the sweep skipped over after a pause or
an outage, are not backfilled: the sweep only ever materializes the latest missed
slot. A birthday whose person has left the loop places nothing. Events work the same in
`from_you` mode (the owner is the only writer there).

## 18 · The Album is a query, not a table

Nothing is copied to build the Album. `loadAlbum` (`src/lib/album.ts`) unions three
selects — answer photos, answer voice notes, section media — each joined to its
delivered issue, question or section, and author, then filters and orders the union
once: newest round first, then the order the round reads in, with a stable key as the
last tie-break so a longer page is always a strict extension of a shorter one. A page
is `ALBUM_PAGE_SIZE × pages` rows (URL-driven, capped), and a count and the "from" list
come from the same union. There is no pagination cursor to expire and no second copy
of anything to fall out of date: a late photo, a removed photo or a deleted question
shows up on the next load.

What the Album may show is decided in the query, not the page: `status = 'delivered'`
and `status = 'submitted'` keep out open rounds and drafts; `admin_only` sections are
joined only for owner and admins; the loop id is a bound parameter, so another loop's
media cannot appear. Search words and the member id reach SQL only as parameters
(`ILIKE` patterns are escaped; a member id that is not a UUID is no filter).

Access reuses the issue page's rule rather than inventing one: a signed-in member of
the loop, or the reply token in the link, and never a revoked membership
(`membershipForViewer`). The tab inside `/g/<id>` rides the loop layout's own
membership check. Share-link visitors have no route to it by construction.


## 19 · The print view is the round, rendered differently

`/i/<id>?print` and `/s/<token>?print` call the same `loadIssue` as the web round and
hand the result to a server component built for paper (`issue-print.tsx`), so there is
no export step, no stored copy and no PDF dependency; "Save as PDF" is the browser's.
The switch is only honoured for a delivered round (`wantsPrint` plus a status check on
the page), and the view is loaded as no one in particular so authors are named, not
"You". Light paper is a scoped re-declaration of the tokens (`printThemeCss`: the loop's
light scheme on white), so html's dark tokens and a loop's dark scheme can never leak
into it; `@media print` hides the app chrome and controls page breaks. Nothing here
calls `window.print()` except an explicit click.


## 20 · Security headers are static; the CSP trades nonces for the static shell

Every response carries the headers built in `src/lib/security-headers.ts` and wired
through `next.config.ts` `headers()`: a Content-Security-Policy, `nosniff`,
`X-Frame-Options: DENY` (with `frame-ancestors 'none'`), a Permissions-Policy that
keeps the microphone for this origin (voice notes) and denies the camera and the
rest, and HSTS on production only. They are not set per request in `proxy.ts`.

The CSP has no nonce, on purpose. A nonce must be minted per request, which forces
every page to render dynamically, and Next's CSP guide calls that incompatible with
Partial Prerendering — the Cache Components shells and partial prefetches that keep
loop navigation inside its budget. Hashes cannot stand in either: Next streams
flight data as inline scripts that differ per page, and listing any hash makes
browsers ignore `'unsafe-inline'`. So `script-src` is `'self' 'unsafe-inline'`
(plus `'unsafe-eval'` in development and `vercel.live` on previews), and the policy
does its work in the directives that do not depend on inline script: `object-src
'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, media
limited to this origin and Vercel Blob, and `connect-src` limited to this origin and
the Blob upload API. Images may load from any HTTPS host because link artwork comes
from whatever CDN a music provider names. React escapes rendered text, and the three
`dangerouslySetInnerHTML` blocks (the theme script, loop theme CSS, print paper CSS)
contain no user input — that, not the CSP, is the XSS boundary today.

Referrer: the site default is `strict-origin-when-cross-origin`, so no path or query
ever leaves for another origin; every route whose URL is a credential or a loop
(`/r`, `/s`, `/i`, `/g`, `/album`, `/you`, `/signin`, `/dev`) sends no referrer at all.

Link previews: the root layout's Open Graph and Twitter metadata and the root
`opengraph-image` are inherited by every route, private ones included, so a shared
reply link or round previews as "Friendloop" and a scraper never falls back to a
friend's photo. No page may set `openGraph`, `twitter`, or `description` from loop
data. Private routes are `noindex` in their metadata and disallowed in `robots.ts`.

Follow-up, if the threat model changes: a nonce CSP from `proxy.ts` on the token
routes alone, starting with `/r` (already blocking on its request), after confirming
no prerendered shell is served there and measuring the navigation benchmark. Until
then a CSP violation report endpoint (`report-to`) would show what a stricter policy
would break.
