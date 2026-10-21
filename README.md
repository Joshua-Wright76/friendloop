# Friendloop

A free, open-source, self-hostable Letterloop-style private group newsletter for friends.
Recurring questions go out by email, everyone replies through a private link, and the
answers are compiled into a newsletter Issue delivered back to the group.

**Cost to run: $0/month** on free tiers (Vercel Hobby + Neon + Resend).

## Stack

- **Next.js (App Router) PWA** on Vercel — git push to deploy
- **Neon Postgres** + Drizzle ORM — groups, members, questions, issues, replies
- **Resend** — prompt emails, delivery emails, magic-link sign-in
- **Vercel Cron** — `vercel.json` runs `/api/cron/daily` once a day to open reply
  windows and deliver Issues
- **Vercel Blob** (optional) — reply photos

## Sign up for these (in order)

1. **Vercel** — import this repo, framework auto-detected. Free Hobby plan.
2. **Neon** (neon.tech) — create a project, copy the pooled connection string.
   Connect it from Vercel → Storage, or paste `DATABASE_URL` into env vars.
3. **Resend** (resend.com) — create an API key. Free tier: 3,000 emails/month.
   Send test mail from `onboarding@resend.dev`; verify your own domain later.

## Environment variables

Copy `.env.example` to `.env.local` (locally) and add the same vars in
Vercel → Project → Settings → Environment Variables:

| Variable | Where you get it |
| --- | --- |
| `DATABASE_URL` | Neon dashboard → Connection Details |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | `Friendloop <onboarding@resend.dev>` works out of the box |
| `AUTH_SECRET` | `npx auth secret` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your `*.vercel.app` URL in prod |
| `CRON_SECRET` | `openssl rand -hex 32` — protects the cron endpoint |
| `BLOB_READ_WRITE_TOKEN` | (optional, later) Vercel → Storage → Blob, auto-injected |

## Dev

```sh
npm install
npx drizzle-kit push        # create tables in your Neon database
npm run dev
```

## How an issue flows

1. Daily cron sees a group whose `promptWeekday` is today → creates an `open` Issue
   and emails each member their unique reply link (`memberships.replyToken`).
2. Members answer questions via the link — no password needed.
3. When `deliversAt` passes, the next daily cron compiles replies into the newsletter,
   emails it to the group, and marks the Issue `delivered`.
4. Delivered Issues support late edits and (eventually) comments/reactions.
