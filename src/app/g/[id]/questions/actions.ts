"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, questions } from "@/db/schema";
import { getNow } from "@/lib/clock";
import { addQuestion, addQuestionTexts, archiveQuestion, reorderQuestion, toggleSkipNext } from "@/lib/manage";
import { acceptSuggestion, declineSuggestion } from "@/lib/suggestions";
import { viewerFor } from "@/lib/permissions";

async function requireManager(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);
  return viewer;
}

export async function rotationAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const raw = String(formData.get("questionsPerRound") ?? "");
  const questionsPerRound = raw === "" ? null : Number(raw);
  if (questionsPerRound !== null && (!Number.isInteger(questionsPerRound) || questionsPerRound < 1 || questionsPerRound > 20)) {
    redirect(`/g/${groupId}/questions?rotation=invalid`);
  }

  await db
    .update(groups)
    .set({
      questionsPerRound,
      questionCursor: sql`case when ${groups.questionsPerRound} is not distinct from ${questionsPerRound} then ${groups.questionCursor} else 0 end`,
    })
    .where(eq(groups.id, groupId));
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?rotation=1`);
}

export async function addFromPacksAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const texts = formData.getAll("question").map((value) => String(value));
  const added = await addQuestionTexts(groupId, texts, await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?fromPacks=${added}`);
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

export async function acceptSuggestionAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const suggestionId = String(formData.get("suggestionId") ?? "");
  const text = String(formData.get("text") ?? "");
  const result = await acceptSuggestion({ groupId, suggestionId, text, at: await getNow() });
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?suggestion=${result.ok ? "added" : "gone"}`);
}

export async function declineSuggestionAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await requireManager(groupId);

  const suggestionId = String(formData.get("suggestionId") ?? "");
  const result = await declineSuggestion({ groupId, suggestionId, at: await getNow() });
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?suggestion=${result.ok ? "declined" : "gone"}`);
}
