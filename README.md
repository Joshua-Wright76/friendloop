# Friendloop

A free, open-source, self-hostable private group newsletter for friends.
Recurring questions go out by email, everyone answers through a private link, and
the answers become a shared issue delivered back to the group.

- Product truth: [`PRODUCT.md`](./PRODUCT.md)
- Flow inventory (44 flows, the e2e checklist): [`specs/flows.md`](./specs/flows.md)
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
| `TEST_DATABASE_URL` | Optional: your own throwaway Postgres for e2e (a Neon branch). If unset, `npm run e2e` starts a local one. |

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
npm run verify         # typecheck + lint + unit + flow matrix
npm run e2e            # Playwright — starts its own Postgres if needed
npm run check:flows -- --strict   # what CI enforces on every run
npx playwright test e2e/accessibility.spec.ts  # WCAG 2.2 AA axe checks, both themes
```

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

Flow coverage is not a vibe: `specs/flows.md` lists every user-visible flow, each
`done` flow must have `e2e/flows/<ID>.spec.ts`, and CI fails while any flow is still
`todo`.

## Surfaces

| Route | Who | What |
| --- | --- | --- |
| `/r/<token>` | contributor | answer the open round, no account |
| `/i/<id>` | member (session or `?m=<token>`) | read a delivered round, comment, react |
| `/s/<token>` | anyone with the share link | read a delivered round |
| `/you` | signed in | your loops + start a new one |
| `/g/<id>` | member | the loop: next round, progress, doors |
| `/g/<id>/members` | owner/admin | invite, roles, remove, transfer |
| `/g/<id>/questions` | owner/admin | pool, order, skip-next, archive |
| `/g/<id>/issues` | member | rounds and share links |
| `/g/<id>/settings` | owner | schedule, sharing, pause, delete |
| `/g/new` | signed in | create a loop from the question bank |

## How a round flows

1. The sweep sees a loop whose slot has passed → creates an issue, snapshots the
   questions, queues one `prompt` email per contributor.
2. Contributors answer through `/r/<token>` — no account, nothing to remember.
3. 48 hours before delivery, anyone who hasn't answered gets one reminder.
4. At the delivery instant the sweep compiles submitted replies, emails the issue,
   and marks it `delivered`. Nothing submitted → the round is skipped and the loop
   pauses rather than sending an empty email.
5. The web issue is canonical: replies stay editable after delivery, and comments
   and reactions live there.

## Release safety

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and
every push to `main`, in order:

1. **Verify** — `npm run verify`: typegen, typecheck, lint, unit tests, the flow
   matrix, and `check:migrations`.
2. **Flow coverage (strict)** — `npm run check:flows -- --strict`: a `done` flow must
   have its spec file, and no flow may still be `todo`.
3. **End-to-end** — `npm run e2e`: the full Playwright suite on chromium and webkit
   against a throwaway `postgres:16-alpine` service container.

Migrations must be additive (`check:migrations` fails step 1 on destructive DDL),
because reverting a deploy reverts code, not the database.

What CI does **not** do, so nobody is surprised by a bad deploy:

- **It does not block the deploy.** Vercel builds and ships `main` on push,
  independently of this workflow; a red run tells you after the fact. Making the
  check a merge gate needs branch protection plus pull requests, and this repo has
  neither — its history is linear commits pushed straight to `main`. That is a
  deliberate trade: fast to ship, not self-enforcing.
- **No preview-deployment test run, and no production probe or automatic
  rollback exist.** Vercel runs only `next build` (see `package.json`). An earlier
  version of this section described a probe calling `POST /v1/projects/{id}/rollback`
  on two consecutive failures; it was never written. Do not plan around it.
