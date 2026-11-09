# Friendloop

A free, open-source, self-hostable private group newsletter for friends.
Recurring questions go out by email, everyone answers through a private link, and
the answers become a round delivered back to the group.

- Product truth: [`PRODUCT.md`](./PRODUCT.md)
- Flow inventory (47 flows, the e2e checklist): [`specs/flows.md`](./specs/flows.md)
- Why the code looks like this: [`specs/architecture.md`](./specs/architecture.md)

**Cost to run: $0/month** on free tiers (Vercel Hobby + Neon + Resend).

## Stack

- **Next.js 16 (App Router, Cache Components) PWA** on Vercel
- **Postgres + Drizzle** over `postgres.js` — same driver locally, in tests, and on Neon
- **Resend** — prompts, reminders, delivered rounds, magic links
- **`temporal-polyfill`** — every schedule is local wall-clock, resolved on demand
- **Vercel Schedules + GitHub Actions** — one idempotent sweep, two triggers

## The two seams everything hangs on

```
src/lib/clock.ts        getNow()  — the only impure clock read; x-e2e-now when E2E=1
src/lib/email/send.ts   outbox    — every send is a row first, then Resend
```

Two narrower test-only seams hang off the second one: `RESEND_BASE_URL` points the
real SDK at a local stub that can fail on demand, and `x-e2e-email-transport`
chooses the transport per request. Both `x-e2e-*` headers are refused when
`VERCEL_ENV=production`.

Every loop email carries `List-Unsubscribe` and one-click
`List-Unsubscribe-Post` headers plus a "Stop emails from this loop" footer link.
Unsubscribing mutes that one membership: the person stays in the loop and keeps
their reply link, and the loop's mail to them is recorded as `suppressed` instead
of sent. Resend's webhook (`/api/webhooks/resend`, Svix-signed) does the same for
an address that hard-bounces or complains, and the people tab shows both. Sign-in
links are never held back.

Emails are recorded before they leave, keyed by a unique `dedupe_key`, so a retried
cron run, a redeploy mid-send, or a double click can never send twice. Tests read
the rendered HTML straight out of `outbox` — there is no mail server in the loop.

The scheduler never "fires": `/api/cron/sweep` reconciles state at whatever instant
it is called, so a missed or late run self-heals on the next one. `unique(group_id,
slot_at)` makes the write idempotent.

## Environment variables

Copy `.env.example` to `.env.local`, and add the same vars in
Vercel → Project → Settings → Environment Variables.

