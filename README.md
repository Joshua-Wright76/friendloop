# Friendloop

A free, open-source, self-hostable private group newsletter for friends.
Recurring questions go out by email, everyone answers through a private link, and
the answers become a shared issue delivered back to the group.

- Product truth: [`PRODUCT.md`](./PRODUCT.md)
- Flow inventory (41 flows, the e2e checklist): [`specs/flows.md`](./specs/flows.md)
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
| `AUTH_SECRET` | `openssl rand -base64 32` — signs session cookies |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your domain in prod |
| `CRON_SECRET` | `openssl rand -hex 32` — protects the sweep endpoint |
| `BLOB_READ_WRITE_TOKEN` | (optional) Vercel → Storage → Blob |
| `TEST_DATABASE_URL` | a throwaway Postgres for e2e (Neon branch or local container) |

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
**`/dev/outbox`** is the fastest way to grab a sign-in link, and it 404s in
production.

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

### Local UI preview

Open **http://localhost:3000/dev/ui** (or the **UI preview** link on the local
landing page). This creates an isolated demo user and loop, starts a local test
session, and opens `/dev/screens`, where every public, management, reply, and
issue screen is one click away. Use **Reset demo data** to restore the fixtures.
The preview never touches existing loops and returns 404 outside local
development.

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
npm run e2e            # Playwright, needs TEST_DATABASE_URL
docker run -d --name friendloop-test -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=friendloop_test -p 55432:5432 postgres:16-alpine
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/friendloop_test"
npm run check:flows -- --strict   # what the release workflow enforces
npx playwright test e2e/accessibility.spec.ts  # WCAG 2.2 AA axe checks, both themes
```

Flow coverage is not a vibe: `specs/flows.md` lists every user-visible flow, each
`done` flow must have `e2e/flows/<ID>.spec.ts`, and the release workflow refuses to
ship while any flow is still `todo`.

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

CI runs the suite on every PR; preview deployments run it again; a production probe
runs the critical path against a synthetic loop and rolls back through
`POST /v1/projects/{id}/rollback/{deploymentId}` on two consecutive failures.
Migrations must be additive (`npm run check:migrations` fails CI on destructive
DDL), because rollback reverts code, not the database.
