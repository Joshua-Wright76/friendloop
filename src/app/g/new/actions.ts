"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { createLoop } from "@/lib/manage";
import { copy } from "@/lib/copy";

export type CreateState = { error?: string };

const WEEKDAYS = copy.common.weekdays;

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function createLoopAction(
  _previous: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: copy.newLoop.errors.name };

  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!validTimezone(timezone)) return { error: copy.newLoop.errors.timezone };

  const promptWeekday = Number(formData.get("weekday") ?? 5);
  const promptHour = Number(formData.get("hour") ?? 9);
  const cadenceWeeks = Number(formData.get("cadence") ?? 1);

  const texts = formData.getAll("question").map(String).map((question) => question.trim()).filter(Boolean);
  if (texts.length === 0) return { error: copy.newLoop.errors.noQuestions };

  const at = await getNow();
  const groupId = await createLoop({
    ownerUserId: user.id,
    ownerEmail: user.email,
    ownerName: user.name,
    name,
    mode: "group",
    timezone,
    promptWeekday: Number.isFinite(promptWeekday) ? promptWeekday : 5,
    promptHour: Number.isFinite(promptHour) ? promptHour : 9,
    cadenceWeeks: cadenceWeeks === 2 ? 2 : 1,
    questions: texts,
    at,
  });

  redirect(`/g/${groupId}?welcome=1&day=${WEEKDAYS[promptWeekday] ?? WEEKDAYS[5]}`);
}
