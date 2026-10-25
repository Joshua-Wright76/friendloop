"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { openIssueNow, setPaused } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";

export async function sendNowAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  const at = await getNow();
  const issue = await openIssueNow(groupId, at);
  revalidatePath(`/g/${groupId}`, "layout");
  if (issue) redirect(`/g/${groupId}/issues?opened=${issue.number}`);
  redirect(`/g/${groupId}/issues`);
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
