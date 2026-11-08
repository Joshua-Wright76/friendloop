"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CHECK_EMAIL_COOKIE, confirmSignInCode, LINK_HOURS, normalizeEmail, requestMagicLink } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { requestIp } from "@/lib/rate-limit";

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
  // The next page repeats the address back, so a typo is caught there. It is only
  // ever what this browser just typed, never anything looked up, and it is set
  // whether or not the address has an account.
  (await cookies()).set(CHECK_EMAIL_COOKIE, normalizeEmail(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/signin",
    // As long as the code it pairs with, so the code box still knows the address days later.
    maxAge: LINK_HOURS * 60 * 60,
  });
  // Same destination whether or not the address has ever been seen, and whether
  // or not this address has had too many links lately.
  redirect("/signin/check-email");
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

  if (result.ok === true) redirect("/you");
  if (result.ok === "name") redirect(`/signin/confirm?token=${encodeURIComponent(result.token)}`);
  return { error: result.reason === "busy" ? copy.checkEmail.codeBusy : copy.checkEmail.codeWrong };
}
