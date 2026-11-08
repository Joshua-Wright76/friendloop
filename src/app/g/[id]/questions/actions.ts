"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { getNow } from "@/lib/clock";
import {
  addQuestionTexts,
  askAgain,
  askThisRound,
  createItem,
  itemInputFrom,
  setQuestionsPerRound,
  stopAsking,
  updateItem,
} from "@/lib/ask-items";
import { removeSnapshot, reorderOpenRound, reorderPool } from "@/lib/round-questions";
import { acceptSuggestion, declineSuggestion } from "@/lib/suggestions";
import { viewerFor } from "@/lib/permissions";

/*
 * The Questions page's Server Actions. Each form action finishes by sending the
 * owner back to the page with a notice in the URL (`done`, or `problem` for
 * something to fix); the reorder actions return the saved order instead, for the
 * list that asked.
 */

async function requireManager(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);
  return viewer;
}

async function groupOf(groupId: string) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) redirect("/you");
  return group;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/** Back to the page with a notice. `n` makes each return new, so the page starts its forms afresh. */
function back(groupId: string, notice: Record<string, string>): never {
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/questions?${new URLSearchParams({ ...notice, n: Date.now().toString(36) })}`);
}

export async function addItemAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  const viewer = await requireManager(groupId);
  const thisRound = formData.get("thisRound") === "on";
  const result = await createItem({
    group: await groupOf(groupId),
    item: itemInputFrom(formData),
    thisRound,
    at: await getNow(),
    createdByMembershipId: viewer.membership.id,
  });
  back(groupId, result.ok ? { done: thisRound ? "addedNow" : "added" } : { problem: result.code });
}

export async function updateItemAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const result = await updateItem({
    group: await groupOf(groupId),
    questionId: field(formData, "questionId"),
    item: itemInputFrom(formData),
    at: await getNow(),
  });
  back(groupId, result.ok ? { done: "saved" } : { problem: result.code });
}

export async function stopAskingAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const result = await stopAsking(groupId, field(formData, "questionId"), await getNow());
  back(groupId, { done: result === "written" ? "stoppedStays" : "stopped" });
}

export async function askAgainAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  await askAgain(groupId, field(formData, "questionId"));
  back(groupId, { done: "again" });
}

export async function askThisRoundAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const added = await askThisRound(groupId, field(formData, "questionId"));
  back(groupId, { done: added ? "addedNow" : "alreadyAsked" });
}

export async function removeFromRoundAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const result = await removeSnapshot(groupId, field(formData, "snapshotId"));
  back(groupId, { done: result === "written" ? "stays" : formData.get("turn") === "1" ? "removedTurn" : "removed" });
}

export async function rotationAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const raw = field(formData, "questionsPerRound");
  const saved = await setQuestionsPerRound(groupId, raw === "" ? null : Number(raw));
  back(groupId, saved ? { done: "count" } : { problem: "count" });
}

export async function addFromPacksAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const texts = formData.getAll("question").map((value) => String(value));
  const added = await addQuestionTexts(groupId, texts, await getNow());
  back(groupId, { fromPacks: String(added) });
}

export async function acceptSuggestionAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const result = await acceptSuggestion({
    groupId,
    suggestionId: field(formData, "suggestionId"),
    text: field(formData, "text"),
    at: await getNow(),
  });
  back(groupId, { suggestion: result.ok ? "added" : "gone" });
}

export async function declineSuggestionAction(formData: FormData) {
  const groupId = field(formData, "groupId");
  await requireManager(groupId);
  const result = await declineSuggestion({ groupId, suggestionId: field(formData, "suggestionId"), at: await getNow() });
  back(groupId, { suggestion: result.ok ? "declined" : "gone" });
}

/** Move one of this round's items; returns the round's order as saved. */
export async function reorderRoundAction(groupId: string, snapshotId: string, targetIndex: number): Promise<string[]> {
  await requireManager(groupId);
  const saved = await reorderOpenRound(groupId, snapshotId, targetIndex);
  revalidatePath(`/g/${groupId}`, "layout");
  return saved;
}

/** Move an item in the queue or the every-round list; returns that list's order as saved. */
export async function reorderListAction(groupId: string, list: "rotating" | "every_round", questionId: string, targetIndex: number): Promise<string[]> {
  await requireManager(groupId);
  const saved = await reorderPool(groupId, list === "every_round" ? "every_round" : "rotating", questionId, targetIndex);
  revalidatePath(`/g/${groupId}`, "layout");
  return saved;
}
