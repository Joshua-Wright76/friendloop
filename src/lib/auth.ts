import { cookies } from "next/headers";
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { magicLinks, memberships, sessions, users } from "@/db/schema";
import { randomInt } from "node:crypto";
import { hashToken, newToken } from "./tokens";
import { getNow } from "./clock";
import { cleanDisplayName } from "./names";
import { isValidTimezone } from "./timezone";
import { signInEmail } from "./email/templates";
import { sendEmail } from "./email/send";
import { signInUrl } from "./urls";
import { consume, LIMITS, limitKey } from "./rate-limit";

export const SESSION_COOKIE = "fl_session";
/** The address a sign-in link was just sent to, echoed on the check-email page. */
export const CHECK_EMAIL_COOKIE = "fl_signin_email";
/** A year, renewed whenever the person turns up, so someone who uses it is never signed out. */
export const SESSION_DAYS = 365;
/** A sign-in email works this long, as often as needed: a phone, then a laptop, then tomorrow. */
export const LINK_HOURS = 100;
/** A link reached by typing its code is used on the spot, so it needn't last. */
const CODE_LINK_MINUTES = 15;
/** Wrong codes an address can take while a link is live, before that link's code stops working. */
export const MAX_CODE_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Six digits, leading zeros kept. */
export function newSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Whatever was typed, as the six digits it should be: spaces and dashes dropped. */
export function cleanSignInCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Hashed with the address, so a code only ever means something for the inbox it went to. */
function hashSignInCode(email: string, code: string): string {
  return hashToken(`signin-code:${email}:${code}`);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
};

/** `sent` and `quiet` look identical to the person asking; only `busy` is shown. */
export type MagicLinkOutcome = "sent" | "quiet" | "busy";

/**
 * Send a sign-in link. The account is created when the link is *used*, so an
 * address nobody has ever seen leaves exactly the same trace as a known one.
 *
 * Two ceilings guard the inbox and the sending quota. Too many requests from
 * one network is `busy`, and the form says so — that tells a caller nothing
 * about any address. Too many links to one address is `quiet`: nothing is sent,
 * but the caller is shown the same "check your inbox" as always, so throttling
 * cannot be used to probe who is signing in.
 */
async function isBlocked(email: string): Promise<boolean> {
  const [row] = await db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return Boolean(row?.blockedAt);
}

export async function requestMagicLink(
  rawEmail: string,
  options: { ip?: string } = {},
): Promise<MagicLinkOutcome> {
  const email = normalizeEmail(rawEmail);
  const at = await getNow();

  if (!(await consume(limitKey.signInIp(options.ip ?? "unknown"), LIMITS.signInIp, at)).allowed) return "busy";
  if (!(await consume(limitKey.signInEmail(email), LIMITS.signInEmail, at)).allowed) return "quiet";
  if (await isBlocked(email)) return "quiet";

  const token = newToken();
  const code = newSignInCode();
  await db.insert(magicLinks).values({
    email,
    tokenHash: hashToken(token),
    codeHash: hashSignInCode(email, code),
    expiresAt: new Date(at.getTime() + LINK_HOURS * 60 * 60 * 1000),
  });

  const rendered = signInEmail(signInUrl(token), code);
  await sendEmail({
    ...rendered,
    to: email,
    kind: "signin",
    dedupeKey: `signin:${hashToken(token)}`,
  });
  return "sent";
}

export type ConfirmResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; reason: "expired" | "unknown" };

/** What the browser can tell us at sign-in, so we never have to ask later. */
export type ConfirmProfile = {
  name?: string | null;
  timezone?: string | null;
};

/**
 * Good until it expires, as many times as needed, from any device. Called from a
 * POST, never a GET: mail scanners and chat link previews fetch GETs, and they
 * shouldn't come away signed in.
 *
 * The two extra fields are the point of no return: this is the first moment a
 * person is definitely a person, so the zone their browser reports and the name
 * they typed are captured here and reused by every deadline and byline after.
 */
export async function confirmMagicLink(
  token: string,
  profile: ConfirmProfile = {},
): Promise<ConfirmResult> {
  const at = await getNow();
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(token)))
    .limit(1);

  if (!link) return { ok: false, reason: "unknown" };
  if (link.expiresAt.getTime() <= at.getTime()) return { ok: false, reason: "expired" };
  if (await isBlocked(link.email)) return { ok: false, reason: "unknown" };

  await db
    .update(magicLinks)
    .set({ usedAt: at })
    .where(and(eq(magicLinks.id, link.id), isNull(magicLinks.usedAt)));

  return { ok: true, user: await signInAs(link.email, profile, at) };
}

export type CodeResult =
  | { ok: true; user: CurrentUser }
  /** Someone new: the confirm page asks their name, through a short link of its own. */
  | { ok: "name"; token: string }
  | { ok: false; reason: "wrong" | "busy" };

/**
 * The code from the email, for the device the email isn't on, or the app on a
 * home screen, which a tapped link never reaches. Every wrong code for an address
 * counts against each of its live links, and a link takes five, so guessing gets
 * a handful of tries at a million combinations, not a hundred hours of them.
 * Someone who has signed in before goes straight in; someone new is handed a
 * fresh confirm link, so the name step is the same one the emailed link shows.
 */
