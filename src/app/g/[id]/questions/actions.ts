"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { getNow } from "@/lib/clock";
import { addQuestion, archiveQuestion, reorderQuestion, toggleSkipNext } from "@/lib/manage";
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
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?added=1`);
}

export async function reorderQuestions(groupId: string, questionId: string, targetIndex: number): Promise<Array<{ id: string; text: string; skipNext: boolean }>> {
  await requireManager(groupId);
  await reorderQuestion(groupId, questionId, targetIndex);
  revalidatePath(`/g/${groupId}`, "layout");
  const after = await db.select({ id: questions.id, text: questions.text, skipNext: questions.skipNext }).from(questions)
    .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt))).orderBy(asc(questions.position));
  return after;
}

export async function archiveAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const questionId = String(formData.get("questionId") ?? "");
  await archiveQuestion(groupId, questionId, await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?archived=1`);
}

export async function skipNextAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const questionId = String(formData.get("questionId") ?? "");
  await toggleSkipNext(groupId, questionId);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions`);
}
