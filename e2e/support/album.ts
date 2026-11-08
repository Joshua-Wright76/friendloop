import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { rows } from "./db";
import { makeWebm } from "./audio";
import { TINY_PNG } from "./comments";
import { seedDeliveredIssue, seedLoop, seedOpenIssue, type SeededLoop } from "./seed";

/** Write bytes where `/uploads/<hash>.<ext>` serves them, named like storage names them. */
export async function writeUpload(seed: string, extension: "png" | "webm"): Promise<string> {
  const hash = createHash("sha256").update(seed).digest("hex");
  const directory = path.join(process.cwd(), "public", "uploads");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${hash}.${extension}`), extension === "png" ? TINY_PNG : makeWebm());
  return `/uploads/${hash}.${extension}`;
}

async function replyFor(issueId: string, questionText: string, membershipId: string, input: {
  body?: string;
  photoUrl?: string;
  audioUrl?: string;
  /** A draft the round went out without, from before answers saved straight into the round. */
  neverSent?: boolean;
}): Promise<string> {
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 and text = $2",
    [issueId, questionText],
  );
  const [reply] = await rows<{ id: string }>(
    `insert into replies (issue_id, issue_question_id, membership_id, body, photo_url, audio_url, audio_duration_ms, status, submitted_at, never_sent)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8 then 'draft'::reply_status else 'submitted'::reply_status end, now(), $8) returning id`,
    [
      issueId,
      question.id,
      membershipId,
      input.body ?? "",
      input.photoUrl ?? null,
      input.audioUrl ?? null,
      input.audioUrl ? 4_000 : null,
      input.neverSent ?? false,
    ],
  );
  return reply.id;
}

async function sectionReplyFor(issueId: string, title: string, membershipId: string, media: Array<{ url: string; caption: string | null }>, body = "") {
  const [section] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1 and title = $2", [issueId, title]);
  const [reply] = await rows<{ id: string }>(
    `insert into section_replies (issue_id, issue_section_id, membership_id, body, status, submitted_at)
     values ($1, $2, $3, $4, 'submitted', now()) returning id`,
    [issueId, section.id, membershipId, body],
  );
  for (const [position, item] of media.entries()) {
    await rows("insert into section_media (section_reply_id, url, caption, position) values ($1, $2, $3, $4)", [
      reply.id,
      item.url,
      item.caption,
      position,
    ]);
  }
  return reply.id;
}

async function snapshotSection(issueId: string, input: { kind: string; title: string; adminOnly?: boolean; position: number }) {
  await rows(
    `insert into issue_sections (issue_id, kind, title, admin_only, position) values ($1, $2, $3, $4, $5)`,
    [issueId, input.kind, input.title, input.adminOnly ?? false, input.position],
  );
}

export const Q1 = "What made you laugh this week?";
export const Q2 = "What are you looking forward to?";

/**
 * A loop with a lived-in album:
 *   Round 1 (older)  Alice photo "A goose on the towpath"; Bob voice note
 *   Round 2 "Camping weekend"  Bob photo "Tent at dawn"; Alice photo + voice;
 *                    a photo wall with two captioned photos; an admin-only
 *                    section with a photo from Sam
 *   Round 3 (open)   Alice photo that must NOT show: nothing is in the album until delivery
 * plus a never-sent draft photo in round 2 (left from before autosave) that never shows either.
 */
export async function seedAlbum(): Promise<{
  loop: SeededLoop;
  alice: SeededLoop["members"][number];
  bob: SeededLoop["members"][number];
  sam: SeededLoop["members"][number];
  round1: string;
  round2: string;
  round3: string;
  aliceTowpathReply: string;
}> {
  const loop = await seedLoop();
  const person = (prefix: string) => loop.members.find((member) => member.email.startsWith(prefix))!;
  const [sam, alice, bob] = [person("owner"), person("alice"), person("bob")];

  const first = await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-01-09T08:00:00Z"), answers: [] });
  const aliceTowpathReply = await replyFor(first.issueId, Q1, alice.id, {
    body: "A goose on the towpath",
    photoUrl: await writeUpload("towpath", "png"),
  });
  await replyFor(first.issueId, Q2, bob.id, { body: "Listen to the rain", audioUrl: await writeUpload("rain", "webm") });

  const second = await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-01-16T08:00:00Z"), answers: [] });
  await rows("update issues set name = 'Camping weekend' where id = $1", [second.issueId]);
  await replyFor(second.issueId, Q1, bob.id, { body: "Tent at dawn", photoUrl: await writeUpload("tent", "png") });
  await replyFor(second.issueId, Q2, alice.id, {
    body: "The lake swim",
    photoUrl: await writeUpload("lake", "png"),
    audioUrl: await writeUpload("lake", "webm"),
  });
  await replyFor(second.issueId, Q1, sam.id, { body: "Never submitted", photoUrl: await writeUpload("draft", "png"), neverSent: true });
  await snapshotSection(second.issueId, { kind: "photo_wall", title: "Photo wall", position: 0 });
  await snapshotSection(second.issueId, { kind: "standard", title: "Owners only", adminOnly: true, position: 1 });
  await sectionReplyFor(second.issueId, "Photo wall", alice.id, [
    { url: await writeUpload("wall-1", "png"), caption: "Marshmallows, obviously" },
    { url: await writeUpload("wall-2", "png"), caption: "The bridge at night" },
  ]);
  await sectionReplyFor(second.issueId, "Owners only", sam.id, [{ url: await writeUpload("admin", "png"), caption: "Budget receipt" }]);

  const third = await seedOpenIssue(loop, { openedAt: new Date("2026-01-23T08:00:00Z") });
  await replyFor(third.issueId, Q1, alice.id, { body: "Surprise party plans", photoUrl: await writeUpload("secret", "png") });

  return {
    loop,
    alice,
    bob,
    sam,
    round1: first.issueId,
    round2: second.issueId,
    round3: third.issueId,
    aliceTowpathReply,
  };
}
