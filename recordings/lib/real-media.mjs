/**
 * Video furniture for media flows. The e2e seeds write tiny placeholder bytes
 * (a 1x1 PNG, a silent webm stub), which is right for assertions and useless on
 * camera, so these helpers swap real pictures and real audio in under the same
 * /uploads addresses and hand out real clips for the recorder double.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RECORDINGS } from "./harness.mjs";

const CACHE = path.join(tmpdir(), "flrec-media");

/** A real opus webm tone of the given length. Cached; returns its path. */
export function clipPath(seconds, frequency = 440, bitrate = "24k") {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `tone-${seconds}s-${frequency}-${bitrate}.webm`);
  if (!existsSync(file)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}`, "-c:a", "libopus", "-b:a", bitrate, file]);
  }
  return file;
}

/** A file of `megabytes` that starts like webm: over the size cap, without being a real recording. */
export function oversizePath(megabytes = 5) {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `oversize-${megabytes}mb.webm`);
  if (!existsSync(file)) {
    const bytes = Buffer.alloc(megabytes * 1024 * 1024, 0);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
    writeFileSync(file, bytes);
  }
  return file;
}

/**
 * Layer on top of FAKE_RECORDER: its stop() emits these real clips (in turn)
 * instead of a stub, so the sheet's player shows a real length. Install after it.
 */
export function realClipsForRecorder(clips) {
  const encoded = clips.map((clip) => readFileSync(clip).toString("base64"));
  return `(() => {
    if (typeof MediaRecorder === "undefined") return;
    const clips = ${JSON.stringify(encoded)}.map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    let take = 0;
    MediaRecorder.prototype.stop = function () {
      if (this.state === "inactive") return;
      this.state = "inactive";
      const bytes = clips[take++ % clips.length];
      if (this.ondataavailable) this.ondataavailable({ data: new Blob([bytes], { type: "audio/webm" }) });
      if (this.onstop) this.onstop();
    };
  })();`;
}

function uploadFile(url) {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
}

/** Put real photos and real audio under every placeholder upload the seed referenced. */
export async function dressUploads(rows) {
  const photos = await rows(`select url from (
      select photo_url as url, created_at as at from replies where photo_url is not null
      union all select m.url, r.created_at from section_media m join section_replies r on r.id = m.section_reply_id
    ) p order by at, url`);
  [...new Set(photos.map((row) => row.url))].forEach((url, index) => {
    writeFileSync(uploadFile(url), readFileSync(path.join(RECORDINGS, "fixtures", `photo${(index % 7) + 1}.jpg`)));
  });
  const notes = await rows("select distinct audio_url as url, audio_duration_ms as ms from replies where audio_url is not null");
  for (const { url, ms } of notes) {
    writeFileSync(uploadFile(url), readFileSync(clipPath(Math.max(1, Math.round((ms ?? 4000) / 1000)))));
  }
}

/** Start the first player on the page, muted (the video has no sound), and prove time moves. */
export async function playFirstNote(t, selector = "audio") {
  // A user gesture stands in for the tap on the play button, which the browser's autoplay rule asks for.
  const { result: { value: result } } = await t.page("Runtime.evaluate", { returnByValue: true, awaitPromise: true, userGesture: true, expression: `(async () => {
    const a = document.querySelector(${JSON.stringify(selector)});
    if (!a) return { error: "no player" };
    a.scrollIntoView({ block: "center" });
    a.muted = true;
    try { await a.play(); } catch (e) { return { error: String(e) }; }
    await new Promise((r) => setTimeout(r, 1800));
    return { currentTime: a.currentTime, duration: a.duration, src: a.getAttribute("src") };
  })()` });
  t.check_(!result.error, `The player would not play: ${result.error}`);
  t.check_(result.currentTime > 0, "The player's time did not move");
  return result;
}
