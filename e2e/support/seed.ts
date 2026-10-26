import { db } from "@/db";
import { groups, issues, memberships, questions, users, replies, issueQuestions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { newToken } from "@/lib/tokens";
import { deliveryInstant } from "@/lib/schedule";
import type { QuestionKind } from "@/lib/issue-experience";

/**
 * Fixtures built with plain inserts rather than the UI: a test that drives the
 * whole app through the UI spends its budget on setup it does not assert on.
 * Flows that *are* about creating things (B1, C1) use the UI instead.
 */
export type SeedLoopInput = {
  name?: string;
  mode?: "group" | "from_you";
  timezone?: string;
  promptWeekday?: number;
  promptHour?: number;
  cadenceWeeks?: number;
  createdAt?: Date;
  owner?: { email?: string; name?: string } | null;
  members?: Array<{
    email: string;
    name?: string;
    participation?: "contributor" | "reader";
    access?: "owner" | "admin" | "member";
  }>;
  questions?: string[];
  questionKinds?: QuestionKind[];
};

export type SeededLoop = {
  groupId: string;
  ownerToken: string;
  members: Array<{ id: string; email: string; token: string; participation: string; access: string }>;
  questionIds: string[];
};

export async function seedLoop(input: SeedLoopInput = {}): Promise<SeededLoop> {
  const name = input.name ?? "Friday Loop";
  const [group] = await db
    .insert(groups)
    .values({
      name,
      displayName: name,
      mode: input.mode ?? "group",
      timezone: input.timezone ?? "Europe/Amsterdam",
      promptWeekday: input.promptWeekday ?? 5,
      promptHour: input.promptHour ?? 9,
      cadenceWeeks: input.cadenceWeeks ?? 1,
      createdAt: input.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    })
    .returning();

  type MemberInput = {
    email: string;
    name?: string;
    access?: "owner" | "admin" | "member";
    participation?: "contributor" | "reader";
  };

  const memberInputs: MemberInput[] = [];
  if (input.owner !== null) {
    const owner = input.owner ?? { email: "owner@friendloop.test", name: "Sam" };
    memberInputs.push({
      email: owner.email ?? "owner@friendloop.test",
      name: owner.name ?? "Sam",
      access: "owner",
      participation: "contributor",
    });
  }
  memberInputs.push(
    ...(input.members ?? [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "bob@friendloop.test", name: "Bob" },
    ]),
  );

  const created: SeededLoop["members"] = [];
  for (const member of memberInputs) {
    const token = newToken();
    const [row] = await db
      .insert(memberships)
      .values({
        groupId: group.id,
        email: member.email,
        name: member.name ?? null,
        access: member.access ?? "member",
        participation: member.participation ?? "contributor",
        replyToken: token,
        acceptedAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    created.push({
      id: row.id,
      email: row.email,
      token,
      participation: row.participation,
      access: row.access,
    });
  }

  const questionIds: string[] = [];
  const texts = input.questions ?? ["What made you laugh this week?", "What are you looking forward to?"];
  for (const [index, text] of texts.entries()) {
    const [row] = await db
      .insert(questions)
      .values({ groupId: group.id, text, kind: input.questionKinds?.[index] ?? "standard", position: index })
      .returning();
    questionIds.push(row.id);
  }

  return { groupId: group.id, ownerToken: created[0]?.token ?? "", members: created, questionIds };
}

/** Create an already-open issue, as the sweep would have. */
export async function seedOpenIssue(
  loop: SeededLoop,
  input: { openedAt: Date; windowDays?: number; timezone?: string },
): Promise<{ issueId: string; number: number; deliversAt: Date }> {
  const [group] = await db.select().from(groups).where(eq(groups.id, loop.groupId)).limit(1);
  const deliversAt = deliveryInstant(input.openedAt, {
    timezone: input.timezone ?? group.timezone,
    windowDays: input.windowDays ?? 7,
  });

  const [{ maxNumber }] = await db
    .select({ maxNumber: sql<number>`coalesce(max(${issues.number}), 0)::int` })
    .from(issues)
    .where(eq(issues.groupId, loop.groupId));

  const [issue] = await db
    .insert(issues)
    .values({
      groupId: loop.groupId,
      number: maxNumber + 1,
      slotAt: input.openedAt,
      opensAt: input.openedAt,
      deliversAt,
    })
    .returning();

  const texts = await db.select().from(questions).where(eq(questions.groupId, loop.groupId));
  if (texts.length > 0) {
    await db.insert(issueQuestions).values(
      texts.map((question, index) => ({
        issueId: issue.id,
        questionId: question.id,
        text: question.text,
        kind: question.kind,
        position: index,
      })),
    );
  }

  await db.update(groups).set({ lastSlotAt: input.openedAt }).where(eq(groups.id, loop.groupId));

  return { issueId: issue.id, number: issue.number, deliversAt };
}

/** Submit answers on behalf of a member, straight into the database. */
export async function seedReplies(input: {
  issueId: string;
  membershipId: string;
  answers: Array<{ text: string; body: string }>;
  submittedAt?: Date;
}): Promise<void> {
  const rows = await db
    .select()
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, input.issueId));

  for (const answer of input.answers) {
    const row = rows.find((candidate) => candidate.text === answer.text);
    if (!row) throw new Error(`No question "${answer.text}" on issue ${input.issueId}`);
    await db.insert(replies).values({
      issueId: input.issueId,
      issueQuestionId: row.id,
      membershipId: input.membershipId,
      body: answer.body,
      status: "submitted",
      submittedAt: input.submittedAt ?? new Date(),
    });
  }
}

