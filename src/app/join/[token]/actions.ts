"use server";

import { redirect } from "next/navigation";
import { currentUser, requestMagicLink, signOut } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { copy, text } from "@/lib/copy";
import { joinDestination, joinWithInvite, loopForInvite } from "@/lib/invite-link";
import { requestIp } from "@/lib/rate-limit";
import { rememberCheckEmail, rememberJoinToken } from "../../signin/actions";

export type JoinState = { error?: string };

/**
 * Someone not signed in asks to join. Nothing joins yet: they get the sign-in
 * email, and confirming it (link or code) is what puts them in the loop.
 */
export async function requestJoin(_previous: JoinState, formData: FormData): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { error: copy.signIn.invalidEmail };

  const loop = await loopForInvite(token);
  // Reset while the page was open, or filled up: the page itself says which.
  if (!loop) redirect(`/join/${encodeURIComponent(token)}`);
  if (loop.full) return { error: text(copy.join.problems.full.body, { ownerName: loop.ownerName }) };

  const outcome = await requestMagicLink(email, { ip: await requestIp(), joinToken: token });
  if (outcome === "busy") return { error: copy.signIn.tooMany };
  await rememberCheckEmail(email);
  await rememberJoinToken(token);
  redirect("/signin/check-email");
}

/** Someone already signed in: their address is proven, so they're in at once. */
export async function joinNow(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const user = await currentUser();
  if (!user) redirect(`/join/${encodeURIComponent(token)}`);
  redirect(joinDestination(token, await joinWithInvite({ token, user, at: await getNow() })));
}

/** "Not you?": out, and back to the same invitation to join with the right address. */
export async function signOutToJoin(formData: FormData): Promise<void> {
  await signOut();
  redirect(`/join/${encodeURIComponent(String(formData.get("token") ?? ""))}`);
}
