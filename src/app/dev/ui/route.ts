import { redirect } from "next/navigation";
import { enableUiPreview } from "@/lib/ui-preview";

export async function GET(request: Request) {
  const reset = new URL(request.url).searchParams.get("reset") === "1";
  await enableUiPreview(reset);
  redirect("/dev/screens");
}
