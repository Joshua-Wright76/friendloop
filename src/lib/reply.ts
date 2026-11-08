import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, replies, replyMedia, users } from "@/db/schema";
import { getNow } from "./clock";
import { copy } from "./copy.ts";
import { cleanDisplayName } from "./names";
import { deleteStoredPhoto, storePhoto } from "./photo-storage";
import { deleteStoredAudio } from "./media-storage.ts";
import { isMediaReferenced } from "./media-cleanup.ts";
import { storedReminderPreference } from "./reminders.ts";
import { checkPollChoices } from "./poll";
import { log } from "./log";
import { askedOf, formatOf, type AnswerFormat } from "./asks";
import { checkMusicLink, MUSIC_CAPTION_MAX, PHOTO_WALL_MAX } from "./music";
import { validatePhoto } from "./photo-validation";

export type TokenContext =
  | { state: "invalid" }
  | {
      state: "reader";
      groupName: string;
      groupId: string;
      membership: typeof memberships.$inferSelect;
      group: typeof groups.$inferSelect;
    }
  | {
      state: "ok";
      membership: typeof memberships.$inferSelect;
      group: typeof groups.$inferSelect;
      issue: typeof issues.$inferSelect | null;
    };

/**
 * Resolve a reply token to everything the sheet needs. Read-only: nothing here
 * writes, because a GET must never mutate (mail scanners fetch every link).
 */
export async function resolveToken(token: string): Promise<TokenContext> {
  const [row] = await db
    .select({ membership: memberships, group: groups })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);

  if (!row) return { state: "invalid" };

  // A link works for as long as the person is in the loop: there is no invitation
  // to accept or let lapse, only a membership, which ends when they are removed.
  const { membership, group } = row;

  if (membership.participation === "reader") {
    return { state: "reader", groupName: group.name, groupId: group.id, membership, group };
  }

  // A paused loop takes no answers: its open round waits for the resume.
  if (group.pausedAt) return { state: "ok", membership, group, issue: null };

  // A running loop always has a round open, and a reply link only ever reaches
  // it: a round that has gone out takes nothing more.
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .orderBy(desc(issues.number))
    .limit(1);

  return { state: "ok", membership, group, issue: issue ?? null };
}

export type WriteResult =
  | { ok: true; savedAt: string }
  | { ok: false; status: 403 | 404 | 409; error: string };

export type PollWriteResult = WriteResult | { ok: false; status: 400; error: string };

export type PhotoWriteResult =
  | { ok: true; savedAt: string; photoUrl: string }
  | { ok: false; status: 403 | 404 | 409; error: string };

type Gate =
  | { ok: true; context: Extract<TokenContext, { state: "ok" }> }
  | { ok: false; result: Extract<WriteResult, { ok: false }> };

async function ensureWritable(token: string): Promise<Gate> {
  const context = await resolveToken(token);

  if (context.state === "invalid") {
    return { ok: false, result: { ok: false, status: 404, error: copy.reply.errors.invalidLink } };
  }
  if (context.state === "reader") {
    return { ok: false, result: { ok: false, status: 403, error: copy.reply.errors.reader } };
  }
  return { ok: true, context };
}

type WritableContext = Omit<Extract<TokenContext, { state: "ok" }>, "issue"> & {
  issue: NonNullable<Extract<TokenContext, { state: "ok" }>['issue']>;
};

type WritableQuestion =
  | { ok: true; context: WritableContext; question: typeof issueQuestions.$inferSelect }
  | { ok: false; result: Extract<WriteResult, { ok: false }> };

/**
 * Each answer format is a different shape of the same row; every write path
 * names the formats it accepts, so a poll can never grow a photo, a written
 * answer can never hold a pick and a music pick never takes a voice note. An
 * owners-only item refuses plain members, and a birthday card its own subject.
 */
