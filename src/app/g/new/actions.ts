"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { setHeaderImage, saveTheme } from "@/lib/identity";
import { createLoop, inviteMembers } from "@/lib/manage";
import { MAX_BANNER_BYTES, validatePhoto } from "@/lib/photo-validation";
import { isPresetKey, normalizeHex } from "@/lib/theme";
import { copy } from "@/lib/copy";
import { isValidTimezone } from "@/lib/timezone";

export type CreateState = { error?: string };

const WEEKDAYS = copy.common.weekdays;

export async function createLoopAction(
  _previous: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: copy.newLoop.errors.name };

  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!isValidTimezone(timezone)) return { error: copy.newLoop.errors.timezone };

  const promptWeekday = Number(formData.get("weekday") ?? 5);
  const promptHour = Number(formData.get("hour") ?? 9);
  const cadenceWeeks = Number(formData.get("cadence") ?? 1);
  const mode = "group";
  const participation = formData.get("participation") === "reader" ? "reader" : "contributor";
  const validCadences = [1, 2, 4, 13];
  if (!validCadences.includes(cadenceWeeks)) return { error: copy.newLoop.errors.cadence };
  if (!Number.isInteger(promptWeekday) || promptWeekday < 0 || promptWeekday > 6) {
    return { error: copy.newLoop.errors.day };
  }
  if (!Number.isInteger(promptHour) || promptHour < 0 || promptHour > 23) {
    return { error: copy.newLoop.errors.hour };
  }

  const texts = formData.getAll("question").map(String).map((question) => question.trim()).filter(Boolean);
  if (texts.length === 0) return { error: copy.newLoop.errors.noQuestions };

  const rawEmails = formData.getAll("email").map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  if (rawEmails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: copy.newLoop.wizard.readers.invalidEmail };
  }
  const emails = [...new Set(rawEmails)];
  const personalNote = String(formData.get("personalNote") ?? "").trim().slice(0, 1000);

  // The look is optional, but a bad one is refused before anything exists, so a
  // typo in the accent never leaves a half-made loop behind.
  const preset = String(formData.get("preset") ?? "");
  const accent = String(formData.get("accent") ?? "");
  if (preset !== "" && !isPresetKey(preset)) return { error: copy.newLoop.errors.theme };
  if (accent.trim() !== "" && !normalizeHex(accent)) return { error: copy.newLoop.errors.theme };

  const picture = formData.get("headerImage");
  let header: { bytes: Uint8Array; type: string } | null = null;
  if (picture instanceof File && picture.size > 0) {
    if (picture.size > MAX_BANNER_BYTES) return { error: copy.identity.errors.bannerTooLarge };
    header = { bytes: new Uint8Array(await picture.arrayBuffer()), type: picture.type };
    if (!validatePhoto(header.bytes, header.type).ok) return { error: copy.identity.errors.invalidImage };
  }

  const at = await getNow();
  const groupId = await createLoop({
    ownerUserId: user.id,
    ownerEmail: user.email,
    ownerName: user.name,
    name,
    mode,
    timezone,
    promptWeekday: Number.isFinite(promptWeekday) ? promptWeekday : 5,
    promptHour: Number.isFinite(promptHour) ? promptHour : 9,
    cadenceWeeks,
    questions: texts,
    at,
  });

  await saveTheme(groupId, { preset, accent });
  // Validated above, so a failure here is the store itself; the loop is made and
  // the picture can be added again from the settings.
  const pictureSaved = header ? (await setHeaderImage(groupId, header)).ok : true;

  if (emails.length > 0) {
    await inviteMembers({
      groupId,
      emails,
      participation,
      actorName: user.name ?? user.email.split("@")[0],
      at,
      personalNote: personalNote || undefined,
    });
  }

  redirect(`/g/${groupId}?welcome=${pictureSaved ? "1" : "no-picture"}&day=${WEEKDAYS[promptWeekday] ?? WEEKDAYS[5]}`);
}
