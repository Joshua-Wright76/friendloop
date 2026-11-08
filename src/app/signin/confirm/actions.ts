"use server";

import { redirect } from "next/navigation";
import { confirmMagicLink } from "@/lib/auth";
import { forgetCheckEmail } from "../actions";

export async function confirmLink(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmMagicLink(token, {
    name: String(formData.get("name") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
  });

  if (result.ok) {
    await forgetCheckEmail();
    redirect("/you");
  }

  const reason = result.ok ? "unknown" : result.reason;
  redirect(`/signin/confirm?token=${encodeURIComponent(token)}&problem=${reason}`);
}