async function ensureWritableQuestion(
  token: string,
  issueQuestionId: string,
  formats: AnswerFormat[] = ["written"],
): Promise<WritableQuestion> {
  const gate = await ensureWritable(token);
  if (!gate.ok) return gate;

  const { context } = gate;
  if (!context.issue) {
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.nothingOpen } };
  }

  const [question] = await db
    .select()
    .from(issueQuestions)
    .where(and(eq(issueQuestions.id, issueQuestionId), eq(issueQuestions.issueId, context.issue.id)))
    .limit(1);
  if (!question || !formats.includes(formatOf(question))) {
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.wrongQuestion } };
  }
  if (question.adminOnly && context.membership.access === "member") {
    return { ok: false, result: { ok: false, status: 403, error: copy.reply.errors.reader } };
  }
  if (!askedOf(question, context.membership)) {
    // The birthday person never sees their own card, so they can't write to it.
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.wrongQuestion } };
  }

  return { ok: true, context: { ...context, issue: context.issue }, question };
}

/** Check the bearer token and question before accepting or storing a photo. */
export async function authorizeQuestionForReply(
  token: string,
  issueQuestionId: string,
): Promise<{ ok: true } | Extract<WriteResult, { ok: false }>> {
  const gate = await ensureWritableQuestion(token, issueQuestionId);
  return gate.ok ? { ok: true } : gate.result;
}

/** Delete a stored photo only after no row points at it. */
export async function deletePhotoIfUnreferenced(photoUrl: string): Promise<void> {
  if (!(await isMediaReferenced(photoUrl))) await deleteStoredPhoto(photoUrl);
}

/** Save a photo without changing the existing text answer. */
export async function savePhotoFor(input: {
  token: string;
  issueQuestionId: string;
  photoUrl: string;
}): Promise<PhotoWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const photoOwners = await db
    .select({ issueId: replies.issueId, issueQuestionId: replies.issueQuestionId, membershipId: replies.membershipId })
    .from(replies)
    .where(eq(replies.photoUrl, input.photoUrl));
  if (photoOwners.some((owner) =>
    owner.issueId !== context.issue.id ||
    owner.issueQuestionId !== question.id ||
    owner.membershipId !== context.membership.id
  )) {
    return { ok: false, status: 409, error: copy.reply.errors.photoUploadFailed };
  }

  const at = await getNow();
  const [existing] = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ photoUrl: replies.photoUrl })
      .from(replies)
      .where(
        and(
          eq(replies.issueId, context.issue.id),
          eq(replies.issueQuestionId, question.id),
          eq(replies.membershipId, context.membership.id),
        ),
      )
      .limit(1);

    await tx
      .insert(replies)
      .values({
        issueId: context.issue.id,
        issueQuestionId: question.id,
        membershipId: context.membership.id,
        body: "",
        photoUrl: input.photoUrl,
        ...inTheRound(at),
      })
      .onConflictDoUpdate({
        target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
        set: { photoUrl: input.photoUrl, updatedAt: at, ...inTheRound(at) },
      });

    if (!context.membership.acceptedAt) {
      await tx.update(memberships).set({ acceptedAt: at }).where(eq(memberships.id, context.membership.id));
    }
    return [previous] as const;
  });

  if (existing?.photoUrl && existing.photoUrl !== input.photoUrl) {
    await deletePhotoIfUnreferenced(existing.photoUrl).catch((error: unknown) => {
      log.error("Unable to remove replaced reply photo", error);
    });
  }

  return { ok: true, savedAt: at.toISOString(), photoUrl: input.photoUrl };
}

