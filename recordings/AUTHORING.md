# Writing a recording

The whole workflow is in `.agents/skills/record-flows/SKILL.md`. This file is the script reference.

One recording = one entry in `flows` of a file in `recordings/flows/*.mjs` (or
`recordings/journeys/*.mjs`). `recordings/flows/a-auth.mjs` is the worked example; copy its shape.

```js
export const flows = {
  B1: { title: "Create a loop", area: "B · Create and invite",   // area = the section heading in specs/flows.md
    staged: "optional: one sentence on anything simulated/seeded/invisible, shown beside the video",
    seed: async (t) => ({ ... }),   // optional, runs off camera after the DB and Mailpit are wiped
    run: async (t, seeded) => { ... },
  },
};
```

Run: `recordings/rec.sh --shard <k> --only B1,B2 [--viewport desktop|mobile]`. Default is both.
Output: `recordings/output/<kind>/<viewport>/<ID>.mp4` + `.json`.
Each take wipes the database and Mailpit first. Takes run sequentially per shard.

Imports: `../../e2e/support/{seed,db,clock,album,audio,polls,print,reading,suggestions,comments,identity}.ts`
(they work outside Playwright, `@/` resolves). Avoid `e2e/support/harness.ts` helpers that take a Playwright `page`.
`../lib/fake-recorder.mjs` exports `FAKE_RECORDER` (`await t.initScript(FAKE_RECORDER)` first).
The acceptance criteria are in `specs/flows.md`, and `e2e/flows/<ID>.spec.ts` shows selectors,
seed calls and clock instants that are known to work. Read both. Port the *user-visible story*, not every assertion.

## The `t` API (`recordings/lib/harness.mjs`)
- `t.say(text)` caption + seekable step. Short, plain, present tense, a viewer's guide. Use one before each beat.
- `t.open(path|url)`, `t.reload()`, `t.back()`, `t.expectUrl(regex)`, `t.currentUrl()`
- `t.button(name, {exact, nth})`, `t.link(name, ...)`, `t.clickRole(role, name, ...)`, `t.clickText(text)`, `t.click(css)`
- `t.fillLabel(label, text)`, `t.fillPlaceholder(p, text)`, `t.fill(css, text)`, `t.typeKeys(text)`, `t.press(key)`, `t.select(css, value)`, `t.check(css)`
- `t.pick("Day", "Friday")` the app's custom Picker. `t.upload(css, "photo1.jpg")` files in `recordings/fixtures/` (photo1-7.jpg, header.jpg, avatar.jpg, note.mp3, note.m4a)
- `t.see(text)` asserts visible text (case-insensitive, scrolls to it, fails the take if absent), `t.dontSee(text)`, `t.check_(cond, msg)`
- `t.scroll(px)` (real touch gesture on mobile), `t.tour()` pans a whole page, `t.toTop()`, `t.pause(ms)`
- `t.clock(date)` pins server (`x-e2e-now`) and page `Date`; `t.clock(null)` releases. Set before the `open` that needs it, using the same instants as the spec.
- People: `t.signInAs(email)` switches person off camera (real session row + cookie; `null` = signed out). `t.signInByMail(email)` is the whole on-camera path.
  A reply link needs no session: `t.open("/r/" + member.token)`. Multi-person flows run in one tab: say who you are, then switch.
- Mail: `t.openMail({to, subject})` shows Mailpit's inbox then the message (`{inbox:false}` skips the inbox), `t.followMailLink("/r/")`, `t.mailLink(fragment)`, `t.waitForMail(filter, {count})`, `t.mailCount(filter)`, `t.mailBodyContains(filter, needle)`. Seeded emails don't exist; only ones the app really sent.
- Backend with no pixels: `t.sweep(date)` runs the cron and shows its report, `t.request(method, path, {body, headers})` shows the response, `t.panel(title, body)` shows a labelled "BACKEND" card, `t.sql(text, params)` reads the database.
- `t.note(text)` a remark shown beside the video (e.g. a real bug you noticed).

## Rules
1. A video must SHOW the flow. Prefer real UI over seeding; seed only what isn't the point of the flow. Email is shown in Mailpit whenever the flow involves email.
2. End on the outcome, on screen, for about a second. Use `t.see` to assert every outcome so a pass means it happened.
3. Backend-only criteria (races, 403 POSTs, idempotency): show the surrounding UI, then the actual request/SQL result in a panel, and set `staged`. Never fake a result: panels show real responses only.
4. Keep takes tight: mostly 10-45 seconds. Don't add long dwell.
5. Both viewports must pass with the same script. Branch on `t.isMobile` only if the UI truly differs.
6. Never edit app code, `e2e/`, `src/`, `.env*`, or stack.sh. To extend the harness make a small additive edit; other authors share the file.
7. If a take fails because the APP misbehaves (not your script), do not work around it silently: record up to the bug, keep the assertion so it fails or `t.note()` it, and report it.
8. Check your work: `ffmpeg -v error -y -i X.mp4 -vf "fps=1/2,scale=-2:400,tile=8x2" -frames:v 1 /tmp/sheet-<id>.png` then Read the image, on a sample of takes from each viewport. Confirm captions and outcomes are visible and that nothing covers the action.
9. Scope to your own shard: only use `--shard <k>`, and only kill your own processes. Don't touch :3000, :8025 or other shards.
