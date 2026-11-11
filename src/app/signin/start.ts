import { and, eq, isNull } from "drizzle-orm";
import { secureCookies } from "@/lib/e2e";
import { cookies } from "next/headers";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { LINK_HOURS } from "@/lib/auth";

/** Set when someone came to sign in from the landing page's "Start a loop" button. */
export const START_CHECK_COOKIE = "fl_signin_start";

export async function rememberStart(start: boolean): Promise<void> {
  const jar = await cookies();
  if (!start) {
    jar.delete({ name: START_CHECK_COOKIE, path: "/signin" });
    return;
  }
  jar.set(START_CHECK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/signin",
    maxAge: LINK_HOURS * 60 * 60,
  });
}

/** Where a plain sign-in lands: the wizard for someone who came to start a loop and has none, otherwise their loops. */
export async function plainDestination(userId: string): Promise<string> {
  if ((await cookies()).get(START_CHECK_COOKIE)?.value !== "1") return "/you";
  const [loop] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.revokedAt)))
    .limit(1);
  return loop ? "/you" : "/g/new";
}