/** Remove a photo while leaving the text alone. */
export async function removePhotoFor(input: {
  token: string;
  issueQuestionId: string;
}): Promise<WriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const [existing] = await db
    .select({ photoUrl: replies.photoUrl })
    .from(replies)
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.issueQuestionId, question.id),
        eq(replies.membershipId, context.membership.id),
      ),
    )
    .limit(1);

  const at = await getNow();
  if (!existing?.photoUrl) return { ok: true, savedAt: at.toISOString() };

  await db
    .update(replies)
    .set({ photoUrl: null, updatedAt: at })
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.issueQuestionId, question.id),
        eq(replies.membershipId, context.membership.id),
        eq(replies.photoUrl, existing.photoUrl),
      ),
    );

  await deletePhotoIfUnreferenced(existing.photoUrl).catch((error: unknown) => {
    log.error("Unable to remove reply photo", error);
  });
  return { ok: true, savedAt: at.toISOString() };
}

/** Autosave one answer: once saved, it goes out with the round. Creates the row, or updates it in place. */
export async function saveDraftFor(input: {
  token: string;
  issueQuestionId: string;
  body: string;
  /** What this device last saw on the server. A background retry sends it, so newer words elsewhere aren't overwritten. */
  ifBody?: string;
}): Promise<WriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const at = await getNow();
  const body = input.body.slice(0, 8000);

  if (input.ifBody !== undefined) {
    const [existing] = await db
      .select({ body: replies.body })
      .from(replies)
      .where(and(
        eq(replies.issueId, context.issue.id),
        eq(replies.issueQuestionId, question.id),
        eq(replies.membershipId, context.membership.id),
      ))
      .limit(1);
    if ((existing?.body ?? "") !== input.ifBody && (existing?.body ?? "") !== body) {
      return { ok: false, status: 409, error: copy.reply.errors.changedElsewhere };
    }
  }

  await db
    .insert(replies)
    .values({
      issueId: context.issue.id,
      issueQuestionId: question.id,
      membershipId: context.membership.id,
      body,
      ...inTheRound(at),
    })
    .onConflictDoUpdate({
      target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
      set: { body, updatedAt: at, ...inTheRound(at) },
    });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * Save which options this person picked on a poll. Like text, the pick is in the
 * round as soon as it saves, and it can change as often as they like; an empty
 * pick clears it. Nothing here ever reports a tally back.
 */
export async function savePollChoicesFor(input: {
  token: string;
  issueQuestionId: string;
  choices: unknown;
}): Promise<PollWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId, ["poll"]);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const choices = checkPollChoices(input.choices, question.pollOptions?.length ?? 0, question.pollMultiple);
  if (!choices) return { ok: false, status: 400, error: copy.polls.errors.choices };

  const at = await getNow();

  await db
    .insert(replies)
    .values({
      issueId: context.issue.id,
      issueQuestionId: question.id,
      membershipId: context.membership.id,
      body: "",
      pollChoices: choices,
      ...inTheRound(at),
    })
    .onConflictDoUpdate({
      target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
      set: { pollChoices: choices, updatedAt: at, ...inTheRound(at) },
    });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * What a sheet loaded before answers saved themselves sends from its "Send
 * answers" button. Every saved answer is already in the round, so there is
 * nothing left to do but check the link still reaches an open round.
 */
