import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  emailChanges,
  comments,
  emailEvents,
  emailSuppressions,
  events,
  feedback,
  groups,
  issueQuestions,
  issueSections,
  magicLinks,
  memberships,
  outbox,
  questionSuggestions,
  rateLimits,
  replies,
  replyMedia,
  users,
} from "@/db/schema";
import { purgeMedia, queueMediaDeletion, type Executor } from "./media-cleanup.ts";
import { limitKey } from "./rate-limit-policy.ts";

/**
 * Deleting people and loops.
 *
 * Every path here has the same shape: one transaction finds every stored file
 * the doomed rows point at, deletes the rows, and queues the files; only after
 * it commits are the files removed (and whatever storage refuses is retried by
 * the sweep). The rows are the source of truth, so a crash between the two
 * leaves an orphaned file on a queue, never a page pointing at a missing one.
 *
 * Most of the cascade is the schema's own `on delete cascade` from
 * `memberships`; this module adds what a foreign key cannot express — files,
 * the email trail keyed by address, names frozen into snapshots and logs.
 */

/** Written over a sent email's stored copy once someone in it has deleted their data. */
export const REDACTED_EMAIL = "Removed: this copy named someone who has since deleted their data.";

export type OwnedLoop = { groupId: string; name: string; others: number };

class Refused extends Error {
  readonly reason: "not-found" | "owner";
  readonly loops: OwnedLoop[];

  constructor(reason: "not-found" | "owner", loops: OwnedLoop[] = []) {
    super(reason);
    this.reason = reason;
    this.loops = loops;
  }
}

/** Escape a value for use inside an `ilike` pattern. */
function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * Every stored file a set of memberships put there, or that hangs from what they
 * wrote: their answers' photos, voice notes and photo-wall photos, comment photos,
 * avatars, and every answer on a birthday card about them, which goes with them.
 */
async function membershipMedia(tx: Executor, membershipIds: string[]): Promise<string[]> {
  const aboutThem = tx
    .select({ id: issueQuestions.id })
    .from(issueQuestions)
    .where(inArray(issueQuestions.aboutMembershipId, membershipIds));
  const doomed = await tx
    .select({ id: replies.id, photoUrl: replies.photoUrl, audioUrl: replies.audioUrl })
    .from(replies)
    .where(or(inArray(replies.membershipId, membershipIds), inArray(replies.issueQuestionId, aboutThem)));
  const replyIds = doomed.map((reply) => reply.id);

  const commentPhotos = await tx
    .select({ url: comments.photoUrl })
    .from(comments)
    .where(
      replyIds.length > 0
        ? or(inArray(comments.membershipId, membershipIds), inArray(comments.replyId, replyIds))
        : inArray(comments.membershipId, membershipIds),
    );

  const wallPhotos = replyIds.length > 0
    ? await tx.select({ url: replyMedia.url }).from(replyMedia).where(inArray(replyMedia.replyId, replyIds))
    : [];

  const avatars = await tx
    .select({ url: memberships.photoUrl })
    .from(memberships)
    .where(inArray(memberships.id, membershipIds));

  return [
    ...doomed.flatMap((reply) => [reply.photoUrl, reply.audioUrl]),
    ...commentPhotos.map((row) => row.url),
    ...wallPhotos.map((row) => row.url),
    ...avatars.map((row) => row.url),
  ].filter((url): url is string => Boolean(url));
}

/** Every stored file in one loop. */
async function loopMedia(tx: Executor, groupId: string): Promise<string[]> {
  const [group] = await tx.select({ url: groups.headerImageUrl }).from(groups).where(eq(groups.id, groupId));
  const members = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.groupId, groupId));
  const files = members.length > 0 ? await membershipMedia(tx, members.map((member) => member.id)) : [];
  return [group?.url ?? null, ...files].filter((url): url is string => Boolean(url));
}

/**
 * Abuse counters named after these memberships. They expire on their own within
 * the hour, but the key carries a membership id that would outlive the person.
 */
async function deleteMemberCounters(tx: Executor, membershipIds: string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  const keys = membershipIds.flatMap((id) => [limitKey.comment(id), limitKey.feedbackMember(id)]);
  await tx.delete(rateLimits).where(inArray(rateLimits.key, keys));
}

/** Resend's delivery events for the given sends; they carry the recipient's address. */
async function deleteEmailEvents(tx: Executor, scope: SQL): Promise<void> {
  const sent = await tx.select({ providerId: outbox.providerId }).from(outbox).where(scope);
  const ids = sent.map((row) => row.providerId).filter((id): id is string => Boolean(id));
  if (ids.length > 0) await tx.delete(emailEvents).where(inArray(emailEvents.providerId, ids));
}

/**
 * A suppression holds a raw address. It protects that address from more mail, so
 * it stays while any loop still has a membership for it, and goes with the last.
 * An address that is invited again later bounces or complains afresh.
 */