export async function confirmSignInCode(
  rawEmail: string,
  rawCode: string,
  options: { ip?: string; profile?: ConfirmProfile } = {},
): Promise<CodeResult> {
  const at = await getNow();
  if (!(await consume(limitKey.signInCode(options.ip ?? "unknown"), LIMITS.signInCode, at)).allowed) {
    return { ok: false, reason: "busy" };
  }
  const email = normalizeEmail(rawEmail);
  const code = cleanSignInCode(rawCode);
  // A typo in the shape (five digits, a letter) isn't a guess, so it costs nothing.
  if (!code || !email) return { ok: false, reason: "wrong" };

  const live = and(
    eq(magicLinks.email, email),
    gt(magicLinks.expiresAt, at),
    isNotNull(magicLinks.codeHash),
    lt(magicLinks.failedCodeAttempts, MAX_CODE_ATTEMPTS),
  );
  const [match] = await db
    .select({ id: magicLinks.id })
    .from(magicLinks)
    .where(and(live, eq(magicLinks.codeHash, hashSignInCode(email, code))))
    .limit(1);

  if (!match) {
    await db
      .update(magicLinks)
      .set({ failedCodeAttempts: sql`${magicLinks.failedCodeAttempts} + 1` })
      .where(live);
    return { ok: false, reason: "wrong" };
  }
  if (await isBlocked(email)) return { ok: false, reason: "wrong" };

  await db.update(magicLinks).set({ usedAt: at }).where(and(eq(magicLinks.id, match.id), isNull(magicLinks.usedAt)));

  const [known] = await db.select({ name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  if (known?.name) return { ok: true, user: await signInAs(email, options.profile ?? {}, at) };

  const token = newToken();
  await db.insert(magicLinks).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(at.getTime() + CODE_LINK_MINUTES * 60 * 1000),
  });
  return { ok: "name", token };
}

/** The account (made now if this is its first sign-in), its waiting memberships, and a session. */
async function signInAs(email: string, profile: ConfirmProfile, at: Date): Promise<CurrentUser> {
  const name = cleanDisplayName(profile.name);
  const timezone = profile.timezone && isValidTimezone(profile.timezone) ? profile.timezone.trim() : null;

  const [user] = await db
    .insert(users)
    .values({ email, name: name ?? undefined, timezone: timezone ?? undefined })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        email,
        ...(name ? { name } : {}),
        ...(timezone ? { timezone } : {}),
      },
    })
    .returning();

  // Attach any memberships that were waiting for this address to sign in.
  await db
    .update(memberships)
    .set({ userId: user.id, acceptedAt: sql`coalesce(${memberships.acceptedAt}, ${at.toISOString()})` })
    .where(and(eq(memberships.email, email), isNull(memberships.userId)));

  // An invited person often arrives without a name. Take theirs for every loop
  // that was still showing an email handle.
  if (name) {
    await db
      .update(memberships)
      .set({ name })
      .where(and(eq(memberships.email, email), isNull(memberships.name)));
  }

  await createSession(user.id, at);
  return toCurrentUser(user);
}

function toCurrentUser(user: typeof users.$inferSelect): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, timezone: user.timezone };
}

export async function createSession(userId: string, at: Date): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  await setSessionCookie(token, expiresAt);
}

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Push a live session's year forward from today, database and cookie both. Signed-in
 * pages ask at most daily, and a session renewed in the last day is left alone, so
 * this is one small write a day for someone who uses Friendloop, and none otherwise.
 */
export async function renewSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const at = await getNow();
  const expiresAt = new Date(at.getTime() + SESSION_DAYS * DAY_MS);

  // An expired session stays expired: renewal never brings one back.
  const renewed = await db
    .update(sessions)
    .set({ expiresAt })
    .where(and(
      eq(sessions.tokenHash, hashToken(token)),
      gt(sessions.expiresAt, at),
      lt(sessions.expiresAt, new Date(expiresAt.getTime() - DAY_MS)),
    ))
    .returning({ id: sessions.id });
  if (renewed.length === 0) return false;
  await setSessionCookie(token, expiresAt);
  return true;
}

export async function currentUser(): Promise<CurrentUser | null> {
  "use cache: private";
  cacheLife({ stale: 300 });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  cacheTag(token ? `session:${token}` : "session:anonymous");
  if (!token) return null;

  const at = await getNow({ skipConnection: true });
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, timezone: users.timezone })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, at)))
    .limit(1);

  return rows[0] ?? null;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    updateTag(`session:${token}`);
  }
  jar.delete(SESSION_COOKIE);
}

/** The reply link is the credential for contributors: no account, no session. */
export async function membershipFromReplyToken(token: string) {
  const rows = await db
    .select({
      membership: memberships,
      userId: memberships.userId,
      email: memberships.email,
    })
    .from(memberships)
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export type LinkPeek =
  | { state: "valid"; email: string }
  | { state: "expired"; email: string }
  | { state: "unknown" };

/** Read the link without using it, so the confirm page can say who it's for, or what went wrong. */
export async function peekMagicLink(token: string): Promise<LinkPeek> {
  const at = await getNow();
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(token)))
    .limit(1);

  if (!link) return { state: "unknown" };
  if (link.expiresAt.getTime() <= at.getTime()) return { state: "expired", email: link.email };
  return { state: "valid", email: link.email };
}
