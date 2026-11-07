# The improvement loop, 2026-11-07

Goal set by the user: cut the average interaction time by 90%. The score is defined in
`README.md`: the mean of each interaction's median time on the `phone-4g` profile.

## Result

Compared against the original code re-measured under the final lab (`baseline-remeasured`),
127 interactions, 5 repetitions each:

| | Before | After | Change |
| --- | --- | --- | --- |
| **Phone on 4G (the score)** | **1,441 ms** | **441 ms** | **−69%** |
| Laptop on broadband | 400 ms | 254 ms | −37% |
| Phone: page loads (40) | 3,581 ms | 608 ms | −83% |
| Phone: navigation (17) | 717 ms | 388 ms | −46% |
| Phone: writes (55) | 474 ms | 426 ms | −10% |
| Phone: instant UI (15) | 102 ms | 109 ms | +7% |
| Phone: ready to use after a load | 2,200 ms | 942 ms | −57% |
| Phone: server has answered | 1,462 ms | 451 ms | −69% |

Against the first baseline, taken before the lab compressed streamed responses, the
phone score went from 1,632 ms to 441 ms (−73%). The re-measured figure is the fair one.

**The 90% goal was not reached, and cannot be honestly in this lab.** A write waits for the
server to confirm it ("Saved.", "Photo saved"), and on the phone profile every round trip
carries 150 ms of latency each way, so a truthful write costs about 250 to 300 ms. A page load
on 4G needs the document and then its stylesheet. Even with every write, page load and
navigation at those floors, the average sits near 300 ms, not 144 ms. Reaching −90% would take
optimistic UI that says "Saved." before anything is saved, which this loop did not do.

## What worked

1. **Gaegu's Latin files only** (`src/app/layout.tsx`). Google's Gaegu is mostly Korean, and
   several of its Korean subsets also claim ASCII, so every page fetched about 90 font files
   (around 700 KB) and the stylesheet carried 179 `@font-face` rules. Phone page loads went
   from about 4.5 s to 0.8 s. This also fixed the settings Paper tab (1.1 s to 0.1 s), whose
   handwriting previews were pulling in the Korean files.
2. **No font preloads.** On a thin connection a preload races the stylesheet. Phone page
   loads went from about 770 ms to 600 ms; layout shift stayed at 0.001.
3. **Sentry loads when the page is idle** (`src/components/sentry-client.ts`), not with it.
   About 120 KB compressed off every first load; errors before then are held and sent.
   Phone readiness after a load improved by about 0.5 s.
4. **The round page reads in parallel** (`src/lib/issue-view.ts`). It loaded the whole issue
   twice and fetched music cards one at a time: 63 queries in series. Now three round trips.
   Opening a past round went from 1.4 s to 0.5 s, posting a comment from 1.1 s to 0.5 s.
5. **Photos on the round page load lazily.** A round shipped 6.6 MB of full-size photos on
   load.
6. **Sending a reply saves its answers together** (`reply-sheet.tsx`), not one request per
   answer; the server's three updates run at once. Phone send went from 1.9 s to 0.4 s.
7. **The loop archive** asks for each round in one round trip instead of seven.
8. **Share-link reset** updates every round in one statement instead of one per round.
9. **The album search and the rounds filter** navigate in the page (`next/form`) instead of
   reloading it, and the rounds filter reads data the loop page already has.

## What was tried and rejected

- **`experimental.inlineCss`.** Plain pages went from 790 ms to 340 ms, but it repeats the
  stylesheet in every streamed segment and the RSC payload: a loop page's HTML went from 21 KB
  to 106 KB and loop page loads from 0.8 s to 2.4 s. Reverted.
- **Starting Sentry eagerly, or five seconds after load.** Measured against the idle start:
  eager cost phone loads about 30 ms and readiness about 500 ms; the delay helped nothing.

## What got worse

- **Instant UI on a laptop**, by 20 to 50 ms (for example tab switches, 58 to 92 ms). Part is
  Sentry starting up just after the page loads, which is when the lab, and people, first tap.
  Eager Sentry recovered about half of it. The rest was not traced.
- **The photo lightbox** opens a photo that may not have downloaded yet, now that photos load
  lazily (38 to 76 ms on a laptop, and the picture itself can arrive later than before).

## Left on the table

- **Sending email in bulk.** Nudge (1.2 s) and Send now (0.9 s) send one email per person in
  series. In production each is a Resend call, so it costs more than here. Resend's batch
  endpoint is the fix; parallel calls would run into its rate limit.
- **Caching loop data** (`"use cache: private"` plus `prefetch={true}`) could make moving
  between server-rendered pages instant, at the cost of reasoning about staleness.
- **Thumbnails for photos.** Uploads keep 2560 px originals and every view shows those.
- **Leaving a loop** runs its erase queries one by one inside a transaction (about 1.2 s
  server time). It happens once in a person's life, so it was left alone.

## Lab changes made during the loop

- The edge gzips text the app left uncompressed, as Vercel's CDN does. This is why the
  baseline was re-measured.
- A sample that hangs fails after 90 s instead of stalling the run.
- A run where some interaction produced nothing is marked partial.
- `--trace` writes a summary of main-thread work per interaction to `perf/.tmp`.
