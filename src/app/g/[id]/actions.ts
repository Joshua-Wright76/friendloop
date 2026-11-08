"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { setPaused } from "@/lib/manage";
import { sendRoundNow } from "@/lib/rounds";
import { nudgeStragglers } from "@/lib/notify";
import { consume, LIMITS, limitKey } from "@/lib/rate-limit";
import { viewerFor } from "@/lib/permissions";

/** Send the open round as it stands, and open the next one. */
export async function sendNowAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  const at = await getNow();
  const result = await sendRoundNow(groupId, at);
  revalidatePath(`/g/${groupId}`, "layout");
  if (result.state === "sent") {
    redirect(`/g/${groupId}/issues?sent=${result.number}${result.next ? `&next=${result.next.number}` : ""}`);
  }
  if (result.state === "empty") redirect(`/g/${groupId}/issues?nothingToSend=${result.number}`);
  redirect(`/g/${groupId}/issues`);
}

/** A hand-sent reminder to whoever hasn't answered the open round. */
export async function nudgeAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  if (!(await consume(limitKey.nudge(groupId), LIMITS.nudge, await getNow())).allowed) {
    redirect(`/g/${groupId}?nudged=limited`);
  }
  const sent = await nudgeStragglers(groupId, viewer.membership.id);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}?nudged=${sent}`);
}

export async function pauseAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paused = formData.get("paused") === "1";
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  await setPaused(groupId, paused, await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}`);
}
