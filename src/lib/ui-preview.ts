import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  comments,
  groups,
  issueQuestions,
  issues,
  magicLinks,
  memberships,
  questions,
  replies,
  sessions,
  users,
} from "@/db/schema";
import { createSession } from "./auth";
import { hashToken } from "./tokens";

export const UI_PREVIEW = {
  groupId: "22222222-2222-4222-8222-222222222222",
  userId: "22222222-2222-4222-8222-222222222223",
  ownerMembershipId: "22222222-2222-4222-8222-222222222224",
  aliceMembershipId: "22222222-2222-4222-8222-222222222225",
  openIssueId: "22222222-2222-4222-8222-222222222230",
  deliveredIssueId: "22222222-2222-4222-8222-222222222231",
  ownerToken: "ui-preview-owner-token",
  aliceToken: "ui-preview-alice-token",
  shareToken: "ui-preview-share-token",
  magicToken: "ui-preview-magic-token",
} as const;

const QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222240",
  "22222222-2222-4222-8222-222222222241",
  "22222222-2222-4222-8222-222222222242",
  "22222222-2222-4222-8222-222222222243",
];
const OPEN_QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222250",
  "22222222-2222-4222-8222-222222222251",
  "22222222-2222-4222-8222-222222222252",
  "22222222-2222-4222-8222-222222222253",
];
const DELIVERED_QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222260",
  "22222222-2222-4222-8222-222222222261",
  "22222222-2222-4222-8222-222222222262",
  "22222222-2222-4222-8222-222222222263",
];
const QUESTION_TEXT = [
  "What made you laugh this week?",
  "What are you looking forward to?",
  "What's something small you're proud of?",
  "What did you eat that was worth remembering?",
];
const OWNER_ANSWERS = [
  "A group of geese has decided my bus stop belongs to them. They have a schedule now. I respect it.",
  "Three hours in a bookshop and I regret nothing.",
  "I finally finished the shelf I started in March.",
  "The little lemon cake from the corner café.",
];
const ALICE_ANSWERS = [
  "My dad sent a four-minute voice memo of himself trying to find the record button.",
  "Seeing everyone this weekend.",
  "I kept a plant alive for a whole month.",
  "Homemade dumplings on a rainy evening.",
];

export function requireUiPreview() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL_ENV) notFound();
}

export async function enableUiPreview(reset = false) {
  requireUiPreview();
  const now = new Date();

  await db.transaction(async (tx) => {
    if (reset) {
      await tx.delete(groups).where(eq(groups.id, UI_PREVIEW.groupId));
      await tx.delete(users).where(eq(users.id, UI_PREVIEW.userId));
    }

    await tx.insert(users).values({
      id: UI_PREVIEW.userId,
      email: "ui-preview@friendloop.local",
      name: "Alex",
      timezone: "Europe/Amsterdam",
      isSynthetic: true,
    }).onConflictDoNothing();

    await tx.insert(groups).values({
      id: UI_PREVIEW.groupId,
      name: "Saturday Club",
      displayName: "Saturday Club",
      mode: "group",
      timezone: "Europe/Amsterdam",
      promptWeekday: 5,
      promptHour: 9,
      cadenceWeeks: 1,
      windowDays: 7,
      shareEnabled: true,
      isSynthetic: true,
      createdAt: new Date(now.getTime() - 30 * 86400000),
    }).onConflictDoNothing();

    await tx.insert(memberships).values([
      {
        id: UI_PREVIEW.ownerMembershipId,
        groupId: UI_PREVIEW.groupId,
        userId: UI_PREVIEW.userId,
        email: "ui-preview@friendloop.local",
        name: "Alex",
        access: "owner",
        participation: "contributor",
        replyToken: UI_PREVIEW.ownerToken,
        acceptedAt: now,
      },
      {
        id: UI_PREVIEW.aliceMembershipId,
        groupId: UI_PREVIEW.groupId,
        email: "alice@friendloop.local",
        name: "Alice",
        access: "member",
        participation: "contributor",
        replyToken: UI_PREVIEW.aliceToken,
        acceptedAt: now,
      },
    ]).onConflictDoNothing();

    await tx.insert(questions).values(QUESTION_TEXT.map((text, index) => ({
      id: QUESTION_IDS[index],
      groupId: UI_PREVIEW.groupId,
      text,
      position: index,
    }))).onConflictDoNothing();

    await tx.insert(issues).values([
      {
        id: UI_PREVIEW.openIssueId,
        groupId: UI_PREVIEW.groupId,
        number: 12,
        status: "open",
        slotAt: now,
        opensAt: now,
        deliversAt: new Date(now.getTime() + 7 * 86400000),
      },
      {
        id: UI_PREVIEW.deliveredIssueId,
        groupId: UI_PREVIEW.groupId,
        number: 11,
        status: "delivered",
        slotAt: new Date(now.getTime() - 8 * 86400000),
        opensAt: new Date(now.getTime() - 8 * 86400000),
        deliversAt: new Date(now.getTime() - 86400000),
        deliveredAt: new Date(now.getTime() - 86400000),
        shareToken: UI_PREVIEW.shareToken,
      },
    ]).onConflictDoNothing();

    await tx.insert(issueQuestions).values(QUESTION_TEXT.flatMap((text, index) => [
      { id: OPEN_QUESTION_IDS[index], issueId: UI_PREVIEW.openIssueId, questionId: QUESTION_IDS[index], text, position: index },
      { id: DELIVERED_QUESTION_IDS[index], issueId: UI_PREVIEW.deliveredIssueId, questionId: QUESTION_IDS[index], text, position: index },
    ])).onConflictDoNothing();

    const replyRows: Array<typeof replies.$inferInsert> = QUESTION_TEXT.flatMap((_, index) => [
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueQuestionId: DELIVERED_QUESTION_IDS[index],
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: OWNER_ANSWERS[index],
        status: "submitted" as const,
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueQuestionId: DELIVERED_QUESTION_IDS[index],
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: ALICE_ANSWERS[index],
        status: "submitted" as const,
        submittedAt: new Date(now.getTime() - 86400000),
      },
    ]);
    replyRows.push({
      issueId: UI_PREVIEW.openIssueId,
      issueQuestionId: OPEN_QUESTION_IDS[0],
      membershipId: UI_PREVIEW.ownerMembershipId,
      body: "The cat accepted a fist bump but refused a high five.",
      status: "submitted",
      submittedAt: now,
    });
    await tx.insert(replies).values(replyRows).onConflictDoNothing();

    await tx.insert(comments).values({
      id: "22222222-2222-4222-8222-222222222270",
      issueId: UI_PREVIEW.deliveredIssueId,
      membershipId: UI_PREVIEW.aliceMembershipId,
      body: "This made my morning.",
    }).onConflictDoNothing();

    await tx.insert(magicLinks).values({
      id: "22222222-2222-4222-8222-222222222271",
      email: "ui-preview@friendloop.local",
      tokenHash: hashToken(UI_PREVIEW.magicToken),
      expiresAt: new Date(now.getTime() + 15 * 60000),
      usedAt: null,
    }).onConflictDoUpdate({
      target: magicLinks.id,
      set: { expiresAt: new Date(now.getTime() + 15 * 60000), usedAt: null },
    });

    await tx.delete(sessions).where(eq(sessions.userId, UI_PREVIEW.userId));
  });

  await createSession(UI_PREVIEW.userId, now);
}
