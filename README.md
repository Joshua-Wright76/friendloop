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

## Dev

```sh
npm install
npm run db:push        # create tables
npm run dev
```

## Verify

```sh
npm run verify         # typecheck + lint + unit + flow matrix
npm run e2e            # Playwright, needs TEST_DATABASE_URL
docker run -d --name friendloop-test -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=friendloop_test -p 55432:5432 postgres:16-alpine
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/friendloop_test"
npm run check:flows -- --strict   # what the release workflow enforces
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
