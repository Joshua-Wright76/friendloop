"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { consume, LIMITS, limitKey } from "@/lib/rate-limit";
import { getNow } from "@/lib/clock";
import {
  changeMemberEmail,
  inviteMembers,
  type MemberEmailResult,
  removeMember,
  resendInvite,
  setAccess,
  setParticipation,
  transferOwnership,
} from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";

async function requireManager(groupId: string) {
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);
  return viewer;
}

export async function inviteAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const viewer = await requireManager(groupId);

  const emails = formData.getAll("emails").map(String);
  if (emails.length === 0 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false as const, message: "invalid" as const };
  }
  const participation = "contributor";

  try {
    const result = await inviteMembers({
      groupId,
      emails,
      participation,
      actorName: viewer.membership.name ?? viewer.user.name ?? viewer.user.email.split("@")[0],
      actorUserId: viewer.user.id,
      at: await getNow(),
    });

    revalidatePath(`/g/${groupId}`, "layout");
    return { ok: true as const, invited: result.invited, skipped: result.skipped, limited: result.limited };
  } catch {
    return { ok: false as const, message: "failed" as const };
  }
}

export async function resendAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const viewer = await requireManager(groupId);

  if (!(await consume(limitKey.invite(viewer.user.id), LIMITS.invite, await getNow())).allowed) {
    redirect(`/g/${groupId}/members?limited=1`);
  }

  await resendInvite({
    groupId,
    membershipId,
    actorName: viewer.membership.name ?? viewer.user.name ?? viewer.user.email.split("@")[0],
  });

  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/members?resent=1`);
}

export async function removeAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  await requireManager(groupId);

  await removeMember(groupId, membershipId, await getNow());
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/members?removed=1`);
}

/**
 * Contributor or reader, from the member's picker. `setParticipation` keeps the
 * owner a contributor and everyone else a reader in `from_you` mode.
 */
export async function participationAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const participation = formData.get("participation") === "reader" ? "reader" : "contributor";
  await requireManager(groupId);

  try {
    const updated = await setParticipation(groupId, membershipId, participation);
    if (!updated) return { ok: false as const };
    revalidatePath(`/g/${groupId}`, "layout");
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function accessAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const access = formData.get("access") === "admin" ? "admin" : "member";
  await requireManager(groupId);

  await setAccess(groupId, membershipId, access);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/members`);
}

export async function roleAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const access = String(formData.get("access") ?? "member");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  // Ownership moves through `transferAction`, which asks for a confirmation.
  if (access === "owner") return { ok: false as const };

  try {
    const updated = await setAccess(groupId, membershipId, access === "admin" ? "admin" : "member");
    if (!updated) return { ok: false as const };
    revalidatePath(`/g/${groupId}`, "layout");
    return { ok: true as const, access: access === "admin" ? "admin" as const : "member" as const };
  } catch {
    return { ok: false as const };
  }
}

/**
 * Hand the loop to an admin. The form carries the new owner's membership id and
 * an explicit confirmation; the acting owner is read from the session, never the form.
 */
export async function transferAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);
  if (formData.get("confirm") !== "yes") redirect(`/g/${groupId}/members?transferError=1`);

  const moved = await transferOwnership(groupId, viewer.membership.id, membershipId);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/members?${moved ? "transferred=1" : "transferError=1"}`);
}

/** Fix the address of someone who has no account yet. */
export async function changeMemberEmailAction(formData: FormData): Promise<MemberEmailResult> {
  const groupId = String(formData.get("groupId") ?? "");
  const viewer = await requireManager(groupId);
  try {
    const result = await changeMemberEmail({
      groupId,
      membershipId: String(formData.get("membershipId") ?? ""),
      newEmail: String(formData.get("email") ?? ""),
      actorName: viewer.membership.name ?? viewer.user.name ?? viewer.user.email.split("@")[0],
      actorUserId: viewer.user.id,
      at: await getNow(),
    });
    if (result === "changed") revalidatePath(`/g/${groupId}`, "layout");
    return result;
  } catch {
    return "refused";
  }
}
