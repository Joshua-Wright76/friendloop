import { createHash } from "node:crypto";
import { seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { enableShare, makeWebm, seedAudioReply } from "../../e2e/support/audio.ts";
import { FAKE_RECORDER } from "../lib/fake-recorder.mjs";
import { clipPath, dressUploads, oversizePath, playFirstNote, realClipsForRecorder } from "../lib/real-media.mjs";

const AREA = "J · Voice replies";
const Q1 = "What made you laugh this week?";
const STAGED_RECORDER = "No microphone here: the FAKE_RECORDER double stands in for capture and hands over a pre-made audio clip when recording stops. Everything after that (upload, storage, the database, the player) is the real app. The video has no sound.";

/**
 * Today's (or, before 08:00 UTC, yesterday's) slot. The recorder's timer needs the
 * real clock, so rounds are dated around today. The loop's weekday is that same
 * day and the window two days, so delivering it doesn't also open the next round,
 * and it stays the latest round for reply links.
 */
function todaysSlot() {
  const at = new Date();
  at.setUTCHours(8, 0, 0, 0);
  if (at > new Date()) at.setUTCDate(at.getUTCDate() - 1);
  return at;
}
const person = (loop, prefix) => loop.members.find((member) => member.email.startsWith(prefix));

async function seedOpenRound() {
  const openedAt = todaysSlot();
  const loop = await seedLoop({ promptWeekday: openedAt.getUTCDay() });
  const round = await seedOpenIssue(loop, { openedAt, windowDays: 2 });
  return { loop, round, alice: person(loop, "alice") };
}
const noteRows = () => rows("select audio_url, audio_duration_ms, added_after_delivery, status from replies where audio_url is not null");
const short = (url) => url.replace(/^.*(\/uploads\/.{10}).*(\..+)$/, "$1…$2");

async function fakeMic(t) {
  await t.initScript(FAKE_RECORDER);
  await t.initScript(realClipsForRecorder([clipPath(4, 440), clipPath(6, 660)]));
}
async function record(t, label = "Record a voice note") {
  await t.button(label);
  await t.see("Recording…");
  await t.pause(3200);
  await t.button("Stop recording");
}
/** Bring the voice controls and the player into the frame. */
async function showPlayer(t) {
  await t.eval(`document.querySelector("audio")?.scrollIntoView({ behavior: "smooth", block: "center" })`);
  await t.pause(700);
}
/**
 * A typed line goes with the note because of the bug below: without one, the note
 * would never be delivered and this flow couldn't reach the reading side.
 */
async function sendWithWords(t, words) {
  await t.fill('textarea[id^="reply-"]', words);
  await t.pause(600);
  await t.button("Send answers");
  await t.see("Sent");
  const sent = await rows("select status from replies where audio_url is not null");
  t.check_(sent[0]?.status === "submitted", `The answer should be submitted, is ${sent[0]?.status}`);
}
/** The reply link shows "Sent" once answers are in; editing them is one tap further. */
async function openSheetForEditing(t, alice) {
  await t.open(`/r/${alice.token}`);
  const ready = await t.eval(`[...document.querySelectorAll("button")].some((b) => /Record again|Record a voice note/.test(b.getAttribute("aria-label") || b.textContent))`);
  if (!ready) await t.button("Edit");
}
const fileInput = async (t, index = 0) => {
  const id = await t.eval(`[...document.querySelectorAll('input[type=file][id^="audio-"]')][${index}]?.id`);
  t.check_(id, "No audio file picker on the page");
  return `[id="${id}"]`;
};

export const flows = {
  J1: { title: "Record an answer", area: AREA, staged: STAGED_RECORDER, seed: seedOpenRound,
    run: async (t, { alice }) => {
      await fakeMic(t);
      await t.say("Alice opens her reply sheet");
      await t.open(`/r/${alice.token}`);
      await t.see(Q1);
      await t.say("Each question offers a voice note");
      await t.see("Record a voice note");
      await t.say("Record, and the timer runs");
      await record(t);
      await t.say("Stop, and it saves itself as a draft");
      await t.see("Voice note saved.");
      await showPlayer(t);
      await t.say("Preview it right there, with its length");
      await playFirstNote(t);
      await t.say("Reload the page: the note is still attached");
      await t.reload();
      await showPlayer(t);
      t.check_(await t.eval(`Boolean(document.querySelector("audio"))`), "The note did not survive a reload");
      await t.see("Record again");
      const [note] = await noteRows();
      t.check_(note && note.audio_duration_ms > 0, "No voice note on the reply row");
      await t.panel("replies row after reload", `audio_url ${short(note.audio_url)}\nduration ${note.audio_duration_ms} ms\nstatus ${note.status}`);
    } },

  J2: { title: "Replace and remove", area: AREA, staged: `${STAGED_RECORDER} Delivery is triggered by running the real sweep at the round's delivery time.`, seed: seedOpenRound,
    run: async (t, { alice, round }) => {
      await fakeMic(t);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice records a note");
      await record(t);
      await t.see("Voice note saved.");
      const [first] = await noteRows();
      await t.say("Not happy with it: record again over the top");
      await record(t, "Record again");
      await t.see("Voice note saved.");
      const [second] = await noteRows();
      t.check_(second.audio_url !== first.audio_url, "Re-recording should store a new file");
      await t.panel("the reply row's audio", `was ${short(first.audio_url)}\nnow ${short(second.audio_url)}`, { hold: 2800 });
      await t.say("Or take it off altogether");
      await t.button("Remove voice note");
      await t.see("Voice note removed.");
      t.check_((await noteRows()).length === 0, "The note should be gone from the reply");
      await t.dontSee("Record again");

      await t.say("She records one more and sends just the note");
      await record(t);
      await t.see("Voice note saved.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("The round goes out with her note");
      await t.sweep(new Date(round.deliversAt.getTime() + 60_000), { show: false });
      await t.open(`/i/${round.issueId}?m=${alice.token}`);
      await t.see(Q1);
      await showPlayer(t);
      await t.dontSee("added after the round went out");
      await t.say("After delivery she can still replace it");
      await openSheetForEditing(t, alice);
      await record(t, "Record again");
      await t.see("Voice note saved.");
      const [late] = await noteRows();
      t.check_(late.added_after_delivery === true, "A replacement after delivery should be flagged added_after_delivery");
      await t.say("The web round says so: the note arrived late");
      await t.open(`/i/${round.issueId}?m=${alice.token}`);
      await showPlayer(t);
      await t.see("added after the round went out");
      await t.panel("the reply row", `audio_url ${short(late.audio_url)}\nadded_after_delivery ${late.added_after_delivery}`, { hold: 2800 });
      await t.say("And she can still delete it");
      await openSheetForEditing(t, alice);
      await t.button("Remove voice note");
      await t.see("Voice note removed.");
      await t.open(`/i/${round.issueId}?m=${alice.token}`);
      await t.pause(600);
      t.check_(!(await t.eval(`Boolean(document.querySelector("audio"))`)), "The removed note is still on the web round");
      await t.say("The web round has no player any more");
      await t.dontSee("Voice note,");
    } },

  J3: { title: "Limits, plainly", area: AREA,
    staged: `${STAGED_RECORDER} To reach the 3-minute stop without a 3-minute video, the page's clock is jumped forward once mid-recording; the app's own timer reacts to it. The long file is a real 4-minute recording and the big file is 5 MB of padding.`,
    seed: seedOpenRound,
    run: async (t, { alice }) => {
      await fakeMic(t);
      await t.initScript(`(() => { const real = Date.now.bind(Date); let skip = 0; Date.now = () => real() + skip; window.__jump = (ms) => { skip += ms; }; })();`);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice records for a long time");
      await t.button("Record a voice note");
      await t.see("Recording…");
      await t.eval(`window.__jump(175000)`);
      await t.say("Close to the limit: nearly three minutes", { hold: 2500 });
      await t.see("Recording… 2:5", { hold: 300 });
      await t.say("The hard stop at three minutes, in plain words");
      await t.see("Voice notes run up to 3 minutes.", { timeout: 9000 });
      await t.dontSee("Recording…");
      await t.say("A four-minute file from her phone gets the same answer");
      await t.reload();
      await t.upload(await fileInput(t), clipPath(240, 330, "8k"));
      await t.see("Voice notes run up to 3 minutes.");
      await t.say("A file over the size cap: the same warm tone");
      await t.reload();
      await t.upload(await fileInput(t), oversizePath());
      await t.see("That recording is too big. Try a note under 3 minutes.");
      await t.say("Skip the page and post directly: still no 500");
      const questionId = await rows("select id from issue_questions order by position limit 1").then(([row]) => row.id);
      const post = (bytes, durationMs) => t.eval(`(async () => {
        const form = new FormData();
        form.set("issueQuestionId", ${JSON.stringify(questionId)});
        form.set("audio", new File([new Uint8Array(${bytes}).fill(0).map((v, i) => [0x1a, 0x45, 0xdf, 0xa3][i] ?? 0)], "voice-note.webm", { type: "audio/webm" }));
        form.set("durationMs", "${durationMs}");
        const response = await fetch("/api/reply/${alice.token}/audio", { method: "POST", body: form });
        return { status: response.status, body: await response.text() };
      })()`);
      const tooLong = await post(makeWebm().length, 4 * 60_000);
      const tooBig = await post(5 * 1024 * 1024, 1000);
      t.check_(tooLong.status === 413 && tooLong.body.includes("3 minutes"), `Duration cap answered ${tooLong.status}: ${tooLong.body}`);
      t.check_(tooBig.status === 413 && tooBig.body.includes("too big"), `Size cap answered ${tooBig.status}: ${tooBig.body}`);
      await t.panel("POST /api/reply/…/audio", `4 minutes → HTTP ${tooLong.status}\n${tooLong.body}\n\n5 MB → HTTP ${tooBig.status}\n${tooBig.body}`, { hold: 4500 });
      const stored = await noteRows();
      t.check_(stored.length === 0, "Nothing should have been stored");
      await t.say("Nothing was stored, and the sheet is clean");
      await t.reload();
      await t.see("Record a voice note");
      t.check_(!(await t.eval(`Boolean(document.querySelector("audio"))`)), "No player should be on the sheet");
    } },

  J4: { title: "Where recording isn't possible", area: AREA,
    staged: "Each browser condition is simulated: a script removes MediaRecorder or the microphone API, marks the page not secure, or makes the microphone refuse with the same error a real browser gives. The file picker upload is real.",
    seed: seedOpenRound,
    run: async (t, { alice }) => {
      await t.initScript(`(() => {
        const mode = (() => { try { return sessionStorage.getItem("flrec-mode") || "none"; } catch { return "none"; } })();
        if (mode === "none" || mode === "insecure") {
          Object.defineProperty(navigator, "mediaDevices", { get: () => undefined });
          Reflect.deleteProperty(window, "MediaRecorder");
        }
        if (mode === "insecure") Object.defineProperty(window, "isSecureContext", { get: () => false });
        if (mode === "mic") {
          window.__mic = "NotAllowedError";
          Object.defineProperty(navigator, "mediaDevices", { get: () => ({ getUserMedia: () => Promise.reject(new DOMException("no", window.__mic)) }) });
        }
      })();`);
      const mode = async (value) => {
        await t.eval(`sessionStorage.setItem("flrec-mode", ${JSON.stringify(value)})`);
        await t.reload();
      };
      await t.say("A browser with no way to record");
      await t.open(`/r/${alice.token}`);
      await t.see("This browser can't record here");
      await t.dontSee("Record a voice note");
      await t.say("The file picker takes over");
      await t.see("Choose an audio file");
      const accept = await t.eval(`document.querySelector('input[id^="audio-"]').accept`);
      await t.upload(await fileInput(t), "note.m4a");
      await t.see("Voice note saved.");
      await showPlayer(t);
      const [note] = await noteRows();
      t.check_(note && /\.m4a$/.test(note.audio_url), "The picked file should be stored as m4a");
      await t.panel("the picker accepts", `${accept}\n\nsaved: ${short(note.audio_url)}, ${note.audio_duration_ms} ms`, { hold: 2800 });
      await t.say("On a plain http page it says that instead");
      await mode("insecure");
      await t.see("Recording only works on a secure (https) page");
      await t.dontSee("This browser can't record here");
      await t.see("Choose an audio file");
      await t.say("The microphone is refused: named as such");
      await mode("mic");
      await t.button("Record a voice note");
      await t.see("This browser is blocking the microphone");
      await t.say("No microphone at all: its own words");
      await t.eval(`window.__mic = "NotFoundError"`);
      await t.button("Record a voice note");
      await t.see("We couldn't find a microphone.");
      await t.say("Another app holding it: its own words too");
      await t.eval(`window.__mic = "NotReadableError"`);
      await t.button("Record a voice note");
      await t.see("Another app is using the microphone.");
    } },

  J5: { title: "Reading and the email snapshot", area: AREA,
    staged: "The note is seeded on the reply; delivery is the real sweep run at the round's delivery time, and the email is the one it really sent.",
    seed: async () => {
      const { loop, round, alice } = await seedOpenRound();
      await seedAudioReply({ issueId: round.issueId, membershipId: alice.id, questionText: Q1, body: "The cat fist bump.", durationMs: 4_000 });
      await dressUploads(rows);
      return { loop, round, alice };
    },
    run: async (t, { round, alice }) => {
      await t.say("Alice has sent her answer, with a voice note");
      await t.open(`/r/${alice.token}`);
      await t.see("Sent");
      await t.say("The round goes out");
      await t.sweep(new Date(round.deliversAt.getTime() + 60_000));
      await t.say("The delivery email arrives");
      const full = await t.openMail({ to: alice.email, subject: "" });
      t.check_(!/<audio/i.test(full.HTML), "The email must not embed audio");
      t.check_(/Listen on the web issue/.test(full.HTML), "The email should point to the web issue");
      await t.say("A card, not a player: listen on the web issue");
      await t.open(`${t.stack.mailpit}/view/${full.ID}.html`);
      await t.see("Listen on the web issue");
      await t.panel("the email's HTML", `<audio> tags: 0\n"Voice note" card: ${/Voice note/.test(full.HTML) ? "yes" : "no"}`, { hold: 2500 });
      await t.say("Follow the link to the web issue");
      await t.open(t.mailLink(`/i/${round.issueId}`));
      await t.see("The cat fist bump.");
      await showPlayer(t);
      await t.say("Here it's a real player");
      const playing = await playFirstNote(t);
      await t.panel("the player", `length ${playing.duration.toFixed(1)} s\nplayed to ${playing.currentTime.toFixed(1)} s`, { hold: 2000 });
    } },

  J6: { title: "Media parity", area: AREA,
    staged: "Sharing is switched on directly in the database; the note is uploaded for real through the file picker and delivered by the real sweep. The panel shows the addresses and a checksum of the bytes the server actually returned.",
    seed: seedOpenRound,
    run: async (t, { loop, round, alice }) => {
      await t.say("Alice attaches a note to her answer and sends it");
      await t.open(`/r/${alice.token}`);
      await t.upload(await fileInput(t), "note.mp3");
      await t.see("Voice note saved.");
      await t.upload('input[id^="photo-"]', "photo1.jpg");
      await t.see("Photo saved");
      await t.button("Send answers");
      await t.see("Sent");
      await t.sweep(new Date(round.deliversAt.getTime() + 60_000), { show: false });
      await enableShare({ groupId: loop.groupId, issueId: round.issueId, shareToken: "share-token-j6" });
      await t.say("Someone with only the share link, signed out");
      await t.signInAs(null);
      await t.open("/s/share-token-j6");
      await t.see(Q1);
      await showPlayer(t);
      await t.say("They can hear the note, like the photos");
      const playing = await playFirstNote(t);
      await t.say("Stored like a photo: the same kind of long, unguessable name");
      const response = await fetch(t.url(playing.src));
      const digest = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
      const name = playing.src.match(/\/uploads\/([a-f0-9]{64})\.mp3$/)?.[1];
      const [{ photo_url: photo }] = await rows("select photo_url from replies where photo_url is not null");
      t.check_(response.status === 200, `The file answered ${response.status}`);
      t.check_(name, `The note's address isn't a 64-hex name: ${playing.src}`);
      t.check_(/\/uploads\/[a-f0-9]{64}\.jpg$/.test(photo), `The photo's address isn't a 64-hex name: ${photo}`);
      await t.panel("the addresses", `note  ${short(playing.src)}  HTTP ${response.status}, ${response.headers.get("content-type")}\nphoto ${short(photo)}\nnote's sha-256 ${digest.slice(0, 10)}… ${name === digest ? "matches" : "differs: the name is random"}`, { hold: 4500 });
    } },
};
