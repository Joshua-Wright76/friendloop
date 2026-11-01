import { db } from "@/db";
import { groups, issues, issueQuestions, replies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Attach a submitted voice note to a reply, as the upload endpoint would have:
 * a content-hashed name under /uploads, exactly like storage stores it in
 * development.
 */
export async function seedAudioReply(input: {
  issueId: string;
  membershipId: string;
  questionText: string;
  body?: string;
  durationMs?: number;
}): Promise<string> {
  const [question] = await db
    .select({ id: issueQuestions.id })
    .from(issueQuestions)
    .where(and(eq(issueQuestions.issueId, input.issueId), eq(issueQuestions.text, input.questionText)))
    .limit(1);
  if (!question) throw new Error(`No question "${input.questionText}" on issue ${input.issueId}`);

  const hash = Array.from({ length: 64 }, (_, index) => "abcdef0123456789"[(index * 7 + 3) % 16]).join("");
  const audioUrl = `/uploads/${hash}.webm`;

  // Storage would have written these bytes; write them so playback answers.
  const uploadsDirectory = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(path.join(uploadsDirectory, `${hash}.webm`), makeWebm());

  await db.insert(replies).values({
    issueId: input.issueId,
    issueQuestionId: question.id,
    membershipId: input.membershipId,
    body: input.body ?? "",
    audioUrl,
    audioDurationMs: input.durationMs ?? 1_200,
    status: "submitted",
    submittedAt: new Date(),
  });
  return audioUrl;
}

/** Turn sharing on with a known token, as the owner's settings action would. */
export async function enableShare(input: { groupId: string; issueId: string; shareToken: string }): Promise<void> {
  await db.update(groups).set({ shareEnabled: true }).where(eq(groups.id, input.groupId));
  await db.update(issues).set({ shareToken: input.shareToken }).where(eq(issues.id, input.issueId));
}

/**
 * A handful of bare MPEG frames (128 kbps, 44.1 kHz). Each frame header is
 * valid, so a browser can read a real duration off the file — 26 ms per frame.
 */
export function makeMp3(frames = 40): Buffer {
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** A valid-enough PNG: real magic bytes, tiny body. */
export function makePng(size = 64): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(size - header.length, 0);
  return Buffer.concat([header, body]);
}

/** Bytes the storage layer accepts: an EBML header with silence after it. */
export function makeWebm(size = 2_000): Buffer {
  const buffer = Buffer.alloc(size, 0);
  buffer[0] = 0x1a;
  buffer[1] = 0x45;
  buffer[2] = 0xdf;
  buffer[3] = 0xa3;
  return buffer;
}
