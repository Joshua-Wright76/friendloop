#!/usr/bin/env node
// Builds recordings/site/: index.html + videos. Open index.html directly; no server needed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = import.meta.dirname;
const SITE = path.join(ROOT, "site");
const SPEC = readFileSync(path.join(ROOT, "..", "specs", "flows.md"), "utf8");

const spec = {};
let section = "";
const order = [];
for (const line of SPEC.split("\n")) {
  const heading = line.match(/^## (.+)$/);
  if (heading) { section = heading[1]; order.push(section); }
  const row = line.match(/^\| ([A-Z]\d+) \| (.+?) \| (.+?) \| \w+ \|$/);
  if (row) spec[row[1]] = { section, title: row[2], criteria: row[3] };
}

const findings = existsSync(path.join(ROOT, "findings.json")) ? JSON.parse(readFileSync(path.join(ROOT, "findings.json"), "utf8")) : [];
const overrides = existsSync(path.join(ROOT, "step-overrides.json")) ? JSON.parse(readFileSync(path.join(ROOT, "step-overrides.json"), "utf8")) : [];
rmSync(SITE, { recursive: true, force: true });
const takes = new Map();
for (const kind of ["flows", "journeys"]) {
  for (const viewport of ["desktop", "mobile"]) {
    const dir = path.join(ROOT, "output", kind, viewport);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const take = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      const source = path.join(dir, `${take.id}.mp4`);
      const entry = takes.get(take.id) ?? { id: take.id, kind, title: take.title, staged: take.staged, views: {} };
      const view = { status: take.status, error: take.error, steps: take.steps, notes: take.notes, consoleErrors: take.consoleErrors };
      if (existsSync(source)) {
        const target = path.join(SITE, "videos", kind, viewport, `${take.id}.mp4`);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target);
        view.src = `videos/${kind}/${viewport}/${take.id}.mp4`;
        view.bytes = statSync(source).size;
        view.seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], { encoding: "utf8" }));
        // A real frame for the poster, past the blank first moment of each take.
        // A take opens on a blank tab: the player hides that with the poster until the app appears.
        const scene = spawnSync("ffmpeg", ["-hide_banner", "-t", "5", "-i", source, "-vf", "select='gt(scene,0.05)',showinfo", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
        const first = scene.match(/pts_time:([\d.]+)/);
        view.contentAt = first ? Number(first[1]) : 0;
        // One frame per step for the storyboard: within that step's beat, the frame that differs most from the last
        // one chosen, so neighbouring steps don't show the same screen. Sampled once per take, at 2 per second.
        const W = 160, H = 104;
        const raw = spawnSync("ffmpeg", ["-v", "error", "-i", source, "-vf", `fps=2,scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 }).stdout;
        const frameCount = Math.floor(raw.length / (W * H));
        const sampleAt = (time) => { const index = Math.max(0, Math.min(Math.floor(time * 2), frameCount - 1)); return raw.subarray(index * W * H, (index + 1) * W * H); };
        const distance = (x, y) => { if (!x?.length || !y?.length) return 0; let sum = 0; for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]); return sum / x.length; };
        // How much of the frame visibly changed: catches small things like typing, which an average would miss.
        const changed = (x, y) => { if (!x?.length || !y?.length) return 0; let count = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 14) count++; return count / x.length; };
        // Blank means a white page mid-navigation, not a dark one: the app's own background is dark and even.
        const blank = (frame) => { if (!frame?.length) return true; let bright = 0; for (const value of frame) if (value > 235) bright++; return bright / frame.length > 0.97; };
        // A rendered email fills its pane with colour; a large pure-white block means its body hasn't painted yet.
        const unpainted = (frame) => {
          // An unbroken white block filling a fifth of the height. Printed pages are white too, but their text breaks it up.
          let run = 0, longest = 0;
          for (let row = 0; row < H; row++) {
            let first = -1, last = -1, clean = true;
            for (let col = 0; col < W; col++) { if (frame[row * W + col] > 250) { if (first < 0) first = col; last = col; } }
            if (first >= 0) for (let col = first; col <= last; col++) if (frame[row * W + col] <= 250) { clean = false; break; }
            run = first >= 0 && clean && last - first > W * 0.3 ? run + 1 : 0;
            longest = Math.max(longest, run);
          }
          return longest > H * 0.2;
        };
        const bad = (time) => blank(sampleAt(time)) || unpainted(sampleAt(time));
        // Compare screens without the caption bands, so a new caption doesn't count as a change on screen.
        const screen = (frame) => frame.subarray(Math.floor(H * 0.09) * W, Math.floor(H * 0.9) * W);
        let lastChosen = null;
        const sameAsLast = [];
        const stateCounts = [];
        const moments = (view.steps ?? []).map((step, index) => {
          // A step's caption comes first and its action follows, so what the caption describes is on screen by the
          // time the next caption starts. Jumping to a step lands there; "Replay step" shows the action leading up to it.
          const end = Math.min(view.steps[index + 1]?.t ?? view.seconds, view.seconds - 0.1);
          // Screens the step passes through, as [start, end] stretches where nothing big changes. The script dwells on
          // the thing a caption describes and hurries through setup, so the longest stretch is the step's own state;
          // ties go to the later one. Land at the end of it, without ever crossing into the next step.
          const stretches = [];
          let start = Math.min(step.t + 0.5, end - 0.1);
          let previous = screen(sampleAt(start));
          for (let time = start + 0.5; time < end; time += 0.5) {
            const here = screen(sampleAt(time));
            if (changed(here, previous) > 0.015) { stretches.push([start, time - 0.5]); start = time; }
            previous = here;
          }
          stretches.push([start, Math.max(start, end - 0.1)]);
          const usable = stretches.filter(([a, b]) => !bad(b));
          const pool = usable.length ? usable : stretches;
          // The latest screen held for at least a second is the step's result: the script pauses on what a caption
          // describes, and setup for the next step flies past. Land a little before it ends, clear of the transition.
          const held = pool.filter(([from, to]) => to - from >= 1);
          const chosen = held.length ? held[held.length - 1] : pool.reduce((best, item) => (item[1] - item[0] >= best[1] - best[0] ? item : best));
          let land = Math.max(step.t, chosen[0], Math.min(chosen[1] - 0.3, end - 0.1));
          // A few captions describe a brief state such as a prompt: see step-overrides.json.
          const override = overrides.find((item) => (item.id ? item.id === take.id && step.text.includes(item.step) : new RegExp(item.match, "i").test(step.text)) && (!item.view || item.view === viewport));
          if (override?.at != null) land = override.at;
          else if (override?.end) land = end - 0.4;
          else if (override) {
            const from = Math.min(step.t + 0.5, end);
            let time = from + 0.5;
            while (time < end && changed(screen(sampleAt(time)), screen(sampleAt(from))) <= (override.threshold ?? 0.02)) time += 0.5;
            land = Math.min(time + (override.settle ?? 1), end - 0.1);
          }
          for (let wait = 0; wait < 8 && bad(land) && land + 0.5 < end; wait++) land += 0.5;
          for (let wait = 0; wait < 8 && bad(land) && land - 0.5 > step.t; wait++) land -= 0.5;
          land = Math.max(step.t, Math.min(land, end - 0.05));
          step.land = Math.round(land * 100) / 100;
          sameAsLast.push(lastChosen ? changed(screen(sampleAt(land)), lastChosen) < 0.0002 : false);
          lastChosen = screen(sampleAt(land));
          // How many distinct screens this step passes through.
          let states = 1; let prev = screen(sampleAt(Math.min(step.t + 0.5, end)));
          for (let time = step.t + 1; time < end; time += 0.5) { const here = screen(sampleAt(time)); if (changed(here, prev) > 0.03) { states++; prev = here; } }
          stateCounts.push(states);
          return land;
        });
        view.same = sameAsLast;
        view.states = stateCounts;
        const momentOf = (index) => Math.max(0.1, Math.min((view.steps[index + 1]?.t ?? view.seconds) - 0.5, view.seconds - 0.2));
        const grab = (at, file, width) => {
          const cached = path.join(dir, `.thumbs-${at.toFixed(2)}-${path.basename(file)}`);
          if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(source).mtimeMs) execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", source, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "6", cached]);
          copyFileSync(cached, file);
        };
        view.thumbs = [];
        for (let index = 0; index < (view.steps?.length ?? 0); index++) {
          const file = target.replace(/\.mp4$/, `.s${index}.jpg`);
          grab(moments[index], file, viewport === "desktop" ? 360 : 180);
          view.thumbs.push(view.src.replace(/\.mp4$/, `.s${index}.jpg`));
        }
        // The poster: the moment a finding points at if there is one, otherwise the end of the first beat.
        const watch = findings.flatMap((finding) => finding.watch ?? []).find((item) => item.id === take.id && item.step);
        const watchIndex = watch ? view.steps.findIndex((item) => item.text.includes(watch.step)) : -1;
        const posterAt = watchIndex >= 0 ? (watch.offset != null ? view.steps[watchIndex].t + watch.offset : momentOf(watchIndex)) : view.steps?.length ? momentOf(0) : Math.min(view.seconds * 0.4, 9);
        const poster = target.replace(/\.mp4$/, ".jpg");
        grab(posterAt, poster, viewport === "desktop" ? 1440 : 788);
        view.poster = view.src.replace(/\.mp4$/, ".jpg");
      }
      entry.views[viewport] = view;
      takes.set(take.id, entry);
    }
  }
}

const natural = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true });
const groups = [];
const journeys = [...takes.values()].filter((take) => take.kind === "journeys").sort(natural);
if (journeys.length) groups.push({ name: "Journeys", blurb: "Long, continuous stories through the app.", items: journeys });
for (const name of order) {
  const items = [...takes.values()].filter((take) => take.kind === "flows" && spec[take.id]?.section === name).sort(natural);
  for (const item of items) { item.title = spec[item.id].title; item.criteria = spec[item.id].criteria; }
  if (items.length) groups.push({ name, items });
}
const orphans = [...takes.values()].filter((take) => take.kind === "flows" && !spec[take.id]);
if (orphans.length) throw new Error(`Takes with no flow in specs/flows.md: ${orphans.map((take) => take.id).join(", ")}`);
const uncovered = Object.keys(spec).filter((id) => !takes.has(id));
const data = { groups, uncovered, builtAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() };

data.findings = findings;
const template = readFileSync(path.join(ROOT, "gallery.template.html"), "utf8");
mkdirSync(SITE, { recursive: true });
const fill = (html) => html.replace("/*DATA*/null", () => JSON.stringify(data).replaceAll("</", "<\\/"));
writeFileSync(path.join(SITE, "index.html"), fill(template));
// Every saved version stays openable next to the latest, sharing the same videos.
const versionsDir = path.join(ROOT, "gallery-versions");
if (existsSync(versionsDir)) {
  for (const name of readdirSync(versionsDir)) {
    const file = path.join(versionsDir, name, "template.html");
    if (existsSync(file)) writeFileSync(path.join(SITE, `${name}.html`), fill(readFileSync(file, "utf8")));
  }
}
writeFileSync(path.join(SITE, ".nojekyll"), "");
const all = [...takes.values()].flatMap((take) => Object.values(take.views));
const mb = all.reduce((sum, view) => sum + (view.bytes ?? 0), 0) / 1e6;
console.log(`${takes.size} recordings, ${all.length} takes, ${all.filter((view) => view.status !== "pass").length} failing, ${mb.toFixed(0)} MB, uncovered: ${uncovered.join(",") || "none"}`);
