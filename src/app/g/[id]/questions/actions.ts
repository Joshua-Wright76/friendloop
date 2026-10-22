"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import { addQuestion, archiveQuestion, moveQuestion, toggleSkipNext } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";

async function requireManager(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);
  return viewer;
}

export async function addAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const text = String(formData.get("text") ?? "");
  await addQuestion(groupId, text, await getNow());
  revalidatePath(`/g/${groupId}/questions`);
  redirect(`/g/${groupId}/questions?added=1`);
}

export async function moveAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const questionId = String(formData.get("questionId") ?? "");
  const direction = formData.get("direction") === "up" ? -1 : 1;
  await moveQuestion(groupId, questionId, direction);
  revalidatePath(`/g/${groupId}/questions`);
  redirect(`/g/${groupId}/questions`);
}

export async function archiveAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const questionId = String(formData.get("questionId") ?? "");
  await archiveQuestion(groupId, questionId, await getNow());
  revalidatePath(`/g/${groupId}/questions`);
  redirect(`/g/${groupId}/questions?archived=1`);
}

export async function skipNextAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const questionId = String(formData.get("questionId") ?? "");
  await toggleSkipNext(groupId, questionId);
  revalidatePath(`/g/${groupId}/questions`);
  redirect(`/g/${groupId}/questions`);
}
