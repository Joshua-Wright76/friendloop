import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, replies } from "@/db/schema";
import { getNow } from "./clock";

/** How long an unopened invitation stays good. */
export const INVITE_DAYS = 14;

export type TokenContext =
  | { state: "invalid" }
  | { state: "expired"; groupName: string }
  | { state: "reader"; groupName: string; groupId: string }
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
  const at = await getNow();

  const [row] = await db
    .select({ membership: memberships, group: groups })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);

  if (!row) return { state: "invalid" };

  const { membership, group } = row;

  const pendingTooLong =
    !membership.acceptedAt &&
    membership.invitedAt.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000 <= at.getTime();
  if (pendingTooLong) return { state: "expired", groupName: group.name };

  if (membership.participation === "reader") {
    return { state: "reader", groupName: group.name, groupId: group.id };
  }

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

type Gate = { ok: true; context: Extract<TokenContext, { state: "ok" }> } | { ok: false; result: WriteResult };

async function ensureWritable(token: string): Promise<Gate> {
  const context = await resolveToken(token);

  if (context.state === "invalid") {
    return { ok: false, result: { ok: false, status: 404, error: "This link no longer works." } };
  }
  if (context.state === "expired") {
    return {
      ok: false,
      result: { ok: false, status: 403, error: "This invitation has expired — ask for a new link." },
    };
  }
  if (context.state === "reader") {
    return { ok: false, result: { ok: false, status: 403, error: "Readers don't answer questions." } };
  }
  return { ok: true, context };
}

/** Autosave one answer. Creates the row, or updates it in place. */
export async function saveDraftFor(input: {
  token: string;
  issueQuestionId: string;
  body: string;
}): Promise<WriteResult> {
  const gate = await ensureWritable(input.token);
  if (!gate.ok) return gate.result;

  const { context } = gate;
  if (!context.issue) return { ok: false, status: 409, error: "Nothing is open right now." };

  const [question] = await db
    .select()
    .from(issueQuestions)
    .where(
      and(eq(issueQuestions.id, input.issueQuestionId), eq(issueQuestions.issueId, context.issue.id)),
    )
    .limit(1);
  if (!question) return { ok: false, status: 409, error: "That question isn't in this round." };

  const at = await getNow();
  const afterDelivery = context.issue.status === "delivered" || at > context.issue.deliversAt;
  const body = input.body.slice(0, 8000);

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

/** One commitment point: every non-empty answer in the round becomes submitted. */
export async function submitFor(token: string): Promise<WriteResult> {
  const gate = await ensureWritable(token);
  if (!gate.ok) return gate.result;

  const { context } = gate;
  if (!context.issue) return { ok: false, status: 409, error: "Nothing is open right now." };

  const at = await getNow();
  await db
    .update(replies)
    .set({ status: "submitted", submittedAt: at, updatedAt: at })
    .where(
      and(
        eq(replies.issueId, context.issue.id),
        eq(replies.membershipId, context.membership.id),
        sql`${replies.body} <> ''`,
      ),
    );

  await markAccepted(context.membership.id, context.membership.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

async function markAccepted(membershipId: string, acceptedAt: Date | null, at: Date) {
  if (acceptedAt) return;
  await db.update(memberships).set({ acceptedAt: at }).where(eq(memberships.id, membershipId));
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
        submitted: reply?.status === "submitted",
      };
    }),
  };
}
