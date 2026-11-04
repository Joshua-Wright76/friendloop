"use server";

import { redirect } from "next/navigation";
import { leaveLoop } from "@/lib/erasure";

/** Leave one loop through its reply link, deleting everything written there. */
export async function leaveLoopAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (formData.get("confirm") !== "on") redirect(`/r/${encodeURIComponent(token)}/leave?error=confirm`);

  const result = await leaveLoop(token);
  if (!result.ok) {
    redirect(result.reason === "owner" ? `/r/${encodeURIComponent(token)}/leave` : `/r/${encodeURIComponent(token)}`);
  }
  redirect("/goodbye");
}