export async function confirmFor(token: string): Promise<WriteResult> {
  const gate = await ensureWritable(token);
  if (!gate.ok) return gate.result;

  const { context } = gate;
  if (!context.issue) return { ok: false, status: 409, error: copy.reply.errors.nothingOpen };

  const at = await getNow();
  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * Columns every save writes. Nothing reads `status` any more (an answer counts
 * when it has something in it, see `reply-query.ts`), but code from before this
 * rule may still be running for a few minutes after the database changes, and
 * it only counts `submitted` rows.
 */
export function inTheRound(at: Date) {
  return { status: "submitted" as const, submittedAt: at };
}

async function markAccepted(membershipId: string, acceptedAt: Date | null, at: Date) {
  if (acceptedAt) return;
  await db.update(memberships).set({ acceptedAt: at }).where(eq(memberships.id, membershipId));
}

/**
 * A name typed on the reply sheet. The reply token already proves who this is, so
 * the same person is renamed in every loop they belong to: an email handle is a
 * fallback, not a byline.
 */
export async function saveNameFor(input: { token: string; name: string }): Promise<WriteResult> {
  const gate = await ensureWritable(input.token);
  if (!gate.ok) return gate.result;

  const { context } = gate;
  const name = cleanDisplayName(input.name);
  const at = await getNow();

  await db.transaction(async (tx) => {
    await tx.update(memberships).set({ name }).where(eq(memberships.id, context.membership.id));

    if (name) {
      if (context.membership.userId) {
        await tx.update(users).set({ name }).where(eq(users.id, context.membership.userId));
      }
      // Other loops this same person is already in, but only where nobody has
      // named them yet — this never overwrites a name someone chose elsewhere.
      await tx
        .update(memberships)
        .set({ name })
        .where(and(eq(memberships.email, context.membership.email), isNull(memberships.name)));
    }
  });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * Turn the loop's automatic reminder on or off for this contributor. Per
 * membership: a person in two loops can ask one of them to stay quiet. It only
 * touches the loop's own reminder; the owner's nudge by hand does not look at it.
 */
export async function saveReminderPreferenceFor(input: {
  token: string;
  preference: unknown;
}): Promise<PollWriteResult> {
  const gate = await ensureWritable(input.token);
  if (!gate.ok) return gate.result;
  const preference = storedReminderPreference(input.preference);
  if (!preference) {
    return { ok: false, status: 400, error: copy.reply.errors.reminderPreference };
  }

  const at = await getNow();
  await db
    .update(memberships)
    .set({ reminderPreference: preference })
    .where(eq(memberships.id, gate.context.membership.id));
  await markAccepted(gate.context.membership.id, gate.context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * The sheet's payload: one list, in round order, of everything this round asks
 * this person, each with what they have written so far. Owners-only items are
 * left out for plain members and a birthday card for the person it is about.
 */
export async function sheetFor(token: string) {
  const context = await resolveToken(token);
  if (context.state !== "ok" || !context.issue) return null;

  const [rows, existing] = await Promise.all([
    db
      .select()
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, context.issue.id))
      .orderBy(asc(issueQuestions.position), asc(issueQuestions.id)),
    db
      .select()
      .from(replies)
      .where(and(eq(replies.issueId, context.issue.id), eq(replies.membershipId, context.membership.id))),
  ]);
  const media = existing.length === 0
    ? []
    : await db
        .select()
        .from(replyMedia)
        .where(inArray(replyMedia.replyId, existing.map((reply) => reply.id)))
        .orderBy(asc(replyMedia.position), asc(replyMedia.createdAt));

  return {
    context,
    questions: rows
      .filter((question) => askedOf(question, context.membership))
      .map((question) => {
        const reply = existing.find((candidate) => candidate.issueQuestionId === question.id);
        return {
          id: question.id,
          text: question.text,
          emoji: question.emoji,
          description: question.description,
          format: formatOf(question),
          /** Copied from a section in the round open at the switch: written, but without voice notes. */
          fromSection: question.fromSection,
          body: reply?.body ?? "",
          photoUrl: reply?.photoUrl ?? null,
          audioUrl: reply?.audioUrl ?? null,
          audioDurationMs: reply?.audioDurationMs ?? null,
          kind: question.kind,
          pollMultiple: question.pollMultiple,
          pollOptions: question.pollOptions ?? [],
          pollChoices: reply?.pollChoices ?? [],
          linkUrl: reply?.linkUrl ?? "",
          linkProvider: reply?.linkProvider ?? "",
          media: media
            .filter((item) => reply && item.replyId === reply.id)
            .map((item) => ({ id: item.id, url: item.url, caption: item.caption })),
        };
      }),
  };
}

export type SheetItem = NonNullable<Awaited<ReturnType<typeof sheetFor>>>["questions"][number];

export type AudioWriteResult =
  | { ok: true; savedAt: string; audioUrl: string; audioDurationMs: number }
  | { ok: false; status: 403 | 404 | 409 | 413; error: string };

/** Delete a stored voice note only after no reply row points at it. */
export async function deleteAudioIfUnreferenced(audioUrl: string): Promise<void> {
  const [reference] = await db
    .select({ issueQuestionId: replies.issueQuestionId })
    .from(replies)
    .where(eq(replies.audioUrl, audioUrl))
    .limit(1);
  if (!reference) await deleteStoredAudio(audioUrl);
}

/** Save a voice note without changing the existing text answer. */
export async function saveAudioFor(input: {
  token: string;
  issueQuestionId: string;
  audioUrl: string;
  audioDurationMs: number;
}): Promise<AudioWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId);
  if (!gate.ok) return gate.result;
  // A card copied from a section never took voice notes, and its page has nowhere to play one.
  if (gate.question.fromSection) return { ok: false, status: 409, error: copy.reply.errors.wrongQuestion };

  const { context, question } = gate;
  const audioOwners = await db
    .select({ issueId: replies.issueId, issueQuestionId: replies.issueQuestionId, membershipId: replies.membershipId })
    .from(replies)
    .where(eq(replies.audioUrl, input.audioUrl));
  if (audioOwners.some((owner) =>
    owner.issueId !== context.issue.id ||
    owner.issueQuestionId !== question.id ||
    owner.membershipId !== context.membership.id
  )) {
    return { ok: false, status: 409, error: copy.reply.errors.audioSaveFailed };
  }

  const at = await getNow();
  const [existing] = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ audioUrl: replies.audioUrl })
      .from(replies)
      .where(
        and(
          eq(replies.issueId, context.issue.id),
          eq(replies.issueQuestionId, question.id),
          eq(replies.membershipId, context.membership.id),
        ),
      )
      .limit(1);

    await tx
      .insert(replies)
      .values({
        issueId: context.issue.id,
        issueQuestionId: question.id,
        membershipId: context.membership.id,
        body: "",
        audioUrl: input.audioUrl,
        audioDurationMs: input.audioDurationMs,
        ...inTheRound(at),
      })
      .onConflictDoUpdate({
        target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
        set: {
          audioUrl: input.audioUrl,
          audioDurationMs: input.audioDurationMs,
          updatedAt: at,
          ...inTheRound(at),
        },
      });

    if (!context.membership.acceptedAt) {
      await tx.update(memberships).set({ acceptedAt: at }).where(eq(memberships.id, context.membership.id));
    }
    return [previous] as const;
  });

  if (existing?.audioUrl && existing.audioUrl !== input.audioUrl) {
    await deleteAudioIfUnreferenced(existing.audioUrl).catch((error: unknown) => {
      log.error("Unable to remove replaced reply voice note", error);
    });
  }

  return { ok: true, savedAt: at.toISOString(), audioUrl: input.audioUrl, audioDurationMs: input.audioDurationMs };
}

