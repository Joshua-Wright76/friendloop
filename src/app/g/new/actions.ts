"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { setHeaderImage, stationeryColumns } from "@/lib/identity";
import { marksColumns } from "@/lib/looks";
import { createLoop, inviteMembers, ownedLoopCount } from "@/lib/manage";
import { MAX_LOOPS_PER_OWNER, MAX_MEMBERS_PER_LOOP } from "@/lib/rate-limit";
import { MAX_BANNER_BYTES, validatePhoto } from "@/lib/photo-validation";
import { DEFAULT_PRESET, isPresetKey, normalizeHex } from "@/lib/theme";
import { copy } from "@/lib/copy";
import { isValidTimezone } from "@/lib/timezone";
import { log } from "@/lib/log";

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
  if (emails.length >= MAX_MEMBERS_PER_LOOP) return { error: copy.newLoop.errors.tooManyPeople };
  if ((await ownedLoopCount(user.id)) >= MAX_LOOPS_PER_OWNER) return { error: copy.newLoop.errors.tooManyLoops };
  const personalNote = String(formData.get("personalNote") ?? "").trim().slice(0, 1000);

  // The look is optional, but a bad one is refused before anything exists, so a
  // typo in the accent never leaves a half-made loop behind.
  const preset = String(formData.get("preset") ?? "");
  const accent = String(formData.get("accent") ?? "");
  if (preset !== "" && !isPresetKey(preset)) return { error: copy.newLoop.errors.theme };
  if (accent.trim() !== "" && !normalizeHex(accent)) return { error: copy.newLoop.errors.theme };
  const looks = stationeryColumns({
    background: String(formData.get("background") ?? ""),
    paperPack: String(formData.get("paperPack") ?? ""),
    tapePack: String(formData.get("tapePack") ?? ""),
    mascot: String(formData.get("mascot") ?? ""),
  });
  if (!looks.ok) return { error: copy.newLoop.errors.theme };
  const marks = marksColumns({
    motto: String(formData.get("motto") ?? ""),
    signOff: String(formData.get("signOff") ?? ""),
    sealStyle: String(formData.get("sealStyle") ?? ""),
    sealColor: String(formData.get("sealColor") ?? ""),
    divider: String(formData.get("divider") ?? ""),
    celebration: String(formData.get("celebration") ?? ""),
  });
  if (!marks.ok) return { error: copy.newLoop.errors.theme };

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
    timezone,
    promptWeekday: Number.isFinite(promptWeekday) ? promptWeekday : 5,
    promptHour: Number.isFinite(promptHour) ? promptHour : 9,
    cadenceWeeks,
    questions: texts,
    at,
    // Stored with the loop in the same insert, so the look can never half-apply.
    // Gingham with no accent is stored as nothing, exactly as the settings do.
    themePreset: preset && preset !== DEFAULT_PRESET ? preset : null,
    themeAccent: normalizeHex(accent),
    ...looks.columns,
    ...marks.columns,
  });

  // Validated above, so a failure here is the store or the database; the loop is
  // made, invitations still go out, and the picture can be added from the settings.
  let pictureSaved = true;
  if (header) {
    try {
      pictureSaved = (await setHeaderImage(groupId, header)).ok;
    } catch (error) {
      log.error("Unable to save the new loop's header picture", error);
      pictureSaved = false;
    }
  }

  if (emails.length > 0) {
    const invited = await inviteMembers({
      groupId,
      emails,
      participation,
      actorName: user.name ?? user.email.split("@")[0],
      actorUserId: user.id,
      at,
      personalNote: personalNote || undefined,
    });
    // Nobody should think an invitation went when it didn't: the people tab says so.
    if (invited.limited > 0) redirect(`/g/${groupId}/members?limited=1`);
  }

  redirect(`/g/${groupId}?welcome=${pictureSaved ? "1" : "no-picture"}&day=${WEEKDAYS[promptWeekday] ?? WEEKDAYS[5]}`);
}