async function forgetSuppressions(tx: Executor, emails: string[]): Promise<void> {
  const addresses = [...new Set(emails.map((email) => email.toLowerCase()))];
  if (addresses.length === 0) return;
  await tx.delete(emailSuppressions).where(
    and(
      inArray(emailSuppressions.email, addresses),
      sql`not exists (select 1 from ${memberships} where lower(${memberships.email}) = ${emailSuppressions.email})`,
    ),
  );
}

/**
 * Sent emails are kept as a log. Once someone deletes their data, the stored
 * copies that show them (a round with their answers, an invite in their name)
 * are blanked. One not yet sent is dropped instead, so a retry can neither
 * deliver their words after all nor send an empty email.
 */
async function scrubMailLog(tx: Executor, groupIds: string[], needles: string[]): Promise<void> {
  const terms = [...new Set(needles.map((needle) => needle.trim()).filter((needle) => needle.length >= 2))];
  if (groupIds.length === 0 || terms.length === 0) return;
  const naming = and(
    inArray(outbox.groupId, groupIds),
    or(...terms.flatMap((term) => [
      sql`${outbox.html} ilike ${likeTerm(term)}`,
      sql`${outbox.text} ilike ${likeTerm(term)}`,
      sql`${outbox.subject} ilike ${likeTerm(term)}`,
    ])),
  );
  await tx.update(outbox).set({ html: REDACTED_EMAIL, text: REDACTED_EMAIL }).where(and(naming, eq(outbox.status, "sent")));
  await tx.delete(outbox).where(and(naming, ne(outbox.status, "sent")));
}

/**
 * Delete memberships and everything that is theirs. `alsoKnownAs` adds names the
 * person goes by elsewhere (their account name) to the sent-mail redaction.
 * Returns the files to remove.
 */
async function eraseMemberships(tx: Executor, membershipIds: string[], alsoKnownAs: string[] = []): Promise<string[]> {
  if (membershipIds.length === 0) return [];

  const rows = await tx
    .select({ groupId: memberships.groupId, email: memberships.email, name: memberships.name })
    .from(memberships)
    .where(inArray(memberships.id, membershipIds));
  const files = await membershipMedia(tx, membershipIds);

  // A suggestion the owner accepted lives on as the loop's question; only the
  // credit that names its author goes.
  const accepted = await tx
    .select({ questionId: questionSuggestions.acceptedQuestionId })
    .from(questionSuggestions)
    .where(inArray(questionSuggestions.membershipId, membershipIds));
  const questionIds = accepted.map((row) => row.questionId).filter((id): id is string => Boolean(id));
  if (questionIds.length > 0) {
    await tx.update(issueQuestions).set({ suggestedBy: null }).where(inArray(issueQuestions.questionId, questionIds));
  }

  // A birthday card is titled with the person's name; it goes with them. The round's
  // copy cascades from `about_membership_id`; the legacy copy kept until the contract
  // release is keyed by its event, which goes with them too.
  const birthdays = await tx.select({ id: events.id }).from(events).where(inArray(events.membershipId, membershipIds));
  const birthdayIds = birthdays.map((event) => event.id);
  if (birthdayIds.length > 0) await tx.delete(issueSections).where(inArray(issueSections.eventId, birthdayIds));

  await tx.delete(feedback).where(inArray(feedback.membershipId, membershipIds));
  await deleteMemberCounters(tx, membershipIds);
  await deleteEmailEvents(tx, inArray(outbox.membershipId, membershipIds));
  await scrubMailLog(
    tx,
    [...new Set(rows.map((row) => row.groupId))],
    [...rows.flatMap((row) => [row.email, row.name ?? row.email.split("@")[0]]), ...alsoKnownAs],
  );

  // Replies, comments, reactions, suggestions, section answers, birthdays and
  // this person's own email rows all cascade from the membership.
  await tx.delete(memberships).where(inArray(memberships.id, membershipIds));
  await forgetSuppressions(tx, rows.map((row) => row.email));
  return files;
}

async function eraseLoopRows(tx: Executor, groupId: string): Promise<string[]> {
  const files = await loopMedia(tx, groupId);
  const members = await tx.select({ id: memberships.id, email: memberships.email }).from(memberships).where(eq(memberships.groupId, groupId));
  await deleteMemberCounters(tx, members.map((member) => member.id));
  await deleteEmailEvents(tx, eq(outbox.groupId, groupId));
  await tx.delete(groups).where(eq(groups.id, groupId));
  await forgetSuppressions(tx, members.map((member) => member.email));
  return files;
}

/** Loops this person owns, with how many other people are still in each. */
async function ownedLoops(tx: Executor, userId: string, email: string): Promise<OwnedLoop[]> {
  const owned = await tx
    .select({ groupId: groups.id, name: groups.name })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(
      or(eq(memberships.userId, userId), eq(memberships.email, email)),
      eq(memberships.access, "owner"),
      isNull(memberships.revokedAt),
    ));

  const loops: OwnedLoop[] = [];
  for (const loop of owned) {
    const others = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(
        eq(memberships.groupId, loop.groupId),
        isNull(memberships.revokedAt),
        ne(memberships.access, "owner"),
      ));
    loops.push({ ...loop, others: others.length });
  }
  return loops;
}