/** Remove a voice note while leaving the text and photo alone. */
export async function removeAudioFor(input: {
  token: string;
  issueQuestionId: string;
}): Promise<WriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const [existing] = await db
    .select({ audioUrl: replies.audioUrl })
    .from(replies)
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.issueQuestionId, question.id),
        eq(replies.membershipId, context.membership.id),
      ),
    )
    .limit(1);

  const at = await getNow();
  if (!existing?.audioUrl) return { ok: true, savedAt: at.toISOString() };

  await db
    .update(replies)
    .set({ audioUrl: null, audioDurationMs: null, updatedAt: at })
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.issueQuestionId, question.id),
        eq(replies.membershipId, context.membership.id),
      ),
    );

  await deleteAudioIfUnreferenced(existing.audioUrl).catch((error: unknown) => {
    log.error("Unable to remove reply voice note", error);
  });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/* ------------- music picks and photo walls, and the old section writes ------------- */

async function touchReply(
  gate: Extract<WritableQuestion, { ok: true }>,
  patch: Partial<typeof replies.$inferInsert>,
  at: Date,
): Promise<string> {
  const { context, question } = gate;
  const [row] = await db
    .insert(replies)
    .values({
      issueId: context.issue.id,
      issueQuestionId: question.id,
      membershipId: context.membership.id,
      body: "",
      ...patch,
      ...inTheRound(at),
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
      set: { ...patch, ...inTheRound(at), updatedAt: at },
    })
    .returning({ id: replies.id });
  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return row.id;
}

