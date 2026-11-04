"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CHECK_EMAIL_COOKIE, normalizeEmail, requestMagicLink } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { requestIp } from "@/lib/rate-limit";

export type SignInState = { error?: string };

export async function requestLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  if (!email.includes("@") || email.length < 3) {
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
    maxAge: 15 * 60,
  });
  // Same destination whether or not the address has ever been seen, and whether
  // or not this address has had too many links lately.
  redirect("/signin/check-email");
}
