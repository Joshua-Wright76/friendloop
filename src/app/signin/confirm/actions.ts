"use server";

import { redirect } from "next/navigation";
import { confirmMagicLink } from "@/lib/auth";

export async function confirmLink(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmMagicLink(token);

  if (result.ok) redirect("/you");

  const reason = result.ok ? "unknown" : result.reason;
  redirect(`/signin/confirm?token=${encodeURIComponent(token)}&problem=${reason}`);
}
