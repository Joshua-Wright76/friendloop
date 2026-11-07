"use server";

import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { confirmEmailChange } from "@/lib/account";

export async function confirmEmailChangeAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmEmailChange(token);
  if (result === "changed") {
    // The page says which address you are signed in as, and it just changed.
    const session = (await cookies()).get("fl_session")?.value;
    if (session) updateTag(`session:${session}`);
    redirect("/you/email/confirm?done=1");
  }
  redirect(`/you/email/confirm?problem=${result}`);
}