| Variable | Where you get it |
| --- | --- |
| `DATABASE_URL` | Neon dashboard → Connection Details |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | `Friendloop <hello@friendloop.dev>` |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → your `/api/webhooks/resend` endpoint → Signing secret (`whsec_…`). Without it bounces and complaints are not recorded |
| `EMAIL_TRANSPORT` | `outbox` to never call Resend (tests, offline dev) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your domain in prod |
| `CRON_SECRET` | `openssl rand -hex 32` — protects the sweep endpoint |
| `UI_PREVIEW_SECRET` | `openssl rand -hex 32` — the key that unlocks everything under `/dev` outside local development |
| `BLOB_READ_WRITE_TOKEN` | Required for production photo uploads. Vercel → Storage → Blob |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional; set by the Sentry Vercel Marketplace integration. Browser, server, and edge error reporting; unset = off. Read at build time (also for the CSP's `connect-src`), so redeploy after setting it |
| `SENTRY_DSN` | Optional server/edge override. The Marketplace integration does not set it; the server falls back to `NEXT_PUBLIC_SENTRY_DSN` |
| `SENTRY_AUTH_TOKEN` | Optional, build-time only; set by the Marketplace integration. Uploads source maps; without it the upload is skipped, never failed |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Set by the Marketplace integration. Org and project slugs, used with `SENTRY_AUTH_TOKEN` for the source map upload |
| `EMAIL_DAILY_BUDGET` | Optional: emails per 24 hours, default 100 (Resend's free tier). Loop mail stops 20 short and waits for the sweep; meanwhile owners see a note on their loop that mail is waiting |
| `FEEDBACK_NOTIFY_EMAIL` | Optional: where notes from the feedback button are emailed, and the email budget alerts: once a day when loop mail reaches 75% of its allowance, and once when it runs out |
| `TEST_DATABASE_URL` | Optional: your own throwaway Postgres for e2e and the integration tests (a Neon branch). If unset, both start a local one. |

## Environments

| | Production | Dev |
| --- | --- | --- |
| URL | **https://friendloop.dev** | **https://dev.friendloop.dev** |
| Branch | `main` | `dev` |
| Database | `neondb` | `friendloop_dev` (same Neon project) |
| Email | Resend, really sent | Resend, really sent — and every send is logged at `/dev/outbox` |
| Sweep | every 15 minutes (Vercel Schedule) | none — a Preview branch's schedule stays inactive |

```sh
git push origin main   # -> friendloop.dev, then syncs dev and updates dev.friendloop.dev
git push origin dev    # -> dev.friendloop.dev only
```

Merging or pushing to `main` runs `.github/workflows/sync-dev.yml`, which
fast-forwards `dev` to the same commit. Vercel's existing Git integration then
deploys both environments automatically: production from `main` and dev from
`dev`. If `dev` has diverged, the sync stops rather than force-pushing over it.
A direct push to `dev` still deploys only the dev environment.

A push to `dev` builds a preview deployment and the domain follows it
(`gitBranch: dev`). Dev sends real mail through Resend, from the same verified
sender, with links pointing at `dev.friendloop.dev`. Every email is also recorded:
**`/dev/outbox`** is the fastest way to grab a sign-in link, and it needs the
preview key outside local development.

Set `EMAIL_TRANSPORT=outbox` in any environment to stop real sending there; the
code then records emails without calling Resend at all.

**Commit authorship matters.** Vercel blocks any deployment whose commit author it
cannot map to a GitHub account, so commits must be authored with a GitHub email:

```sh
git config user.name "Joshua Wright"
git config user.email "Joshua-Wright76@users.noreply.github.com"
```

### Migrations

Deploys apply them. `vercel.json` runs `scripts/deploy-migrate.mjs` before `next build`:
production migrates its database and the `dev` branch migrates its own, which is not a
copy of production. PR previews never migrate. A failed migration fails the build, so the
running deployment stays up and the release does not go out.

Each migration goes live a few minutes before the code that needs it, so the code already
running must still work against the new schema. `check:migrations` fails the build on
destructive DDL, but it can't catch everything: a new `NOT NULL` column with no default
still breaks old inserts.

A deploy fails rather than skip a migration: applied ones are tracked by timestamp, so
one older than the latest applied would otherwise never run. If you apply one by hand,
for example to try it on dev before merging, regenerate any other unmerged migration
that now has an older timestamp:

```sh
DATABASE_URL="$DEV_URL" npx drizzle-kit migrate
```

## Dev

```sh
npm install
npm run db:push        # create tables
npm run dev
```

### UI preview

Open **http://localhost:3000/dev/ui** locally (or the **UI preview** link on the
local landing page). This creates an isolated demo user and loop, starts a test
session, and opens `/dev/screens`, where every public, management, reply, and
round screen is one click away. `/dev/emails` renders every email template with
sample data and its plain-text twin, and `/dev/outbox` lists the captured mail.
Use **Reset demo data** to restore the fixtures. The preview never touches
existing loops.

Everywhere else, every `/dev` route answers 404 until `UI_PREVIEW_SECRET` is set
and `/dev/ui?key=<secret>` is opened once on the environment being unlocked, which
remembers the key in a cookie scoped to `/dev`. Without that lock, `/dev/ui` would
sign any visitor in as the demo owner, who can invite anyone, and `/dev/outbox`
lists sign-in links. Give each environment its own secret. The keyed URL stays in
browser history and in access logs, so rotate the secret when the group of people
holding it changes; rotating locks everyone out immediately.

Production never seeds the demo, even with the key: its tokens are in this public
repository. There the key opens only the stats and the inboxes, and goes straight
to `/dev/stats`.

## Backups

`.github/workflows/backup.yml` runs a few times a day and keeps 14 days of backups
as artifacts on the **Backup** workflow's runs. Each holds the database and every
photo and voice note, encrypted to the public key in `.github/backup-recipient.txt`.
The job restores each database dump into a scratch Postgres before keeping it.

The repository is public, so those files can be downloaded by anyone. Only the
private key makes them readable, and it is not in GitHub. **Keep a copy of it in a
password manager; a backup without the key is lost.**

To restore (needs `age`, and Postgres client tools of the same major version as the database):

```sh
gh run download <run-id> --name friendloop-backup-YYYY-MM-DD
age --decrypt --identity <private-key-file> friendloop-backup.tar.age | tar -xf -
pg_restore --no-owner --no-privileges --dbname "<empty database url>" database.dump
```

`media/` keeps each file's path in the Blob store. The database stores full URLs, so
uploading them back to a new store also means updating those URLs.

## Site and email copy

All user-facing site copy and all six email templates live in
[`src/content/copy.json`](./src/content/copy.json), organized by page and email
type. Edit that file directly; dynamic values use named placeholders such as
`{groupName}`, `{count}`, and `{url}`. The starter question bank, form errors,
plain-text emails, accessibility labels, and metadata are included too.

## Navigation benchmark

Measure click-to-rendered-content time across all five loop tabs against a
production build. The current budget is 95ms average (baseline before shared
layout data: 954ms; optimized result: 53ms).

```sh
npm run build
npx next start -p 3101
# in another terminal
E2E_BASE_URL=http://localhost:3101 ENFORCE=1 NAV_BUDGET_MS=95 npm run measure:navigation
```

`NAV_CYCLES` controls repetitions. `ENFORCE=1` makes the command fail when the
average exceeds `NAV_BUDGET_MS`.

## Verify

```sh
npm run verify              # typegen + typecheck + lint + unit + integration + flows + tables + migrations
npm run test:coverage       # 100% line/function coverage of src/lib, enforced
npm run e2e                 # Playwright — starts its own Postgres if needed, one database and server per worker
E2E_WORKERS=1 npm run e2e   # one at a time; the default is a third of your cores, up to 6
npm run e2e -- --grep-invert "WCAG AA"  # the quick pass: everything but the accessibility sweeps
npm run e2e:fast           # explicit opt-in: reuse the recorded production build, with fresh DBs and servers
npm run e2e:fast -- --last-failed
npm run e2e:fast -- --only-changed
npm run e2e:fast -- e2e/flows/A1.spec.ts  # normal Playwright file/filter arguments work too
npm run check:flows -- --strict   # what CI enforces on every run
npx playwright test e2e/accessibility.spec.ts  # WCAG 2.2 AA axe checks, both themes
npx playwright test e2e/wcag-sweep.spec.ts e2e/wcag-states.spec.ts --project=desktop  # what axe cannot judge: see below
E2E_BASE_URL=https://friendloop.dev npx playwright test --grep @probe   # read-only production smoke
```

`npm run e2e` remains the clean full-validation path: it builds the current
source and records a fingerprint of the source, build configuration,
dependencies, and local env files. `npm run e2e:fast` skips that build only when
this recorded output still matches; missing, incomplete, mixed, or stale output
fails with a rebuild instruction. Run the normal `npm run e2e` after changing
application code, Next configuration, dependencies, or build-time environment.
Fast runs still create fresh disposable databases, migrate them, and start fresh
production servers.

For repeated runs with fixed ports and a **persistent disposable** database,
`E2E_REUSE_SERVER=1` additionally lets Playwright reuse local production servers
that you start and stop separately. After `npm run e2e` has recorded the current
build, start a one-worker server in a separate terminal with the complete runtime
environment (Playwright cannot retrofit env into an already-running process):

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/friendloop_test \
E2E=1 EMAIL_TRANSPORT=outbox \
RESEND_API_KEY=re_e2e_fake_key RESEND_BASE_URL=http://127.0.0.1:3101/w0 \
UI_PREVIEW_SECRET=e2e-preview-secret CRON_SECRET=e2e-cron-secret \
RESEND_WEBHOOK_SECRET=whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA== \
E2E_APP_URL=http://localhost:3100 NEXT_PUBLIC_APP_URL=http://localhost:3100 \
npx next start -p 3100
```

Then run Playwright against it:

```sh
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/friendloop_test \
E2E_WORKERS=1 E2E_PORT=3100 E2E_FAKE_MAIL_PORT=3101 E2E_REUSE_SERVER=1 \
npm run e2e:fast -- --last-failed
```

Playwright still stops any server it starts itself; this option does not
daemonize one. It is deliberately separate from `E2E_BASE_URL`, which remains
the read-only production-probe target. Restart reused servers after rebuilding
or changing server environment, and stop them when finished. Ordinary e2e runs
never reuse servers. Externally supplied databases are not dropped on exit:
after stopping the server, drop the persistent disposable base database and any
additional worker databases yourself.

### Accessibility: WCAG 2.2 AA

Three things hold the line, because no single one can:

- **Tokens** — `src/lib/theme.test.ts` computes every text/background pair of every paper, in light and dark,
  with any accent an owner can pick, including the worst background the gingham check pattern makes where its two
  stripe layers cross (axe cannot read gradients).
- **axe** — `e2e/accessibility.spec.ts` and `e2e/a11y-phone.spec.ts` run the WCAG 2.0–2.2 A/AA rules on the states a
  test has to build by hand.
- **The sweep** — `e2e/wcag-sweep.spec.ts` visits every screen the UI preview lists (the guard test fails when a screen
  is added to `/dev/screens` and not to the sweep), every stationery preset and two hostile accents, in both themes, at
  1280px and at 400% zoom (320×256), and measures what axe cannot: a 3:1 focus indicator on every Tab stop (compared
  pixel by pixel), focus never covered by the fixed bars, no keyboard trap, every control reached by Tab, reflow, text
  spacing, and a page title that says where you are. `e2e/wcag-states.spec.ts` does the same for what a person has to
  open: dialogs, each wizard step, pickers, every disclosure. Helpers live in `e2e/support/wcag.ts`.

What no automation can decide still needs a person: whether alt text and link names make sense, reading order, and
whether a screen reader actually announces a status message. Voice notes have no transcript (WCAG 1.2.1); that is a
product decision, not an oversight.

### Three layers, on purpose

| Layer | Command | What it is for |
| --- | --- | --- |
| Pure units | `npm test` | schedule math, copy, tokens, validation — no database, no framework |
| Database-backed units | `npm run test:integration` | `sweep`, `reply`, `manage`, `auth`, the outbox: the same fixtures the browser suite uses, in ~1s per file |
| Browser | `npm run e2e` | the 47 flows, a11y, layout, two sessions at once |

The middle layer exists because some things are impossible to state honestly
through a browser: two triggers running the sweep at the same instant, a provider
rejecting a send, a session that expired 31 days ago. `test/register.mjs` maps
`@/…` and stubs `next/headers`, `next/cache`, `next/navigation`, and
`@vercel/blob`, so request-scoped library code runs under `node --test` exactly
as it ships.

`npm run test:coverage` runs both unit layers under V8 coverage and fails below
**100% lines and functions** of `src/lib` (branches are held at their current
floor). `test/lib/manifest.integration.test.ts` imports every module in `src/lib`
so a new file cannot hide from the report by never being loaded.

### The provider seam

`EMAIL_TRANSPORT=outbox` records every email and never calls Resend — so, on its
own, `dispatch()`'s failure branch would only ever run in production. Two test
seams close that:

- `RESEND_BASE_URL` points the real Resend SDK at `e2e/support/fake-resend.ts`,
  a local stub that can reject (500), rate-limit (429), or bounce a named
  recipient.
- With `E2E=1`, the `x-e2e-email-transport` header chooses the transport for one
  request, the same way `x-e2e-now` moves the clock. Both are refused when
  `VERCEL_ENV=production`, so inheriting `E2E=1` cannot hand a caller the clock.

`.github/workflows/ci.yml` runs the suite against a `postgres:16-alpine` service.

### The e2e database

`npm run e2e` needs a throwaway Postgres, and starts one for you. It finds a
local install (`brew install postgresql@16`, or `PG_BIN`), keeps the cluster in
your OS cache directory — outside the repo, so the build never watches its
Unix socket — and listens on loopback port 55432 only.

```sh
npm run e2e:db         # start it, and print the URL
npm run e2e:db:status  # running | stopped
npm run e2e:db:reset   # wipe and rebuild
npm run e2e:db:stop    # stop (the data is kept)
```

Set `TEST_DATABASE_URL` to skip all of that and use your own database instead —
that is what CI does with a Neon branch. Tests truncate their tables between
runs, so the cluster is safe to share with nothing else.

Suites can run at the same time from separate checkouts (git worktrees). Each
`npm run e2e` or `npm run test:integration` creates its own
`friendloop_test_run_<pid>_<id>` database in the cluster and drops it when it
exits. A run that was killed leaves its database behind, and the next run drops
it. Each run also picks free ports for the app and the Resend stub; set
`E2E_PORT` / `E2E_FAKE_MAIL_PORT` to pin them. The `.next` build belongs to the
checkout, so a second Playwright run in the same folder stops right away
(`.e2e-run.lock`). `e2e:db:stop` and `e2e:db:reset` affect every run sharing the
cluster, so don't use them while another suite is running.

Flow coverage is not a vibe: `specs/flows.md` lists every user-visible flow, each
`done` flow must have `e2e/flows/<ID>.spec.ts`, and CI fails while any flow is still
`todo`.

## Surfaces

| Route | Who | What |
| --- | --- | --- |
| `/r/<token>` | contributor | answer the open round, no account |
| `/i/<id>` | member (session or `?m=<token>`) | read a delivered round, comment (threads, quotes, photos, @mentions), react |
| `/s/<token>` | anyone with the share link | read a delivered round |
| `/i/<id>?print`, `/s/<token>?print` | as above | the delivered round on light paper, ready for "Save as PDF" |
| `/you` | signed in | your loops + start a new one |
| `/g/<id>` | member | the loop: the open round, progress, schedule, doors |
| `/g/<id>/members` | owner/admin | invite (to answer or just read), roles, remove, hand the loop to anyone who has joined, your photo |
| `/g/<id>/questions` | owner/admin | this round, up next, stopped |
| `/g/<id>/issues` | member | rounds and share links; the owner names rounds |
| `/g/<id>/album` | member | every photo and voice note from delivered rounds; filter by person, search |
| `/album/<id>?m=<token>` | member (session or reply link) | the same Album, for people who read from their inbox |
| `/g/<id>/settings` | owner | schedule, sharing, stationery, pause, delete |
| `/g/new` | signed in | create a loop from the question bank |

## How a round flows

1. The sweep sees a loop whose slot has passed → opens a round, snapshots the
   questions, queues one `prompt` email per contributor.
2. Contributors answer through `/r/<token>` — no account, nothing to remember.
3. 48 hours before delivery, anyone who hasn't answered gets one reminder — unless
   they've turned reminders off on their answer page. The owner's nudge by hand
   ignores that choice.
4. At the delivery instant the sweep compiles every saved, non-empty answer (there
   is no send step), emails the round, and marks it `delivered`. Nothing written →
   the round carries over to the next delivery, and the third empty one is skipped
   and pauses the loop rather than sending an empty email.
5. The round's web page is canonical: comments and reactions live there. The reply link
   moves on to the next round, so a delivered round takes no more answers.

## Monitoring

Everything here is off until configured; local dev, the test suites, and CI run
without it.

- **Errors → Sentry.** `src/instrumentation.ts` (server, edge, and Next's
  `onRequestError`) and `src/instrumentation-client.ts` (browser) initialize
  `@sentry/nextjs` only when a DSN is set — `NEXT_PUBLIC_SENTRY_DSN`, which the
  Sentry Vercel Marketplace integration provides (the server prefers
  `SENTRY_DSN` if present). The browser posts straight to the DSN's ingest
  origin, which `src/lib/security-headers.ts` adds to the CSP's `connect-src`.
  The environment comes from `VERCEL_ENV`. Reply, share, and unsubscribe tokens, query
  values, cookies, request bodies, and SQL parameters never leave: see
  `src/lib/sentry-options.ts` and `src/lib/sentry-scrub.ts`. No session replay;
  10% of requests are traced.
- **Server logs.** `src/lib/log.ts` writes one JSON line per event and forwards
  every `log.error` to Sentry. Log identifiers, never what people wrote.
- **The sweep.** `/api/cron/sweep` checks in to a Sentry cron monitor
  (`cron-sweep`, production only, created on the first check-in) and records a
  `heartbeats` row when it finishes; a sweep that throws is reported. A run that
  finds another sweep holding the lock (`busy: true`) records no heartbeat, so a
  stuck lock holder still turns the health check red.
- **`GET /api/health`** (`Authorization: Bearer $CRON_SECRET`): 200 when the sweep
  finished within 2 hours and no outbox mail has stayed `pending`/`failed` for 26
  hours, 503 with counts and ages otherwise. Never names a recipient.
- **`GET /api/version`**: public, the commit this deployment was built from. After
  each push to `main`, the Verify production deploy workflow waits for it to report
  that commit and fails if it doesn't within 15 minutes, because a merge can go green
  on dev without ever deploying production.
- **`GET /api/healthz`**: public, no details — 200 when the deployment can reach
  its database. Point an uptime monitor at it.
- **[`.github/workflows/monitor.yml`](.github/workflows/monitor.yml)** probes
  `/api/health` on production every 30 minutes with the `CRON_SECRET` repository
  secret; a non-200 fails the run and GitHub emails whoever last edited the
  schedule.

If a Content-Security-Policy is added, its `connect-src` must allow the DSN's
ingest host (e.g. `https://*.ingest.us.sentry.io`), or browser errors are dropped.

## Release safety

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and
every push to `main`, in order:

1. **Verify** — `npm run verify`: typegen, typecheck, lint, unit tests, the
   database-backed unit tests, the flow matrix, the truncate-list check, and
   `check:migrations`.
2. **Coverage gate** — `npm run test:coverage`: 100% lines and functions of
   `src/lib`, enforced rather than reported.
3. **Flow coverage (strict)** — `npm run check:flows -- --strict`: a `done` flow must
   have its spec file, and no flow may still be `todo`.
4. **End-to-end** — `npm run e2e`: the full Playwright suite on chromium and webkit
   against a throwaway `postgres:16-alpine` service container. Node 24 and the
   runner image are pinned deliberately; a gate should not move underneath us.

Migrations must be additive (`check:migrations` fails step 1 on destructive DDL),
because reverting a deploy reverts code, not the database. The same check also fails
on a journal entry that would be silently skipped, and it runs in the Vercel build
before anything is migrated.

What CI does **not** do, so nobody is surprised by a bad deploy:

- **It does not block the deploy.** Vercel builds and ships `main` on push,
  independently of this workflow; a red run tells you after the fact. Making the
  check a merge gate needs branch protection plus pull requests, and this repo has
  neither — its history is linear commits pushed straight to `main`. That is a
  deliberate trade: fast to ship, not self-enforcing.
- **No preview-deployment test run and no automatic rollback.** Vercel runs only
  `next build` (see `package.json`). `e2e/probes.spec.ts` holds read-only
  production probes (`--grep @probe` against `E2E_BASE_URL`), but nothing runs
  them on a schedule; an earlier version of this section described a probe calling
  `POST /v1/projects/{id}/rollback` on two consecutive failures, which was never
  written. Do not plan around it.
