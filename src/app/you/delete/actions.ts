"use server";

import { redirect } from "next/navigation";
import { currentUser, normalizeEmail, signOut } from "@/lib/auth";
import { eraseAccount } from "@/lib/erasure";

/** Delete the signed-in account. Typed confirmation; a loop someone else is in refuses it. */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  if (normalizeEmail(String(formData.get("confirm") ?? "")) !== user.email) {
    redirect("/you/delete?error=confirm");
  }

  const result = await eraseAccount(user.id);
  if (!result.ok && result.reason === "owner") redirect("/you/delete?error=owner");

  // The session row went with the user; this clears the cookie and its cache entry.
  await signOut();
  redirect("/goodbye");
}
