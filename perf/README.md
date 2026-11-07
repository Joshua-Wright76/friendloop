# The performance lab

Times every interaction a person can have with Friendloop, the way that person
would experience it, and shows the result on a dashboard.

```
npm run perf -- --label baseline            # the whole catalog, about 75 minutes
npm run perf -- --only 'reply\.' --reps 3   # one surface, with a fresh build
npm run perf -- --only 'reply\.' --no-build # the same, reusing the last build
npm run perf:check                          # every route has an interaction, or a reason not to
npm run perf:report                         # rebuild the dashboard from perf/runs
```

The dashboard is `perf/dashboard/index.html`, a single file with no server, built from the runs in `perf/runs` (gzipped JSON, committed) by `npm run perf:report`; the HTML itself is not committed.

## What is being measured

For each interaction: from the moment of the input event (or the start of navigation,
for a page load) until the frame after **what the person was waiting to see** is on
screen. Never a skeleton, never a spinner, never a pressed button. The check is the
real outcome, such as the new row with its own text.

The timer runs inside the page (`lib/probe.ts`), so Playwright's overhead is no part
of any number.

## The score

Written down before the first baseline was taken, so it could not be chosen to flatter:

> **The mean, over all interactions, of each interaction's median `done` time, on one
> profile.** `phone-4g` is the headline. PRODUCT.md says most replies happen on a phone.

- Every interaction counts the same. Fixing a rare slow page and a common slow page move
  the score equally, which is a limit worth remembering: this is not traffic-weighted.
- Comparisons only use interactions present in both runs, and a sample that failed
  counts as a failure on the dashboard, not as a missing number. An interaction dropped
  from the catalog is flagged rather than quietly improving the average.
- Repetition 0 of each interaction warms the server and is thrown away.

## Numbers that keep the score honest

The score alone can be gamed, so these sit next to it and must not get worse:

| Number | What it catches |
| --- | --- |
| `interactiveMs` | Page loads only. When React has hydrated what you came for. Catches a page that paints fast and ignores taps. |
| `confirmedMs` | When the server has actually answered. Catches optimistic UI that hides a slow write. |
| `feedbackMs` | The first frame after the input. |
| `longTaskMs` | Main-thread blocking after the input. |
| `cls` | Layout shift: content arriving late and jumping. |
| `lcpMs`, `fcpMs` | The standard browser measures, for page loads. |

## The conditions

| | |
| --- | --- |
| Build | A real production build with the Sentry SDK running as it does in production, reporting to a local sink. |
| Network | HTTP/2 over TLS through a local edge (`lib/edge.ts`), as Vercel serves it, gzipping text the app left uncompressed as Vercel's CDN does (added after the first baseline; see "Re-measured baseline"). Not `next start`'s HTTP/1.1, whose six-connection limit misrepresents pages with many files. |
| `phone-4g` | iPhone 13 viewport with touch, Chromium, 4x CPU slowdown, 150 ms latency, 1.6 Mbps down, 750 kbps up. |
| `desktop` | 1280x800, no CPU slowdown, 30 ms latency, 20 Mbps down. |
| Database | Local Postgres behind a proxy adding a 10 ms round trip (`lib/db-proxy.ts`). The proxy also reads the wire protocol, which is where the query counts come from, without touching app code. |
| Data | A six-month-old loop: 12 people, 26 delivered rounds, comments, reactions, 2560 px photos (`lib/world.ts`). |

## What this cannot tell you

- **It is a lab, not real visitors.** Nothing here reports from production. These are
  comparable with each other, not predictions of production numbers.
- **The database round trip is an assumption** (10 ms). Vercel-to-Neon was not measured.
- **Serverless cold starts are not modelled.** `next start` is one long-lived process.
- **Vercel's edge cache is not modelled.** Static files reach the lab's browser from a
  local process, then get the emulated latency, so a real CDN would differ.
- **Compression differs.** The lab serves gzip; Vercel serves brotli, which is somewhat smaller.
- **Chromium stands in for Safari** on the phone profile.
- **Some writes run on small throwaway loops**, because they destroy or consume state,
  so they understate what the same write costs on a large loop.

## Re-measured baseline

The lab itself changed during the work: the edge started compressing streamed responses
the way Vercel does. A lab change must never be credited as an app improvement, so the
final comparison re-measures the original code (`9029aed`) under the final lab, and that
run (`baseline-remeasured`) is what the result is reported against.
