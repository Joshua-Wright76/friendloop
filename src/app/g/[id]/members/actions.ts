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

  const emails = String(formData.get("emails") ?? "");
  const participation = formData.get("participation") === "reader" ? "reader" : "contributor";

  await inviteMembers({
    groupId,
    emails: [emails],
    participation,
    actorName: viewer.user.name ?? viewer.user.email.split("@")[0],
    at: await getNow(),
  });

  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members?invited=1`);
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

export async function transferAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const viewer = await viewerFor(groupId);
  if (!viewer || viewer.membership.access !== "owner") redirect(`/g/${groupId}`);

  await transferOwnership(groupId, viewer.membership.id, membershipId);
  revalidatePath(`/g/${groupId}/members`);
  redirect(`/g/${groupId}/members?transferred=1`);
}