export type DeletionPlan = {
  /** Loops with other people in them: hand them on or delete them first. */
  blocking: OwnedLoop[];
  /** Loops with nobody else in them: they go with the account. */
  solo: OwnedLoop[];
};

/** What deleting this account would do, for the confirmation page. */
export async function accountDeletionPlan(userId: string): Promise<DeletionPlan | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const loops = await ownedLoops(db, userId, user.email);
  return {
    blocking: loops.filter((loop) => loop.others > 0),
    solo: loops.filter((loop) => loop.others === 0),
  };
}

export type EraseAccountResult =
  | { ok: true; loopsDeleted: number; files: number }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "owner"; loops: OwnedLoop[] };

/**
 * Delete an account and everything its person wrote, in every loop: their
 * memberships (signed in or still only invited by that address), answers,
 * photos, voice notes, comments, reactions, suggestions, birthdays, feedback,
 * sessions, sign-in links and email trail. A loop they own alone goes too; a
 * loop with anyone else in it refuses the whole deletion until it has been
 * handed on or deleted, so nobody else's loop disappears by surprise.
 */
export async function eraseAccount(userId: string): Promise<EraseAccountResult> {
  let queued: string[] = [];
  let loopsDeleted = 0;

  try {
    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new Refused("not-found");

      const loops = await ownedLoops(tx, user.id, user.email);
      const blocking = loops.filter((loop) => loop.others > 0);
      if (blocking.length > 0) throw new Refused("owner", blocking);

      const files: string[] = [];
      for (const loop of loops) files.push(...(await eraseLoopRows(tx, loop.groupId)));
      loopsDeleted = loops.length;

      const mine = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(or(eq(memberships.userId, user.id), eq(memberships.email, user.email)));
      files.push(...(await eraseMemberships(tx, mine.map((row) => row.id), user.name ? [user.name] : [])));

      await tx.delete(feedback).where(or(eq(feedback.userId, user.id), eq(feedback.senderEmail, user.email)));
      // A notice sent to an address they have since moved away from still names them.
      const movedFrom = await tx
        .select({ email: emailChanges.oldEmail })
        .from(emailChanges)
        .where(eq(emailChanges.userId, user.id));
      const addresses = [user.email, ...movedFrom.map((row) => row.email)];
      await deleteEmailEvents(tx, inArray(outbox.to, addresses));
      await tx.delete(outbox).where(inArray(outbox.to, addresses));
      await tx.delete(magicLinks).where(eq(magicLinks.email, user.email));
      await forgetSuppressions(tx, [user.email]);
      // The sign-in counter is keyed by the address itself.
      await tx.delete(rateLimits).where(inArray(rateLimits.key, [limitKey.invite(user.id), limitKey.emailChange(user.id), limitKey.signInEmail(user.email), limitKey.signInCodeEmail(user.email), limitKey.feedbackUser(user.id)]));
      // Sessions cascade from the user.
      await tx.delete(users).where(eq(users.id, user.id));

      queued = await queueMediaDeletion(tx, files);
    });
  } catch (error) {
    if (error instanceof Refused) {
      return error.reason === "owner"
        ? { ok: false, reason: "owner", loops: error.loops }
        : { ok: false, reason: "not-found" };
    }
    throw error;
  }

  await purgeMedia(queued);
  return { ok: true, loopsDeleted, files: queued.length };
}

export type LeaveResult =
  | { ok: true; groupName: string }
  | { ok: false; reason: "not-found" | "owner" };

/**
 * The reply link's own way out: remove this person from one loop and delete
 * everything they wrote there. Many contributors never sign in, so the link is
 * the only credential they hold. The owner cannot leave their own loop this way.
 */
export async function leaveLoop(token: string): Promise<LeaveResult> {
  let queued: string[] = [];
  let groupName = "";

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: memberships.id, access: memberships.access, groupName: groups.name })
        .from(memberships)
        .innerJoin(groups, eq(groups.id, memberships.groupId))
        .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
        .for("update", { of: memberships });
      if (!row) throw new Refused("not-found");
      if (row.access === "owner") throw new Refused("owner");

      groupName = row.groupName;
      queued = await queueMediaDeletion(tx, await eraseMemberships(tx, [row.id]));
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason as "not-found" | "owner" };
    throw error;
  }

  await purgeMedia(queued);
  return { ok: true, groupName };
}

/** Delete a loop, every round and answer in it, and every file they stored. */
export async function eraseLoop(groupId: string): Promise<{ files: number }> {
  const queued = await db.transaction(async (tx) => queueMediaDeletion(tx, await eraseLoopRows(tx, groupId)));
  await purgeMedia(queued);
  return { files: queued.length };
}

/** Who a reply link belongs to, for the leave page. Null for a link that no longer works. */
export async function leaveContext(token: string): Promise<{ groupId: string; groupName: string; isOwner: boolean } | null> {
  const [row] = await db
    .select({ groupId: groups.id, groupName: groups.name, access: memberships.access })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);
  return row ? { groupId: row.groupId, groupName: row.groupName, isOwner: row.access === "owner" } : null;
}
