import { redirect } from "next/navigation";
import { enableUiPreview, grantUiPreviewAccess } from "@/lib/ui-preview";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await grantUiPreviewAccess(url.searchParams.get("key")))) {
    return new Response(null, { status: 404 });
  }
  await enableUiPreview(url.searchParams.get("reset") === "1");
  redirect("/dev/screens");
}
