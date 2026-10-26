"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, currentUser, signOut } from "@/lib/auth";
import { isValidTimezone } from "@/lib/timezone";

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/signin");
}

/** Called by the browser once, when its zone disagrees with the saved one. */
export async function syncTimezoneAction(timezone: string): Promise<void> {
  if (!isValidTimezone(timezone)) return;

  const user = await currentUser();
  if (!user || user.timezone === timezone) return;

  await db.update(users).set({ timezone: timezone.trim() }).where(eq(users.id, user.id));

  // `currentUser` is cached per session; drop it so the new zone is used at once.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) updateTag(`session:${token}`);
}
