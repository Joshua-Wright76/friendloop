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
covers the issue view: comments and reactions are Server Actions because they are
only ever reachable from a page that already resolved who you are.

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
