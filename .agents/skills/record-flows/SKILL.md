---
name: record-flows
description: Record every Friendloop flow on desktop and mobile with agent-browser and Mailpit, build the browsable video gallery, and optionally host it behind a Cloudflare login. Use when asked to record, video or visually audit the app's flows, to refresh the recordings after UI changes, or to look for bugs by watching every flow end to end.
---

# Record every flow

Produces one video per flow in `specs/flows.md`, plus longer journeys (W01–W12), each on desktop (1440×900) and mobile (393×852 with touch emulation). Real email goes to a local Mailpit and shows on camera. The result is `recordings/site/index.html`, a gallery you can open without a server.

Watching every flow finds bugs that tests miss, because tests pin the clock differently and seed past the awkward states. Treat the run as an audit: write down what looks wrong, and don't script around it.

## Current state of the scripts

The scripts were written before the UI redesign in PR #35. On that UI, 33 of the 110 recordings pass on both viewports, and the rest stop at selectors or copy that moved. `e2e/flows/<ID>.spec.ts` shows the current selectors, so port a take by reading its spec. A failing take is usually a stale script, but read its error and video before assuming so. Update this section when that changes.

## Before you start

- Work in your own worktree (`git worktree add ~/.t3/worktrees/friendloop/<name>`, then a real `npm ci`). Other sessions share the main checkout.
- You need `agent-browser`, `mailpit`, `ffmpeg`, Postgres 16, and Chrome. On a Mac: `brew install mailpit ffmpeg postgresql@16`.
- Nothing here touches `.env`, the dev server on `:3000`, or a shared Mailpit. All data is fake and the database is wiped before every take.
- A `next build` here clobbers `next dev`'s cache in the same checkout, so don't serve dev from this worktree at the same time.

## Run it

```bash
recordings/stack.sh build            # migrates its database, then one production build, E2E=1
for k in 0 1 2 3 4 5 6; do recordings/stack.sh up $k; done   # app 3190+k, Mailpit 8190+k
recordings/full-run.sh               # every take across 7 shards, then retries failures twice
node recordings/build-gallery.mjs    # recordings/site/
recordings/stack.sh down
```

A clean full run takes roughly 30 minutes on a 16-core Mac; failing takes wait out their timeouts, so it can pass 90 minutes when many scripts are stale. Run it where a long background limit won't stop it. One take: `recordings/rec.sh --shard 0 --only D3 --viewport mobile`. Journeys alone: `recordings/journeys-run.sh`.

Rebuild (`stack.sh build`, then `up` again) after any app change. Each shard is an APFS clone of the build, with its port rewritten into the output, because `NEXT_PUBLIC_APP_URL` is inlined at build time.

## Write or fix a recording

`recordings/AUTHORING.md` is the API and the rules, and `recordings/flows/a-auth.mjs` is the worked example. Copy its shape. When `specs/flows.md` gains a flow, add a take with the same ID.

Rules that matter most:

- Assert every outcome with `t.see` or `t.check_`. A pass must mean it happened on screen.
- Show real email in Mailpit. For backend-only behaviour, show the real response in `t.panel`, and say what's simulated in `staged`.
- If the app misbehaves, let the take fail or add `t.note`. Never work around it silently: a workaround hides the bug from whoever watches. Put confirmed problems in `recordings/findings.json`, which the gallery shows first.
- Check your work by looking at it: `ffmpeg -i X.mp4 -vf "fps=1/2,scale=-2:400,tile=8x2" -frames:v 1 /tmp/sheet.png`, then read the image. Do this on a sample from each viewport.

To go faster, give one helper per group of flows and its own shard, with `AUTHORING.md` as its brief. Then re-record everything from clean, because a harness fix mid-way leaves older takes inconsistent.

## Traps already paid for

- **`agent-browser record` stalls** after a few frames on some runs, leaving a sub-second video. The harness takes a DevTools screencast of the tab agent-browser drives and resamples it to 15 fps.
- **`find role link` misses plain anchors.** `t.clickRole` reads refs from `snapshot -i`.
- **`Emulation.setEmitTouchEventsForMouse` hangs clicks**, so mobile taps arrive as mouse clicks with touch emulation on. Scrolling is real touch. A tap-only bug can still slip through.
- **Video stalls in headless Chromium** after a keypress and reload, and never recovers. Test the gallery's video with `--headed`.
- **Mailpit shows its email in an iframe,** so `t.see` can't read it. Assert on `t.lastMail`.
- **Mailpit paints an email's body late** on some takes, so a frame can show a blank white pane.

## How the gallery picks frames

A step's time is when its caption appears, just before its action. `build-gallery.mjs` lands a jump on the latest screen held for at least a second before the next step, because scripts pause on what a caption describes and hurry through setup. "Replay step" plays the action leading up to it.

This rule gets about 9 in 10 steps right. Prompts and other brief states are handled by `recordings/step-overrides.json`, by caption pattern or by exact time. Hand-set a step when it matters. Rules alone stopped improving at this point, so don't spend long tuning them.

## Host it behind a login (optional)

Only with the user's go-ahead: this publishes videos of the app. Lock the address before uploading anything, so the site is never public, even briefly.

1. The user enables Zero Trust once in the Cloudflare dashboard (free plan), and adds **One-time PIN** under Settings → Authentication → Login methods. An API token needs extra permission to add that, so it's easier by hand.
2. Get an API token through the private secret prompt, never in chat, with these Account permissions: Cloudflare Pages Edit, Access: Apps and Policies Edit, Account Settings Read. `wrangler login` can't create Access rules.
3. Create the Pages project empty: `POST /accounts/$A/pages/projects`.
4. Create the Access app with an allow policy for named emails. Cover both `<project>.pages.dev` and `*.<project>.pages.dev` in `self_hosted_domains`, or per-deployment preview addresses stay public.
5. Confirm a signed-out `curl` gets a 302 to `cloudflareaccess.com`, then upload: `npx wrangler pages deploy recordings/site --project-name <project> --branch main`.
6. Test signed out again on the gallery, a video, and the per-deployment address. Then ask the user to sign in once, since only they can receive the code.

Pages allows 25 MB per file and 20,000 files. A full gallery is about 220 MB across about 1,800 files.

## Report honestly

Say which takes failed and why, what's staged, and what wasn't tested: real touch, screen readers, and iOS Safari, since this is Chrome. Don't commit `recordings/output`, `site` or `logs`; they're ignored.
