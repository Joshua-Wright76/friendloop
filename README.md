# Friendloop

A free, open-source, self-hostable private group newsletter for friends.
Recurring questions go out by email, everyone answers through a private link, and
the answers become a shared issue delivered back to the group.

- Product truth: [`PRODUCT.md`](./PRODUCT.md)
- Flow inventory (47 flows, the e2e checklist): [`specs/flows.md`](./specs/flows.md)
- Why the code looks like this: [`specs/architecture.md`](./specs/architecture.md)

**Cost to run: $0/month** on free tiers (Vercel Hobby + Neon + Resend).

## Stack

- **Next.js 16 (App Router, Cache Components) PWA** on Vercel
- **Postgres + Drizzle** over `postgres.js` — same driver locally, in tests, and on Neon
- **Resend** — prompts, reminders, issues, magic links
- **`temporal-polyfill`** — every schedule is local wall-clock, resolved on demand
- **Vercel cron + GitHub Actions** — one idempotent sweep, two triggers

## The two seams everything hangs on

```
src/lib/clock.ts        getNow()  — the only impure clock read; x-e2e-now when E2E=1
src/lib/email/send.ts   outbox    — every send is a row first, then Resend
```

Two narrower test-only seams hang off the second one: `RESEND_BASE_URL` points the
real SDK at a local stub that can fail on demand, and `x-e2e-email-transport`
chooses the transport per request. Both `x-e2e-*` headers are refused when
`VERCEL_ENV=production`.

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
| `EMAIL_TRANSPORT` | `outbox` to never call Resend (tests, offline dev) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your domain in prod |
| `CRON_SECRET` | `openssl rand -hex 32` — protects the sweep endpoint |
| `UI_PREVIEW_SECRET` | `openssl rand -hex 32` — the key that unlocks `/dev/outbox` outside local development |
| `BLOB_READ_WRITE_TOKEN` | Required for production photo uploads. Vercel → Storage → Blob |
| `TEST_DATABASE_URL` | Optional: your own throwaway Postgres for e2e and the integration tests (a Neon branch). If unset, both start a local one. |

## Environments

| | Production | Dev |
| --- | --- | --- |
| URL | **https://friendloop.dev** | **https://dev.friendloop.dev** |
| Branch | `main` | `dev` |
| Database | `neondb` | `friendloop_dev` (same Neon project) |
| Email | Resend, really sent | Resend, really sent — and every send is logged at `/dev/outbox` |
| Cron | daily sweep | none — Vercel cron runs against production only |

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

Both databases need them, and the dev one is not a copy of production:

```sh
DATABASE_URL="$PROD_URL" npx drizzle-kit migrate
DATABASE_URL="$DEV_URL"  npx drizzle-kit migrate
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
issue screen is one click away. `/dev/emails` renders every email template with
sample data and its plain-text twin, and `/dev/outbox` lists the captured mail.
Use **Reset demo data** to restore the fixtures. The preview never touches
existing loops.

On dev and prod the screens and email previews work the same way at their `/dev`
routes. Nothing links to them from the site, so only people who know the path
find them. The one exception is `/dev/outbox`: it lists captured mail, sign-in
links included, so anyone with that page can sign in as anyone who has mail in
it. It stays 404 until `UI_PREVIEW_SECRET` is set and `/dev/ui?key=<secret>` is
opened once on the environment being unlocked, which remembers the key in a
cookie scoped to `/dev`. Give each environment its own secret. The
keyed URL stays in browser history and in access logs, so rotate the secret when
the group of people holding it changes; rotating locks everyone out immediately.

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
npm run e2e                 # Playwright — starts its own Postgres if needed
npm run check:flows -- --strict   # what CI enforces on every run
npx playwright test e2e/accessibility.spec.ts  # WCAG 2.2 AA axe checks, both themes
npx playwright test e2e/wcag-sweep.spec.ts e2e/wcag-states.spec.ts --project=desktop  # what axe cannot judge: see below
E2E_BASE_URL=https://friendloop.dev npx playwright test --grep @probe   # read-only production smoke
```

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
| `/g/<id>` | member | the loop: next round, progress, doors |
| `/g/<id>/members` | owner/admin | invite, roles, remove, hand the loop to an admin, your photo |
| `/g/<id>/questions` | owner/admin | pool, order, skip-next, archive |
| `/g/<id>/issues` | member | rounds and share links; the owner names rounds |
| `/g/<id>/album` | member | every photo and voice note from delivered rounds; filter by person, search |
| `/album/<id>?m=<token>` | member (session or reply link) | the same Album, for people who read from their inbox |
| `/g/<id>/settings` | owner | schedule, sharing, stationery, pause, delete |
| `/g/new` | signed in | create a loop from the question bank |

## How a round flows

1. The sweep sees a loop whose slot has passed → creates an issue, snapshots the
   questions, queues one `prompt` email per contributor.
2. Contributors answer through `/r/<token>` — no account, nothing to remember.
3. 48 hours before delivery, anyone who hasn't answered gets one reminder — unless
   they've turned reminders off on their answer page. The owner's nudge by hand
   ignores that choice.
4. At the delivery instant the sweep compiles submitted replies, emails the issue,
   and marks it `delivered`. Nothing submitted → the round is skipped and the loop
   pauses rather than sending an empty email.
5. The web issue is canonical: replies stay editable after delivery, and comments
   and reactions live there.

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
because reverting a deploy reverts code, not the database.

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
