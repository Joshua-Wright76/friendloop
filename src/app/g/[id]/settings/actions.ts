"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { saveTheme, type ThemeInput } from "@/lib/identity";
import { deleteLoop, rotateShareLinks, setPaused, updateLoopSettings } from "@/lib/manage";
import { atLeast, viewerFor, type Access } from "@/lib/permissions";
import { isValidTimezone } from "@/lib/timezone";

/** Admins run the loop's settings with the owner; deleting the loop stays the owner's. */
async function requireAccess(groupId: string, required: Access) {
  const viewer = await viewerFor(groupId);
  if (!viewer || !atLeast(viewer.membership.access, required)) redirect(`/g/${groupId}`);
  return viewer;
}

type DetailsProblem = "name" | "timezone";

/** The details form's checks and write, shared by the redirecting and the as-you-go actions. */
async function saveDetailsFrom(formData: FormData): Promise<{ groupId: string; problem: DetailsProblem | null }> {
  const groupId = String(formData.get("groupId") ?? "");
  await requireAccess(groupId, "admin");

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (name.length < 2) return { groupId, problem: "name" };
  if (!isValidTimezone(timezone)) return { groupId, problem: "timezone" };

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
  return { groupId, problem: null };
}

/** The form's own post, for a page without script: saves and comes back with a notice. */
export async function settingsAction(formData: FormData) {
  const { groupId, problem } = await saveDetailsFrom(formData);
  if (problem) redirect(`/g/${groupId}/settings?error=1`);
  redirect(`/g/${groupId}/settings?saved=1`);
}

/** The same save as the details change: the page stays put and says how it went. */
export async function saveDetails(formData: FormData): Promise<{ ok: true } | { ok: false; problem: DetailsProblem }> {
  const { problem } = await saveDetailsFrom(formData);
  return problem ? { ok: false, problem } : { ok: true };
}

/** New URLs for every delivered round; the ones already handed out 404. */
export async function rotateSharesAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireAccess(groupId, "admin");

  const rotated = await rotateShareLinks(groupId);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?shares=${rotated}-${Date.now()}`);
}

export async function pauseHereAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireAccess(groupId, "admin");

  await setPaused(groupId, formData.get("paused") === "1", await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings`);
}

export async function deleteAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireAccess(groupId, "owner");

  const confirmation = String(formData.get("confirm") ?? "").trim();
  const expected = String(formData.get("name") ?? "").trim();
  if (confirmation !== expected) redirect(`/g/${groupId}/settings?error=confirm${formData.get("then") === "delete-account" ? "&then=delete-account" : ""}`);

  await deleteLoop(groupId);
  redirect(formData.get("then") === "delete-account" ? "/you/delete" : "/you?deleted=1");
}

/** The paper, colour and marks, saved as they're chosen. The page stays put and says how it went. */
export async function saveStationery(groupId: string, choice: ThemeInput): Promise<{ ok: boolean; adjusted: boolean }> {
  await requireAccess(groupId, "admin");
  const result = await saveTheme(groupId, choice);
  if (!result.ok) return { ok: false, adjusted: false };
  revalidatePath(`/g/${groupId}`, "layout");
  return { ok: true, adjusted: Boolean(result.adjusted) };
}

export async function stationeryAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireAccess(groupId, "admin");

  const result = await saveTheme(groupId, {
    preset: String(formData.get("preset") ?? ""),
    accent: String(formData.get("accent") ?? ""),
    background: String(formData.get("background") ?? ""),
    paperPack: String(formData.get("paperPack") ?? ""),
    tapePack: String(formData.get("tapePack") ?? ""),
    mascot: String(formData.get("mascot") ?? ""),
    // Only what the form carries: a page without script never clears what it didn't show.
    ...Object.fromEntries(
      (["motto", "signOff", "sealStyle", "sealColor", "divider", "celebration"] as const)
        .filter((name) => formData.has(name))
        .map((name) => [name, String(formData.get(name))]),
    ),
  });
  if (!result.ok) redirect(`/g/${groupId}/settings?error=stationery`);

  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/settings?stationery=${result.adjusted ? "adjusted" : "1"}`);
}
