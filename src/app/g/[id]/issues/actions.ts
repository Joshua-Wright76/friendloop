"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { renameIssue } from "@/lib/identity";
import { viewerFor } from "@/lib/permissions";

/** Name a round, or clear its name. The owner's call, before or after delivery. */
export async function renameIssueAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);

  const result = await renameIssue(groupId, issueId, String(formData.get("name") ?? ""));
  revalidatePath(`/g/${groupId}`, "layout");
  revalidatePath(`/i/${issueId}`);
  redirect(`/g/${groupId}/issues${result.ok ? `?named=${result.name ? "1" : "0"}` : ""}`);
}
