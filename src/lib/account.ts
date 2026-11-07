/**
 * Things done to a whole account: moving it to a new address, and blocking it.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailChanges, groups, magicLinks, memberships, outbox, sessions, users } from "@/db/schema";
import { getNow } from "./clock";
import { emailChangedEmail, emailChangeEmail } from "./email/templates";
import { sendEmail } from "./email/send";
import { normalizeEmail } from "./manage";
import { consume, LIMITS, limitKey } from "./rate-limit";
import { hashToken, newToken } from "./tokens";
import { url } from "./urls";

const CHANGE_LINK_MINUTES = 60;

export type EmailChangeRequest = "sent" | "invalid" | "same" | "busy";

/**
 * Send the link to the new address. It says "sent" whether or not that address
 * already has an account, so this can't be used to find out who does; that only
 * comes up for the person holding the new inbox, when they use the link.
 */
export async function requestEmailChange(
  user: { id: string; email: string },
  rawEmail: string,
): Promise<EmailChangeRequest> {
  const newEmail = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return "invalid";
  if (newEmail === user.email) return "same";

  const at = await getNow();
  if (!(await consume(limitKey.emailChange(user.id), LIMITS.emailChange, at)).allowed) return "busy";

  const token = newToken();
  const tokenHash = hashToken(token);
  await db.insert(emailChanges).values({
    userId: user.id,
    oldEmail: user.email,
    newEmail,
    tokenHash,
    expiresAt: new Date(at.getTime() + CHANGE_LINK_MINUTES * 60 * 1000),
  });
  await sendEmail({
    ...emailChangeEmail(url(`/you/email/confirm?token=${encodeURIComponent(token)}`)),
    to: newEmail,
    kind: "email_change",
    dedupeKey: `email-change:${tokenHash}`,
  });
  return "sent";
}

export type EmailChangePeek =
  | { state: "valid"; newEmail: string }
  | { state: "expired" | "used" | "unknown" };

/** Read the link without burning it: mail scanners fetch GETs. */
export async function peekEmailChange(token: string): Promise<EmailChangePeek> {
  const [link] = await db.select().from(emailChanges).where(eq(emailChanges.tokenHash, hashToken(token))).limit(1);
  if (!link) return { state: "unknown" };
  if (link.usedAt) return { state: "used" };
  if (link.expiresAt.getTime() <= (await getNow()).getTime()) return { state: "expired" };
  return { state: "valid", newEmail: link.newEmail };
}

export type EmailChangeResult = "changed" | "expired" | "used" | "unknown" | "taken";

class Taken extends Error {}

/**
 * Move the account, every loop it is in, and any mail still waiting to go. Whoever
 * holds the new inbox proved it by getting here, so a pending invitation to that
 * address joins the account too, the same way it would at sign-in.
 */
export async function confirmEmailChange(token: string): Promise<EmailChangeResult> {
  const at = await getNow();
  const [link] = await db.select().from(emailChanges).where(eq(emailChanges.tokenHash, hashToken(token))).limit(1);
  if (!link) return "unknown";
  if (!link.usedAt && link.expiresAt.getTime() <= at.getTime()) return "expired";

  const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
  if (!user || user.blockedAt) return "unknown";
  const oldEmail = user.email;
  const newEmail = link.newEmail;

  try {
    const claimed = await db.transaction(async (tx) => {
      const won = await tx
        .update(emailChanges)
        .set({ usedAt: at })
        .where(and(eq(emailChanges.id, link.id), isNull(emailChanges.usedAt)))
        .returning({ id: emailChanges.id });
      if (won.length === 0) return false;

      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1);
      if (owner) throw new Taken();

      const mine = await tx
        .select({ id: memberships.id, groupId: memberships.groupId })
        .from(memberships)
        .where(or(eq(memberships.userId, user.id), eq(memberships.email, oldEmail)));
      const groupIds = mine.map((row) => row.groupId);
      if (groupIds.length > 0) {
        const clash = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(inArray(memberships.groupId, groupIds), eq(memberships.email, newEmail)))
          .limit(1);
        if (clash.length > 0) throw new Taken();
      }

      await tx.update(users).set({ email: newEmail }).where(eq(users.id, user.id));
      await tx
        .update(memberships)
        .set({ email: newEmail, userId: user.id })
        .where(or(eq(memberships.userId, user.id), eq(memberships.email, oldEmail)));
      await tx
        .update(memberships)
        .set({ userId: user.id, acceptedAt: sql`coalesce(${memberships.acceptedAt}, ${at.toISOString()})` })
        .where(and(eq(memberships.email, newEmail), isNull(memberships.userId)));
      // Past mail moves too, so "delete my data" still finds all of it.
      await tx.update(outbox).set({ to: newEmail }).where(eq(outbox.to, oldEmail));
      await tx.delete(magicLinks).where(eq(magicLinks.email, oldEmail));
      return true;
    });
    if (!claimed) return "used";
  } catch (error) {
    if (error instanceof Taken) {
      await db.update(emailChanges).set({ usedAt: at }).where(eq(emailChanges.id, link.id));
      return "taken";
    }
    throw error;
  }

  await sendEmail({
    ...emailChangedEmail({ newEmail }),
    to: oldEmail,
    kind: "email_change",
    dedupeKey: `email-changed:${link.tokenHash}`,
  });
  return "changed";
}

export type BlockResult = { found: boolean; paused: number };

/**
 * Stop an account: no more sign-in, its sessions end, the loops it owns pause,
 * and those loops' unsent mail is dropped. Nothing is deleted, so a mistake is
 * undone by unblocking. A loop stays paused until its owner resumes it.
 */
export async function setAccountBlocked(rawEmail: string, blocked: boolean, at: Date): Promise<BlockResult> {
  const email = normalizeEmail(rawEmail);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { found: false, paused: 0 };

  if (!blocked) {
    await db.update(users).set({ blockedAt: null }).where(eq(users.id, user.id));
    return { found: true, paused: 0 };
  }

  return db.transaction(async (tx) => {
    await tx.update(users).set({ blockedAt: at }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));

    const owned = await tx
      .select({ groupId: memberships.groupId })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.access, "owner"), isNull(memberships.revokedAt)));
    const groupIds = owned.map((row) => row.groupId);
    if (groupIds.length === 0) return { found: true, paused: 0 };

    const paused = await tx
      .update(groups)
      .set({ pausedAt: at })
      .where(and(inArray(groups.id, groupIds), isNull(groups.pausedAt)))
      .returning({ id: groups.id });
    await tx
      .update(outbox)
      .set({ status: "suppressed", suppressedReason: "blocked" })
      .where(and(inArray(outbox.groupId, groupIds), inArray(outbox.status, ["pending", "failed"])));
    return { found: true, paused: paused.length };
  });
}
