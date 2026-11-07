import { redirect } from "next/navigation";
import { enableUiPreview, unlockUiInbox } from "@/lib/ui-preview";

export async function GET(request: Request) {
  const url = new URL(request.url);
  await unlockUiInbox(url.searchParams.get("key"));
  const demo = await enableUiPreview(url.searchParams.get("reset") === "1");
  redirect(demo ? "/dev/screens" : "/dev/feedback");
}