export type MusicWriteResult = WriteResult | { ok: false; status: 400; error: string };

/** Paste a music pick, with its one-line caption. Host-and-shape validation only, no third-party call. */
export async function saveMusicFor(input: {
  token: string;
  issueQuestionId: string;
  url: string;
  caption: string;
}): Promise<MusicWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId, ["music"]);
  if (!gate.ok) return gate.result;

  const url = input.url.trim();
  const caption = input.caption.slice(0, MUSIC_CAPTION_MAX);
  const check = url ? checkMusicLink(url) : null;
  if (check && !check.ok) return { ok: false, status: 400, error: check.error };

  const at = await getNow();
  await touchReply(
    gate,
    check?.ok ? { linkUrl: url, linkProvider: check.provider, body: caption } : { linkUrl: null, linkProvider: null, body: caption },
    at,
  );
  return { ok: true, savedAt: at.toISOString() };
}

export type WallPhotoWriteResult =
  | { ok: true; savedAt: string; mediaId: string; url: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413 | 415 | 500; error: string };

function refusedPhoto(validation: Extract<ReturnType<typeof validatePhoto>, { ok: false }>): Extract<WallPhotoWriteResult, { ok: false }> {
  const tooLarge = validation.reason === "too-large";
  return {
    ok: false,
    status: tooLarge ? 413 : 415,
    error: tooLarge ? copy.reply.errors.photoTooLarge : copy.reply.errors.invalidPhoto,
  };
}

/** Add one photo to a photo wall: up to six per person, each with an optional caption. */
export async function saveWallPhotoFor(input: {
  token: string;
  issueQuestionId: string;
  bytes: Uint8Array;
  contentType?: string;
  caption: string;
  position: number;
}): Promise<WallPhotoWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId, ["photo_wall"]);
  if (!gate.ok) return gate.result;

  const validation = validatePhoto(input.bytes, input.contentType);
  if (!validation.ok) return refusedPhoto(validation);

  const { context, question } = gate;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(replyMedia)
    .innerJoin(replies, eq(replies.id, replyMedia.replyId))
    .where(and(
      eq(replies.issueId, context.issue.id),
      eq(replies.issueQuestionId, question.id),
      eq(replies.membershipId, context.membership.id),
    ));
  if (count >= PHOTO_WALL_MAX) {
    return { ok: false, status: 409, error: copy.reply.errors.sectionPhotoCap };
  }

  let url: string;
  try {
    url = await storePhoto(input.bytes, validation.format);
  } catch {
    return { ok: false, status: 500, error: copy.reply.errors.photoUploadFailed };
  }

  const at = await getNow();
  const replyId = await touchReply(gate, {}, at);
  const [media] = await db
    .insert(replyMedia)
    .values({
      replyId,
      url,
      caption: input.caption.trim().slice(0, 200) || null,
      position: Math.max(0, Math.min(PHOTO_WALL_MAX - 1, Math.round(input.position) || count)),
      createdAt: at,
    })
    .returning({ id: replyMedia.id });
  return { ok: true, savedAt: at.toISOString(), mediaId: media.id, url };
}

