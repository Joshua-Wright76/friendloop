"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CHECK_EMAIL_COOKIE, confirmSignInCode, type JoinResult, LINK_HOURS, normalizeEmail, requestMagicLink } from "@/lib/auth";
import { JOIN_CHECK_COOKIE, joinDestination } from "@/lib/invite-link";
import { copy } from "@/lib/copy";
import { requestIp } from "@/lib/rate-limit";
import { secureCookies } from "@/lib/e2e";
import { plainDestination, rememberStart, START_CHECK_COOKIE } from "./start";

export type SignInState = { error?: string };

export async function requestLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  // A full address: something, an @, and a domain with a dot. "you@" or "you@home" would only bounce.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { error: copy.signIn.invalidEmail };
  }

  const outcome = await requestMagicLink(email, { ip: await requestIp() });
  if (outcome === "busy") return { error: copy.signIn.tooMany };
  await rememberCheckEmail(email);
  await rememberStart(formData.get("start") === "1");
  (await cookies()).delete({ name: JOIN_CHECK_COOKIE, path: "/signin" });
  // Same destination whether or not the address has ever been seen, and whether
  // or not this address has had too many links lately.
  redirect("/signin/check-email");
}

export type ResendState = { error?: string; sentTo?: string };

/**
 * "Send it again" on the check-inbox page: the address (and invite link) this
 * browser already gave, read back from its own cookies, so nothing is retyped.
 * It goes through the same request function, so the same rate limits apply.
 */
export async function resendLink(): Promise<ResendState> {
  const jar = await cookies();
  const email = jar.get(CHECK_EMAIL_COOKIE)?.value?.slice(0, 254) ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: copy.signIn.invalidEmail };
  const joinToken = jar.get(JOIN_CHECK_COOKIE)?.value;

  const outcome = await requestMagicLink(email, { ip: await requestIp(), joinToken: joinToken || undefined });
  if (outcome === "busy") return { error: copy.signIn.tooMany };
  await rememberCheckEmail(email);
  return { sentTo: email };
}

export type CodeState = { error?: string };

/**
 * The code from the email. The address is the one this browser asked for (the
 * check-email cookie), or typed beside the code when that's gone, like in the
 * app on a home screen, which shares no cookies with the browser that asked.
 */
export async function enterCode(_previous: CodeState, formData: FormData): Promise<CodeState> {
  const typed = String(formData.get("email") ?? "").trim();
  const email = typed || (await cookies()).get(CHECK_EMAIL_COOKIE)?.value || "";
  const result = await confirmSignInCode(email, String(formData.get("code") ?? ""), {
    ip: await requestIp(),
    profile: { timezone: String(formData.get("timezone") ?? "") },
  });

  if (result.ok === true) {
    const destination = await signedInDestination(result.join, result.user.id);
    await forgetCheckEmail();
    redirect(destination);
  }
  if (result.ok === "name") redirect(`/signin/confirm?token=${encodeURIComponent(result.token)}`);
  const errors = { busy: copy.checkEmail.codeBusy, locked: copy.checkEmail.codeLocked, wrong: copy.checkEmail.codeWrong };
  return { error: errors[result.reason] };
}

/** Once someone is in, the address they asked for needn't sit in a cookie for days (a shared computer). */
export async function forgetCheckEmail(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: CHECK_EMAIL_COOKIE, path: "/signin" });
  jar.delete({ name: JOIN_CHECK_COOKIE, path: "/signin" });
  jar.delete({ name: START_CHECK_COOKIE, path: "/signin" });
}

/** Remembers the invite link someone asked to join through, so the next page can name the loop. */
export async function rememberJoinToken(token: string): Promise<void> {
  (await cookies()).set(JOIN_CHECK_COOKIE, token.slice(0, 64), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/signin",
    maxAge: LINK_HOURS * 60 * 60,
  });
}

/**
 * The next page repeats the address back, so a typo is caught there. It is only
 * ever what this browser just typed, never anything looked up, and it is set
 * whether or not the address has an account.
 */
export async function rememberCheckEmail(email: string): Promise<void> {
  (await cookies()).set(CHECK_EMAIL_COOKIE, normalizeEmail(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/signin",
    // As long as the code it pairs with, so the code box still knows the address days later.
    maxAge: LINK_HOURS * 60 * 60,
  });
}

/** Your loops, or, for someone who came from an invite link, the loop they joined. */
async function signedInDestination(join: JoinResult | undefined, userId: string): Promise<string> {
  return join ? joinDestination(join.joinToken, join.outcome) : plainDestination(userId);
}
