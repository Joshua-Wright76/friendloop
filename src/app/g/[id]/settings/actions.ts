"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { deleteLoop, setPaused, updateLoopSettings } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";
import { normalizeIssueTheme } from "@/lib/issue-experience";

async function requireOwner(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);
  return viewer;
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function settingsAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (name.length < 2 || !validTimezone(timezone)) {
    redirect(`/g/${groupId}/settings?error=1`);
  }

  await updateLoopSettings(groupId, {
    name,
    timezone,
    promptWeekday: Number(formData.get("weekday") ?? 5),
    promptHour: Number(formData.get("hour") ?? 9),
    cadenceWeeks: [1, 2, 4, 13].includes(Number(formData.get("cadence") ?? 1))
      ? Number(formData.get("cadence") ?? 1)
      : 1,
    shareEnabled: formData.get("shareEnabled") === "on",
    theme: normalizeIssueTheme(formData.get("theme")),
  });

  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?saved=1`);
}

export async function pauseHereAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  await setPaused(groupId, formData.get("paused") === "1", await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings`);
}

export async function deleteAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  const confirmation = String(formData.get("confirm") ?? "").trim();
  const expected = String(formData.get("name") ?? "").trim();
  if (confirmation !== expected) redirect(`/g/${groupId}/settings?error=confirm`);

  await deleteLoop(groupId);
  redirect("/you?deleted=1");
}
