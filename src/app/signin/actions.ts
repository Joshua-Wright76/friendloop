"use server";

import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/auth";
import { copy } from "@/lib/copy";

export type SignInState = { error?: string };

export async function requestLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  if (!email.includes("@") || email.length < 3) {
    return { error: copy.signIn.invalidEmail };
  }

  await requestMagicLink(email);
  // Same destination whether or not the address has ever been seen.
  redirect("/signin/check-email");
}
