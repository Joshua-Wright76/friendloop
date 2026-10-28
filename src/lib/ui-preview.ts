import { cookies } from "next/headers";
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
import { hashToken, safeEqual } from "./tokens";

const PREVIEW_COOKIE = "fl_preview";
const PREVIEW_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Local development is open; anything deployed needs the shared key. */
export function isLocalUiPreview(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL_ENV;
}

export function previewSecret(): string | null {
  return process.env.UI_PREVIEW_SECRET?.trim() || null;
}

export function previewCookieName(): string {
  return PREVIEW_COOKIE;
}

/** The value the cookie carries: the hashed secret, never the secret itself. */
export function previewCookieValue(): string | null {
  const secret = previewSecret();
  return secret ? hashToken(secret) : null;
}

export function previewKeyMatches(key: string | null | undefined): boolean {
  const secret = previewSecret();
  return Boolean(key && secret && safeEqual(hashToken(key), hashToken(secret)));
}

export function previewCookieMatches(value: string | undefined): boolean {
  const expected = previewCookieValue();
  return Boolean(value && expected && safeEqual(value, expected));
}

/**
 * The one door into /dev: local development walks in, everywhere else needs
 * `?key=<UI_PREVIEW_SECRET>` once and then a cookie scoped to /dev.
 * Returns false when the request may not use the preview at all.
 */
export async function grantUiPreviewAccess(key: string | null): Promise<boolean> {
  if (isLocalUiPreview()) return true;
  const expected = previewCookieValue();
  if (!expected) return false;
  const jar = await cookies();
  const existing = jar.get(PREVIEW_COOKIE)?.value;
  const keyMatches = previewKeyMatches(key);
  const cookieMatches = previewCookieMatches(existing);
  if (!keyMatches && !cookieMatches) return false;

  if (!cookieMatches) {
    jar.set(PREVIEW_COOKIE, expected, {
      httpOnly: true,
      sameSite: "lax",
      // Fail closed over plain HTTP: a self-hosted deployment without TLS keeps
      // /dev locked instead of leaking the cookie across the network.
      secure: process.env.NODE_ENV === "production",
      path: "/dev",
      maxAge: PREVIEW_COOKIE_MAX_AGE,
    });
  }
  return true;
}

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

export async function requireUiPreview() {
  if (isLocalUiPreview()) return;
  const jar = await cookies();
  if (!previewCookieMatches(jar.get(PREVIEW_COOKIE)?.value)) notFound();
}

export async function enableUiPreview(reset = false) {
  await requireUiPreview();
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
