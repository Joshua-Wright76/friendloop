"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setAccountBlocked } from "@/lib/account";
import { getNow } from "@/lib/clock";
import { requireUiPreview } from "@/lib/ui-preview";

/** Block or unblock an account. Behind the /dev key, in the proxy and again here. */
export async function setBlockedAction(formData: FormData): Promise<void> {
  await requireUiPreview();
  const email = String(formData.get("email") ?? "").trim();
  const blocked = formData.get("intent") === "block";
  const result = await setAccountBlocked(email, blocked, await getNow());

  revalidatePath("/dev/stats");
  const outcome = !result.found ? "notFound" : blocked ? "blocked" : "unblocked";
  const params = new URLSearchParams({ outcome, email, count: String(result.paused) });
  redirect(`/dev/stats?${params}`);
}
