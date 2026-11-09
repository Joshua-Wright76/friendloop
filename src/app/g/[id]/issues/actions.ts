"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { renameIssue } from "@/lib/identity";
import { atLeast, viewerFor } from "@/lib/permissions";

/** Name a round (with a cover, or none), or clear its name. The owner's or an admin's call, before or after delivery. */
export async function renameIssueAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || !atLeast(viewer.membership.access, "admin")) redirect(`/g/${groupId}`);

  // The cover's fields come with the name; a form without them leaves the cover be.
  const field = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : undefined;
  };
  const sticker = field("coverSticker");
  const result = await renameIssue(groupId, issueId, String(formData.get("name") ?? ""), { sticker, tint: field("coverTint") });
  revalidatePath(`/g/${groupId}`, "layout");
  revalidatePath(`/i/${issueId}`);
  const notice = result.ok ? (result.name ? (sticker ? "cover" : "1") : "0") : null;
  redirect(`/g/${groupId}/issues${notice ? `?named=${notice}` : ""}`);
}
