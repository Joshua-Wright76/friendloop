import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { rows } from "../../e2e/support/db.ts";
import { seedWorld } from "../../e2e/support/identity.ts";
import { TINY_PNG } from "../../e2e/support/comments.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";

const AREA = "T · Photos";
const SCRATCH = "/tmp/flrec-photos";
const CAMERA = `${SCRATCH}/IMG_4021.JPG`;
const NOT_A_PICTURE = `${SCRATCH}/notes.txt`;
const SKETCH = `${SCRATCH}/sketch.png`;

/** A 12-megapixel noisy JPEG: bigger than every cap the server has, like a phone's camera roll. */
function prepareFiles() {
  mkdirSync(SCRATCH, { recursive: true });
  if (!existsSync(CAMERA)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=4000x3000,geq=random(1)*255:128:128", "-frames:v", "1", "-q:v", "2", CAMERA]);
  }
  writeFileSync(NOT_A_PICTURE, "hello, this is not a picture\n");
  writeFileSync(SKETCH, TINY_PNG);
}
const MB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function measure(t, url) {
  return t.eval(`(async () => {
    const response = await fetch(${JSON.stringify(url)});
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { bytes: blob.size, width: bitmap.width, height: bitmap.height };
  })()`);
}

export const flows = {
  T1: { title: "Upload a camera-roll photo", area: AREA,
    staged: "The camera photo is a generated 12-megapixel JPEG over 5 MB. The sizes on the panels are measured from the stored files.",
    seed: async () => { prepareFiles(); return seedWorld(); },
    run: async (t, { loop, delivered, alice }) => {
      const size = statSync(CAMERA).size;
      t.check_(size > 5 * 1024 * 1024, "The fixture should be over 5 MB");
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open(`/r/${alice.token}`);
      await t.say(`A ${MB(size)} camera photo goes on an answer`);
      await t.panel("the file on the phone", `IMG_4021.JPG, 4000×3000, ${MB(size)}\nVercel's request limit is 4.5 MB`);
      await t.upload('input[aria-label="Add a photo, question 1"]', CAMERA);
      await t.see("Photo saved", { timeout: 40_000 });
      const [reply] = await rows("select photo_url from replies where membership_id = $1 and photo_url is not null", [alice.id]);
      const answer = await measure(t, reply.photo_url);
      await t.panel("stored answer photo", `${answer.width}×${answer.height}, ${MB(answer.bytes)}  (limit 2560 px, 3.5 MB)`);
      t.check_(Math.max(answer.width, answer.height) <= 2560 && answer.bytes <= 3.5 * 1024 * 1024, "The answer photo should be scaled down");

      await t.say("Text that isn't a picture is turned away in plain words");
      await t.upload('input[aria-label="Add a photo, question 2"]', NOT_A_PICTURE);
      await t.see("We couldn't read that photo. Try a JPEG or PNG.");
      const stored = await rows("select 1 from replies where membership_id = $1 and photo_url is not null", [alice.id]);
      t.check_(stored.length === 1, "Nothing more should be stored");

      await t.say("The same photo as a profile picture");
      await t.upload('input[aria-label="Choose a photo of yourself"]', CAMERA);
      await t.see("Photo saved.", { timeout: 40_000 });
      const [member] = await rows("select photo_url from memberships where id = $1", [alice.id]);
      const avatar = await measure(t, member.photo_url);
      await t.panel("stored profile photo", `${avatar.width}×${avatar.height}, ${MB(avatar.bytes)}  (limit 512 px)`);
      t.check_(Math.max(avatar.width, avatar.height) <= 512, "The profile photo should be 512 px at most");

      await t.say("And on a comment on a delivered round");
      await t.open(`/i/${delivered.issueId}?m=${alice.token}`);
      await t.clickRole("textbox", "Comment", { exact: true });
      await t.typeKeys("Look at this one.");
      await t.upload('form input[type="file"]', CAMERA);
      await t.see("Photo: IMG_4021", { timeout: 40_000 });
      await t.button("Post", { exact: true });
      await t.see("Look at this one.");
      const [comment] = await rows("select photo_url from comments where membership_id = $1", [alice.id]);
      const onComment = await measure(t, comment.photo_url);
      await t.panel("stored comment photo", `${onComment.width}×${onComment.height}, ${MB(onComment.bytes)}`);
      t.check_(onComment.bytes <= 3.5 * 1024 * 1024, "The comment photo should be under its limit");

      await t.say("A small PNG goes as it is, byte for byte");
      await t.upload('form input[type="file"]', SKETCH);
      await t.see("Photo: sketch.png");
      await t.button("Post", { exact: true });
      await t.pause(1500);
      const [drawn] = await rows("select photo_url from comments where membership_id = $1 and photo_url like '%.png'", [alice.id]);
      t.check_(Boolean(drawn), "The PNG should be stored as a PNG");
      const same = await measure(t, drawn.photo_url);
      await t.panel("stored PNG", `${same.bytes} bytes, the file was ${TINY_PNG.length} bytes`);
      t.check_(same.bytes === TINY_PNG.length, "The PNG should arrive unchanged");

      await t.say("The owner uses it as a header picture");
      await t.signInAs("owner@friendloop.test");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.upload('input[aria-label="Choose a header picture"]', CAMERA);
      await t.see("Header picture saved.", { timeout: 40_000 });
      const [group] = await rows("select header_image_url from groups where id = $1", [loop.groupId]);
      const banner = await measure(t, group.header_image_url);
      await t.panel("stored header picture", `${banner.width}×${banner.height}, ${MB(banner.bytes)}  (limit 2400 px)`);
      t.check_(Math.max(banner.width, banner.height) <= 2400, "The header should be 2400 px at most");
      await t.toTop();
    } },
};
