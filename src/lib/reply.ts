import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, replies, users } from "@/db/schema";
import { getNow } from "./clock";
import { copy } from "./copy.ts";
import { cleanDisplayName } from "./names";
import { deleteStoredPhoto } from "./photo-storage";
import { deleteStoredAudio } from "./media-storage.ts";
import { sectionReplies } from "@/db/schema";
import { replyHasContentCondition } from "./reply-query";
import { storedReminderPreference } from "./reminders.ts";
import { checkPollChoices } from "./poll";
import { log } from "./log";

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

  // A running loop always has a round open, so this is it. A delivered round only
  // shows up here for a loop from before rounds ran back to back.
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), inArray(issues.status, ["open", "delivered"])))
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
 * A written answer (text, photo, voice) and a poll pick are different shapes of
 * the same row; each write path names the kind it accepts so a poll can never
 * grow a photo and a written question can never hold a pick.
 */
async function ensureWritableQuestion(
  token: string,
  issueQuestionId: string,
  kind: "written" | "poll" = "written",
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
  if (!question || question.kind !== kind) {
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

/** Delete a stored photo only after no reply row points at it. */
export async function deletePhotoIfUnreferenced(photoUrl: string): Promise<void> {
  const [reference] = await db
    .select({ issueQuestionId: replies.issueQuestionId })
    .from(replies)
    .where(eq(replies.photoUrl, photoUrl))
    .limit(1);
  if (!reference) await deleteStoredPhoto(photoUrl);
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
  const afterDelivery = context.issue.status === "delivered" || at > context.issue.deliversAt;
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
        status: "draft",
        addedAfterDelivery: afterDelivery,
      })
      .onConflictDoUpdate({
        target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
        set: { photoUrl: input.photoUrl, updatedAt: at, addedAfterDelivery: afterDelivery },
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

/** Remove a photo while leaving the text and submission state alone. */
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

/** Autosave one answer. Creates the row, or updates it in place. */
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
  const afterDelivery = context.issue.status === "delivered" || at > context.issue.deliversAt;
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
      status: "draft",
      addedAfterDelivery: afterDelivery,
    })
    .onConflictDoUpdate({
      target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
      set: { body, updatedAt: at, addedAfterDelivery: afterDelivery },
    });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * Save which options this person picked on a poll. Like text, the pick is a
 * draft until they send the round, and it can change as often as they like; an
 * empty pick clears it. Nothing here ever reports a tally back.
 */
export async function savePollChoicesFor(input: {
  token: string;
  issueQuestionId: string;
  choices: unknown;
}): Promise<PollWriteResult> {
  const gate = await ensureWritableQuestion(input.token, input.issueQuestionId, "poll");
  if (!gate.ok) return gate.result;

  const { context, question } = gate;
  const choices = checkPollChoices(input.choices, question.pollOptions?.length ?? 0, question.pollMultiple);
  if (!choices) return { ok: false, status: 400, error: copy.polls.errors.choices };

  const at = await getNow();
  const afterDelivery = context.issue.status === "delivered" || at > context.issue.deliversAt;

  await db
    .insert(replies)
    .values({
      issueId: context.issue.id,
      issueQuestionId: question.id,
      membershipId: context.membership.id,
      body: "",
      pollChoices: choices,
      status: "draft",
      addedAfterDelivery: afterDelivery,
    })
    .onConflictDoUpdate({
      target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
      set: { pollChoices: choices, updatedAt: at, addedAfterDelivery: afterDelivery },
    });

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/** One commitment point: every non-empty answer in the round becomes submitted. */
export async function submitFor(token: string): Promise<WriteResult> {
  const gate = await ensureWritable(token);
  if (!gate.ok) return gate.result;

  const { context } = gate;
  if (!context.issue) return { ok: false, status: 409, error: copy.reply.errors.nothingOpen };

  const at = await getNow();
  // Three rows of different tables, none reading another: one round trip, not three.
  await Promise.all([
    db
      .update(replies)
      .set({ status: "submitted", submittedAt: at, updatedAt: at })
      .where(
        and(
          eq(replies.issueId, context.issue.id),
          eq(replies.membershipId, context.membership.id),
          replyHasContentCondition(),
        ),
      ),
    // Section answers ride the same submission as the questions.
    db
      .update(sectionReplies)
      .set({
        status: "submitted",
        submittedAt: at,
        addedAfterDelivery: context.issue.status === "delivered" || at > context.issue.deliversAt,
        updatedAt: at,
      })
      .where(
        and(
          eq(sectionReplies.issueId, context.issue.id),
          eq(sectionReplies.membershipId, context.membership.id),
        ),
      ),
    markAccepted(context.membership.id, context.membership.acceptedAt, at),
  ]);
  return { ok: true, savedAt: at.toISOString() };
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

/** The sheet's payload: questions with this person's answers, in order. */
export async function sheetFor(token: string) {
  const context = await resolveToken(token);
  if (context.state !== "ok" || !context.issue) return null;

  const questions = await db
    .select()
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, context.issue.id))
    .orderBy(asc(issueQuestions.position));

  const existing = await db
    .select()
    .from(replies)
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.membershipId, context.membership.id),
      ),
    );

  return {
    context,
    questions: questions.map((question) => {
      const reply = existing.find((candidate) => candidate.issueQuestionId === question.id);
      return {
        id: question.id,
        text: question.text,
        body: reply?.body ?? "",
        photoUrl: reply?.photoUrl ?? null,
        audioUrl: reply?.audioUrl ?? null,
        audioDurationMs: reply?.audioDurationMs ?? null,
        kind: question.kind,
        pollMultiple: question.pollMultiple,
        pollOptions: question.pollOptions ?? [],
        pollChoices: reply?.pollChoices ?? [],
        submitted: reply?.status === "submitted",
      };
    }),
  };
}

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
  const afterDelivery = context.issue.status === "delivered" || at > context.issue.deliversAt;
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
        status: "draft",
        addedAfterDelivery: afterDelivery,
      })
      .onConflictDoUpdate({
        target: [replies.issueId, replies.issueQuestionId, replies.membershipId],
        set: {
          audioUrl: input.audioUrl,
          audioDurationMs: input.audioDurationMs,
          updatedAt: at,
          addedAfterDelivery: afterDelivery,
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

/** Remove a voice note while leaving the text, photo, and submission state alone. */
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
