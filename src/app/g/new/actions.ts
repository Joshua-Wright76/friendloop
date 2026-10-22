"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { createLoop } from "@/lib/manage";

export type CreateState = { error?: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  if (name.length < 2) return { error: "Give the loop a name." };

  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!validTimezone(timezone)) return { error: "That timezone isn't one we recognise." };

  const promptWeekday = Number(formData.get("weekday") ?? 5);
  const promptHour = Number(formData.get("hour") ?? 9);
  const cadenceWeeks = Number(formData.get("cadence") ?? 1);

  const picked = formData.getAll("question").map(String);
  const custom = String(formData.get("custom") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const texts = [...picked, ...custom];
  if (texts.length === 0) return { error: "Pick at least one question." };
  if (texts.length > 8) return { error: "Eight questions is already a lot — trim it down." };

  const at = await getNow();
  const groupId = await createLoop({
    ownerUserId: user.id,
    ownerEmail: user.email,
    ownerName: user.name,
    name,
    mode: formData.get("mode") === "from_you" ? "from_you" : "group",
    timezone,
    promptWeekday: Number.isFinite(promptWeekday) ? promptWeekday : 5,
    promptHour: Number.isFinite(promptHour) ? promptHour : 9,
    cadenceWeeks: cadenceWeeks === 2 ? 2 : 1,
    questions: texts,
    at,
  });

  redirect(`/g/${groupId}?welcome=1&day=${WEEKDAYS[promptWeekday] ?? "Friday"}`);
}
