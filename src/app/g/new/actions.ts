"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { createLoop, inviteMembers } from "@/lib/manage";
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

  redirect(`/g/${groupId}?welcome=1&day=${WEEKDAYS[promptWeekday] ?? WEEKDAYS[5]}`);
}