/** Take one photo off a photo wall. */
export async function removeWallPhotoFor(input: {
  token: string;
  issueQuestionId: string;
  mediaId: string;
}): Promise<WriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId, ["photo_wall", "written"]);
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const [media] = await db
    .select({ id: replyMedia.id, url: replyMedia.url })
    .from(replyMedia)
    .innerJoin(replies, eq(replies.id, replyMedia.replyId))
    .where(and(
      eq(replyMedia.id, input.mediaId),
      eq(replies.issueId, context.issue.id),
      eq(replies.issueQuestionId, question.id),
      eq(replies.membershipId, context.membership.id),
    ))
    .limit(1);
  if (!media) return { ok: false, status: 404, error: copy.reply.errors.sectionSaveFailed };

  const at = await getNow();
  await db.delete(replyMedia).where(eq(replyMedia.id, media.id));
  await deletePhotoIfUnreferenced(media.url).catch((error: unknown) => {
    log.error("Unable to remove photo-wall photo", error);
  });
  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/*
 * A sheet loaded before sections became questions still posts `sectionDraft`,
 * `sectionMusic` and `/section-media` with the ids it was given. Those ids are
 * now `issue_questions` ids, so each old write lands on the same answer the new
 * sheet edits. Removed with the contract release.
 */

/** `sectionDraft`: a standard section's text, now a written answer. */
export async function saveSectionTextFor(input: { token: string; issueSectionId: string; body: string }): Promise<WriteResult | { ok: false; status: 400; error: string }> {
  if (input.body.length > 2_000) return { ok: false, status: 400, error: copy.reply.errors.sectionSaveFailed };
  return saveDraftFor({ token: input.token, issueQuestionId: input.issueSectionId, body: input.body });
}

/** `sectionMusic`: a music section's pick. */
export async function saveSectionMusicFor(input: { token: string; issueSectionId: string; url: string; caption: string }): Promise<MusicWriteResult> {
  return saveMusicFor({ token: input.token, issueQuestionId: input.issueSectionId, url: input.url, caption: input.caption });
}

/** `POST /section-media`: a photo wall's photo, or a standard section's one photo (now the answer's photo). */
export async function saveSectionPhotoFor(input: {
  token: string;
  issueSectionId: string;
  bytes: Uint8Array;
  contentType?: string;
  caption: string;
  position: number;
}): Promise<WallPhotoWriteResult> {
  const wall = await saveWallPhotoFor({ ...input, issueQuestionId: input.issueSectionId });
  if (wall.ok || wall.error !== copy.reply.errors.wrongQuestion) return wall;

  const gate = await ensureWritableQuestion(input.token, input.issueSectionId, ["written"]);
  if (!gate.ok) return gate.result;
  const validation = validatePhoto(input.bytes, input.contentType);
  if (!validation.ok) return refusedPhoto(validation);
  const [existing] = await db
    .select({ photoUrl: replies.photoUrl })
    .from(replies)
    .where(and(
      eq(replies.issueId, gate.context.issue.id),
      eq(replies.issueQuestionId, gate.question.id),
      eq(replies.membershipId, gate.context.membership.id),
    ))
    .limit(1);
  if (existing?.photoUrl) return { ok: false, status: 409, error: copy.reply.errors.sectionPhotoStandardCap };

  let url: string;
  try {
    url = await storePhoto(input.bytes, validation.format);
  } catch {
    return { ok: false, status: 500, error: copy.reply.errors.photoUploadFailed };
  }
  const at = await getNow();
  // The old sheet keeps this id to take the photo off again: the answer's own.
  const replyId = await touchReply(gate, { photoUrl: url }, at);
  return { ok: true, savedAt: at.toISOString(), mediaId: replyId, url };
}

/** `DELETE /section-media`: a photo-wall photo by its id, or a standard section's photo by its answer's. */
export async function removeSectionMediaFor(input: { token: string; issueSectionId: string; mediaId: string }): Promise<WriteResult> {
  const removed = await removeWallPhotoFor({ token: input.token, issueQuestionId: input.issueSectionId, mediaId: input.mediaId });
  if (removed.ok || removed.status !== 404) return removed;
  return removePhotoFor({ token: input.token, issueQuestionId: input.issueSectionId });
}
