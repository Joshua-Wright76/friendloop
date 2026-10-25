"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
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

export async function reorderQuestions(groupId: string, questionId: string, targetIndex: number): Promise<Array<{ id: string; text: string; skipNext: boolean }>> {
  await requireManager(groupId);
  const before = await db.select({ id: questions.id }).from(questions)
    .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt))).orderBy(asc(questions.position));
  const start = before.findIndex((question) => question.id === questionId);
  const destination = Number.isFinite(targetIndex)
    ? Math.max(0, Math.min(Math.trunc(targetIndex), before.length - 1))
    : start;
  if (start >= 0) {
    const direction = start < destination ? 1 : -1;
    for (let index = start; index !== destination; index += direction) {
      await moveQuestion(groupId, questionId, direction);
    }
  }
  revalidatePath(`/g/${groupId}/questions`);
  const after = await db.select({ id: questions.id, text: questions.text, skipNext: questions.skipNext }).from(questions)
    .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt))).orderBy(asc(questions.position));
  return after;
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
