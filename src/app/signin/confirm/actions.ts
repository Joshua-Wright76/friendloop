"use server";

import { redirect } from "next/navigation";
import { confirmMagicLink } from "@/lib/auth";
import { joinDestination } from "@/lib/invite-link";
import { forgetCheckEmail } from "../actions";

export async function confirmLink(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmMagicLink(token, {
    name: String(formData.get("name") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
  });

  if (result.ok) {
    await forgetCheckEmail();
    redirect(result.join ? joinDestination(result.join.joinToken, result.join.outcome) : "/you");
  }

  const reason = result.ok ? "unknown" : result.reason;
  redirect(`/signin/confirm?token=${encodeURIComponent(token)}&problem=${reason}`);
}
