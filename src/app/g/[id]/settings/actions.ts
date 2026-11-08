"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { saveTheme, type ThemeInput } from "@/lib/identity";
import { deleteLoop, rotateShareLinks, setPaused, updateLoopSettings } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";
import { isValidTimezone } from "@/lib/timezone";

async function requireOwner(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);
  return viewer;
}

export async function settingsAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (name.length < 2 || !isValidTimezone(timezone)) {
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
    commentsEnabled: formData.get("commentsEnabled") === "on",
  }, await getNow());

  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?saved=1`);
}

/** New URLs for every delivered round; the ones already handed out 404. */
export async function rotateSharesAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  const rotated = await rotateShareLinks(groupId);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?shares=${rotated}-${Date.now()}`);
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

/** The loop's stationery: a preset key and an optional accent. Owner only. */
/** The paper and colour, saved as they're chosen. The page stays put and says how it went. */
export async function saveStationery(groupId: string, choice: ThemeInput): Promise<{ ok: boolean; adjusted: boolean }> {
  await requireOwner(groupId);
  const result = await saveTheme(groupId, choice);
  if (!result.ok) return { ok: false, adjusted: false };
  revalidatePath(`/g/${groupId}`, "layout");
  return { ok: true, adjusted: Boolean(result.adjusted) };
}

export async function stationeryAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireOwner(groupId);

  const result = await saveTheme(groupId, {
    preset: String(formData.get("preset") ?? ""),
    accent: String(formData.get("accent") ?? ""),
    background: String(formData.get("background") ?? ""),
    paperPack: String(formData.get("paperPack") ?? ""),
    tapePack: String(formData.get("tapePack") ?? ""),
    mascot: String(formData.get("mascot") ?? ""),
  });
  if (!result.ok) redirect(`/g/${groupId}/settings?error=stationery`);

  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?stationery=${result.adjusted ? "adjusted" : "1"}`);
}
