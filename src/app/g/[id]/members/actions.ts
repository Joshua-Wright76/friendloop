"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getNow } from "@/lib/clock";
import {
  inviteMembers,
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
      actorName: viewer.user.name ?? viewer.user.email.split("@")[0],
      at: await getNow(),
    });

    revalidatePath(`/g/${groupId}/members`);
    return { ok: true as const, invited: result.invited, skipped: result.skipped };
  } catch {
    return { ok: false as const, message: "failed" as const };
  }
}

export async function resendAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const viewer = await requireManager(groupId);

  await resendInvite({
    groupId,
    membershipId,
    actorName: viewer.user.name ?? viewer.user.email.split("@")[0],
  });

  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members?resent=1`);
}

export async function removeAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  await requireManager(groupId);

  await removeMember(groupId, membershipId, await getNow());
  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members?removed=1`);
}

export async function participationAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const participation = formData.get("participation") === "reader" ? "reader" : "contributor";
  await requireManager(groupId);

  await setParticipation(groupId, membershipId, participation);
  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members`);
}

export async function accessAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const access = formData.get("access") === "admin" ? "admin" : "member";
  await requireManager(groupId);

  await setAccess(groupId, membershipId, access);
  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members`);
}

export async function roleAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const access = String(formData.get("access") ?? "member");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access === "member") redirect(`/g/${groupId}`);

  if (access === "owner") {
    if (viewer.membership.access !== "owner") return { ok: false as const };
    try {
      await transferOwnership(groupId, viewer.membership.id, membershipId);
      revalidatePath(`/g/${groupId}/members`);
    } catch {
      return { ok: false as const };
    }
    redirect(`/g/${groupId}/members?transferred=1`);
  }

  try {
    const updated = await setAccess(groupId, membershipId, access === "admin" ? "admin" : "member");
    if (!updated) return { ok: false as const };
    revalidatePath(`/g/${groupId}/members`);
    return { ok: true as const, access: access === "admin" ? "admin" as const : "member" as const };
  } catch {
    return { ok: false as const };
  }
}

export async function transferAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);

  await transferOwnership(groupId, viewer.membership.id, membershipId);
  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members?transferred=1`);
}