/** Add one more person without rebuilding the loop. */
export async function addMember(
  loop: SeededLoop,
  input: {
    email: string;
    name?: string;
    access?: "owner" | "admin" | "member";
    participation?: "contributor" | "reader";
    invitedDaysAgo?: number;
    accepted?: boolean;
  },
) {
  const token = newToken();
  const now = Date.now();
  const invitedAt = new Date(now - (input.invitedDaysAgo ?? 0) * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(memberships)
    .values({
      groupId: loop.groupId,
      email: input.email,
      name: input.name ?? null,
      access: input.access ?? "member",
      participation: input.participation ?? "contributor",
      replyToken: token,
      invitedAt,
      acceptedAt: input.accepted === false ? null : invitedAt,
    })
    .returning();
  return { id: row.id, email: row.email, token };
}

/** A round that already went out, with answers attached. */
export async function seedDeliveredIssue(
  loop: SeededLoop,
  input: {
    deliveredAt: Date;
    answers: Array<{ email: string; body: string; questionIndex?: number }>;
    shareToken?: string | null;
  },
): Promise<{ issueId: string; number: number }> {
  const [{ maxNumber }] = await db
    .select({ maxNumber: sql<number>`coalesce(max(${issues.number}), 0)::int` })
    .from(issues)
    .where(eq(issues.groupId, loop.groupId));

  const [issue] = await db
    .insert(issues)
    .values({
      groupId: loop.groupId,
      number: maxNumber + 1,
      slotAt: new Date(input.deliveredAt.getTime() - 7 * 24 * 60 * 60 * 1000),
      opensAt: new Date(input.deliveredAt.getTime() - 7 * 24 * 60 * 60 * 1000),
      deliversAt: input.deliveredAt,
      status: "delivered",
      deliveredAt: input.deliveredAt,
      shareToken: input.shareToken ?? null,
    })
    .returning();

  const texts = await db.select().from(questions).where(eq(questions.groupId, loop.groupId));
  if (texts.length > 0) {
    await db.insert(issueQuestions).values(
      texts.map((question, index) => ({
        issueId: issue.id,
        questionId: question.id,
        text: question.text,
        kind: question.kind,
        position: index,
      })),
    );
  }

  const rows = await db.select().from(issueQuestions).where(eq(issueQuestions.issueId, issue.id));
  for (const answer of input.answers) {
    const membership = loop.members.find((member) => member.email === answer.email);
    if (!membership) throw new Error(`No member ${answer.email}`);
    const row = rows[answer.questionIndex ?? 0];
    if (!row) throw new Error("No question at that index");
    await db.insert(replies).values({
      issueId: issue.id,
      issueQuestionId: row.id,
      membershipId: membership.id,
      body: answer.body,
      status: "submitted",
      submittedAt: input.deliveredAt,
    });
  }

  return { issueId: issue.id, number: issue.number };
}

export async function findUser(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function findIssue(groupId: string, number: number) {
  const [row] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.number, number)))
    .limit(1);
  return row ?? null;
}
